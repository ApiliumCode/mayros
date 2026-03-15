/**
 * Remote Exec Service
 *
 * Core execution wrapper for remote terminal operations.
 * Composes bash-sandbox validation, path safety, audit trail, and rate limiting.
 */

import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { evaluateCommand } from "../bash-sandbox/index.js";
import { bashSandboxConfigSchema, type BashSandboxConfig } from "../bash-sandbox/config.js";
import { AuditTrail } from "../osameru-governance/audit-trail.js";
import { isWithinDir } from "../../src/infra/path-safety.js";
import type { RemoteExecConfig } from "./config.js";

const execFileAsync = promisify(execFile);

// ============================================================================
// Types
// ============================================================================

export type ExecResult = {
  stdout: string;
  stderr: string;
  exitCode: number;
  truncated: boolean;
  durationMs: number;
};

export type ReadFileResult = {
  content: string;
  totalLines: number;
  linesShown: number;
  binary: boolean;
  size: number;
};

export type DirEntry = {
  name: string;
  type: "file" | "directory" | "symlink" | "other";
  size: number;
};

export type ListDirResult = {
  entries: DirEntry[];
  path: string;
};

type RateLimitState = {
  timestamps: number[];
};

// ============================================================================
// RemoteExecService
// ============================================================================

export class RemoteExecService {
  private readonly audit: AuditTrail;
  private readonly sandboxConfig: BashSandboxConfig;
  private readonly rateLimitStates = new Map<string, RateLimitState>();

  constructor(
    private readonly config: RemoteExecConfig,
    private readonly logger: { info: (msg: string) => void; warn: (msg: string) => void },
    audit: AuditTrail,
  ) {
    this.audit = audit;
    if (!config.allowedPaths.length) {
      throw new Error("RemoteExecService requires at least one allowedPath");
    }
    // Create a sandbox config that always enforces: no sudo, enforce mode
    this.sandboxConfig = bashSandboxConfigSchema.parse({
      mode: "enforce",
      allowSudo: false,
    });
  }

  // ---------- Rate Limiting ----------

  private getRateLimitState(senderId?: string): RateLimitState {
    const key = senderId ?? "__global__";
    let state = this.rateLimitStates.get(key);
    if (!state) {
      state = { timestamps: [] };
      this.rateLimitStates.set(key, state);
    }
    return state;
  }

  private pruneStaleRateLimitEntries(): void {
    const cutoff = Date.now() - this.config.rateLimits.windowMs;
    for (const [key, state] of this.rateLimitStates) {
      // Remove entries whose timestamps are all expired
      if (
        state.timestamps.length === 0 ||
        state.timestamps[state.timestamps.length - 1]! < cutoff
      ) {
        this.rateLimitStates.delete(key);
      }
    }
  }

  private checkRateLimit(senderId?: string): { allowed: boolean; retryAfterMs?: number } {
    const now = Date.now();
    const { maxCallsPerWindow, windowMs } = this.config.rateLimits;
    const cutoff = now - windowMs;
    const state = this.getRateLimitState(senderId);

    // Prune expired timestamps
    while (state.timestamps.length > 0 && state.timestamps[0]! < cutoff) {
      state.timestamps.shift();
    }

    // Periodically clean up stale sender entries
    if (this.rateLimitStates.size > 100) {
      this.pruneStaleRateLimitEntries();
    }

    if (state.timestamps.length >= maxCallsPerWindow) {
      const oldest = state.timestamps[0]!;
      const retryAfterMs = Math.max(0, oldest + windowMs - now);
      return { allowed: false, retryAfterMs };
    }

    return { allowed: true };
  }

  private recordRateLimit(senderId?: string): void {
    this.getRateLimitState(senderId).timestamps.push(Date.now());
  }

  // ---------- Path Validation ----------

  private async validatePath(inputPath: string): Promise<string> {
    if (!inputPath || !inputPath.trim()) {
      throw new Error("Path is required");
    }

    // Expand ~ to homedir
    let resolved = inputPath.trim();
    if (resolved.startsWith("~")) {
      resolved = resolved.replace(/^~/, os.homedir());
    }

    // Must be absolute after expansion
    if (!path.isAbsolute(resolved)) {
      throw new Error("Path must be absolute");
    }

    resolved = path.resolve(resolved);

    // Resolve symlinks to prevent escape
    let realPath: string;
    try {
      realPath = await fs.realpath(resolved);
    } catch (err) {
      const error = err as NodeJS.ErrnoException;
      if (error.code === "ENOENT") {
        throw new Error(`Path does not exist: ${resolved}`);
      }
      throw new Error(`Cannot resolve path: ${resolved}`);
    }

    // Check against all allowed paths (resolve symlinks in allowedPaths too)
    let withinAllowed = false;
    for (const allowed of this.config.allowedPaths) {
      const expandedAllowed = path.resolve(allowed.replace(/^~/, os.homedir()));
      let resolvedAllowed: string;
      try {
        resolvedAllowed = await fs.realpath(expandedAllowed);
      } catch {
        resolvedAllowed = expandedAllowed;
      }
      if (isWithinDir(resolvedAllowed, realPath) || realPath === resolvedAllowed) {
        withinAllowed = true;
        break;
      }
    }

    if (!withinAllowed) {
      throw new Error(`Path is outside allowed directories: ${inputPath}`);
    }

    return realPath;
  }

  // ---------- Public Path Validation ----------

  async validateWorkdir(inputPath: string): Promise<string> {
    const resolved = await this.validatePath(inputPath);
    const stat = await fs.stat(resolved);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${inputPath}`);
    }
    return resolved;
  }

  // ---------- Binary Detection ----------

  private isBinaryBuffer(buffer: Buffer, checkBytes = 1024): boolean {
    const len = Math.min(buffer.length, checkBytes);
    for (let i = 0; i < len; i++) {
      if (buffer[i] === 0) return true;
    }
    return false;
  }

  private isBinaryString(str: string, checkBytes = 1024): boolean {
    const len = Math.min(str.length, checkBytes);
    for (let i = 0; i < len; i++) {
      if (str.charCodeAt(i) === 0) return true;
    }
    return false;
  }

  // ---------- executeCommand ----------

  async executeCommand(params: {
    command: string;
    workdir?: string;
    timeout?: number;
    env?: Record<string, string>;
    senderId?: string;
  }): Promise<ExecResult> {
    // 1. Background execution blocking
    // Catches: nohup, disown, setsid keywords AND standalone & (not &&, &>, >&)
    const BG_KEYWORD = /(?:^|\s)(?:nohup|disown|setsid)\b/;
    const BG_AMPERSAND = /(?<![&>])&(?![&>])/;
    if (BG_KEYWORD.test(params.command) || BG_AMPERSAND.test(params.command)) {
      throw new Error("Background execution is not allowed");
    }

    // 2. Rate limit check (per-sender)
    const rateCheck = this.checkRateLimit(params.senderId);
    if (!rateCheck.allowed) {
      await this.audit.log("remote_exec", undefined, "deny", {
        command: params.command,
        reason: "rate_limited",
        retryAfterMs: rateCheck.retryAfterMs,
      });
      throw new Error(`Rate limit exceeded. Retry after ${rateCheck.retryAfterMs}ms`);
    }

    // 3. Resolve workdir
    const workdir = params.workdir ?? this.config.allowedPaths[0]!;
    const resolvedWorkdir = await this.validatePath(workdir);

    // Verify workdir is a directory
    const workdirStat = await fs.stat(resolvedWorkdir);
    if (!workdirStat.isDirectory()) {
      throw new Error(`Working directory is not a directory: ${workdir}`);
    }

    // 4. Sandbox evaluation
    const verdict = evaluateCommand(params.command, this.sandboxConfig);
    if (!verdict.allowed) {
      await this.audit.log("remote_exec", undefined, "deny", {
        command: params.command,
        workdir: resolvedWorkdir,
        reason: "sandbox_blocked",
        matches: verdict.matches,
      });
      const reasons = verdict.reasons.join("; ");
      throw new Error(`Command blocked by sandbox: ${reasons}`);
    }

    // 5. Audit pre-execution
    await this.audit.log("remote_exec", undefined, "allow", {
      command: params.command,
      workdir: resolvedWorkdir,
    });

    // 6. Execute
    const timeout = params.timeout
      ? Math.max(1000, Math.min(params.timeout, this.config.commandTimeout))
      : this.config.commandTimeout;

    const startTime = Date.now();
    let stdout = "";
    let stderr = "";
    let exitCode = 0;

    try {
      const result = await execFileAsync("bash", ["-c", params.command], {
        cwd: resolvedWorkdir,
        timeout,
        maxBuffer: this.config.maxOutputBytes + 1024, // slight margin for truncation detection
        env: { ...process.env, ...params.env, TERM: "dumb" },
      });
      stdout = result.stdout;
      stderr = result.stderr;
    } catch (err) {
      const error = err as {
        stdout?: string;
        stderr?: string;
        code?: number | string;
        killed?: boolean;
      };
      stdout = error.stdout ?? "";
      stderr = error.stderr ?? "";
      if (error.killed) {
        exitCode = 137;
        stderr += `\n[Process killed after ${timeout}ms timeout]`;
      } else if (typeof error.code === "number") {
        exitCode = error.code;
      } else {
        exitCode = 1;
      }
    }

    const durationMs = Date.now() - startTime;

    // 7. Record rate limit (per-sender)
    this.recordRateLimit(params.senderId);

    // 8. Output processing
    let truncated = false;

    // Binary detection
    if (this.isBinaryString(stdout)) {
      const byteLen = Buffer.byteLength(stdout);
      stdout = `[binary output, ${byteLen} bytes]`;
    }

    // Truncate if needed (byte-accurate for multi-byte chars)
    if (Buffer.byteLength(stdout) > this.config.maxOutputBytes) {
      stdout = Buffer.from(stdout, "utf-8")
        .subarray(0, this.config.maxOutputBytes)
        .toString("utf-8");
      truncated = true;
      stdout += "\n[output truncated]";
    }

    return { stdout, stderr, exitCode, truncated, durationMs };
  }

  // ---------- readFile ----------

  async readFile(params: {
    path: string;
    lines?: number;
    senderId?: string;
  }): Promise<ReadFileResult> {
    // 1. Rate limit check (per-sender)
    const rateCheck = this.checkRateLimit(params.senderId);
    if (!rateCheck.allowed) {
      await this.audit.log("remote_read_file", undefined, "deny", {
        path: params.path,
        reason: "rate_limited",
        retryAfterMs: rateCheck.retryAfterMs,
      });
      throw new Error(`Rate limit exceeded. Retry after ${rateCheck.retryAfterMs}ms`);
    }

    // 2. Validate path
    const resolvedPath = await this.validatePath(params.path);

    // 3. Stat check — must be a file
    const stat = await fs.stat(resolvedPath);
    if (!stat.isFile()) {
      throw new Error(`Not a file: ${params.path}`);
    }

    // 4. Binary detection — read first 8KB
    const fd = await fs.open(resolvedPath, "r");
    try {
      const probe = Buffer.alloc(8192);
      const { bytesRead } = await fd.read(probe, 0, 8192, 0);
      if (this.isBinaryBuffer(probe, bytesRead)) {
        this.recordRateLimit(params.senderId);
        await this.audit.log("remote_read_file", undefined, "deny", {
          path: resolvedPath,
          reason: "binary_file",
          size: stat.size,
        });
        return {
          content: "",
          totalLines: 0,
          linesShown: 0,
          binary: true,
          size: stat.size,
        };
      }
    } finally {
      await fd.close();
    }

    // 5. Read content
    const content = await fs.readFile(resolvedPath, "utf-8");
    const allLines = content.split("\n");
    const totalLines = allLines.length;

    let linesShown = totalLines;
    let outputContent = content;

    if (params.lines && params.lines > 0 && params.lines < totalLines) {
      outputContent = allLines.slice(0, params.lines).join("\n");
      linesShown = params.lines;
    }

    // Handle empty file
    if (!outputContent && stat.size === 0) {
      outputContent = "(empty)";
    }

    this.recordRateLimit(params.senderId);

    // 6. Audit
    await this.audit.log("remote_read_file", undefined, "allow", {
      path: resolvedPath,
      totalLines,
      linesShown,
      size: stat.size,
    });

    return {
      content: outputContent,
      totalLines,
      linesShown,
      binary: false,
      size: stat.size,
    };
  }

  // ---------- listDirectory ----------

  async listDirectory(params: { path: string; senderId?: string }): Promise<ListDirResult> {
    // 1. Rate limit check (per-sender)
    const rateCheck = this.checkRateLimit(params.senderId);
    if (!rateCheck.allowed) {
      await this.audit.log("remote_ls", undefined, "deny", {
        path: params.path,
        reason: "rate_limited",
        retryAfterMs: rateCheck.retryAfterMs,
      });
      throw new Error(`Rate limit exceeded. Retry after ${rateCheck.retryAfterMs}ms`);
    }

    // 2. Validate path
    const resolvedPath = await this.validatePath(params.path);

    // 3. Verify it's a directory
    const stat = await fs.stat(resolvedPath);
    if (!stat.isDirectory()) {
      throw new Error(`Not a directory: ${params.path}`);
    }

    // 4. Read entries
    const dirents = await fs.readdir(resolvedPath, { withFileTypes: true });

    const entries: DirEntry[] = [];
    for (const dirent of dirents) {
      let type: DirEntry["type"] = "other";
      let size = 0;

      if (dirent.isSymbolicLink()) {
        type = "symlink";
        try {
          const linkStat = await fs.stat(path.join(resolvedPath, dirent.name));
          size = linkStat.size;
        } catch {
          // Broken symlink
        }
      } else if (dirent.isDirectory()) {
        type = "directory";
      } else if (dirent.isFile()) {
        type = "file";
        try {
          const fileStat = await fs.stat(path.join(resolvedPath, dirent.name));
          size = fileStat.size;
        } catch {
          // Stat failed
        }
      }

      entries.push({ name: dirent.name, type, size });
    }

    // 5. Sort: directories first, then files, alphabetical
    entries.sort((a, b) => {
      const typeOrder = { directory: 0, symlink: 1, file: 2, other: 3 };
      const ta = typeOrder[a.type] ?? 3;
      const tb = typeOrder[b.type] ?? 3;
      if (ta !== tb) return ta - tb;
      return a.name.localeCompare(b.name);
    });

    this.recordRateLimit(params.senderId);

    // 6. Audit
    await this.audit.log("remote_ls", undefined, "allow", {
      path: resolvedPath,
      count: entries.length,
    });

    return { entries, path: resolvedPath };
  }
}

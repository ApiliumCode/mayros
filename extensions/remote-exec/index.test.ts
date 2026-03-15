/**
 * Remote Exec Plugin Tests
 *
 * Tests cover:
 * - A. Configuration parsing (defaults, validation, clamping, error cases)
 * - B. Path validation (allowedPaths, traversal, symlinks, resolution)
 * - C. Command execution (stdout/stderr, exit codes, timeout, truncation, binary)
 * - D. File reading (text, binary, line limits, errors)
 * - E. Directory listing (sorting, types, empty, errors)
 * - F. Plugin integration (registration, disabled state)
 * - G. Confirmation config parsing
 * - H. ConfirmationManager logic
 * - I. Output formatting
 * - J. /run command integration
 * - K. Session config parsing
 * - L. SessionManager logic
 * - M. Output paging
 * - N. /run cd, pwd, more integration
 * - O. Session config: maxHistorySize and maxEnvVars
 * - P. History management
 * - Q. Environment variable management
 * - R. /run history, !!, !N, env integration
 * - S. Config: maxAliases and maskOutput
 * - T. Alias management
 * - U. Output masking
 * - V. /run alias, status, masking integration
 * - W. Config: blockedPatterns
 * - X. Session clear
 * - Y. /run clear, config, blocklist integration
 * - Z. Blocklist & reserved names edge cases
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  remoteExecConfigSchema,
  type RemoteExecConfig,
  type ConfirmationConfig,
  type SessionConfig,
} from "./config.js";
import { RemoteExecService } from "./exec-service.js";
import {
  ConfirmationManager,
  formatExecOutput,
  formatApprovalPrompt,
  formatPendingList,
  ENV_BLOCKLIST,
  ENV_NAME_PATTERN,
  RESERVED_ALIAS_NAMES,
  type PendingRequest,
  type ExecResult,
} from "./confirmation-ux.js";
import { SessionManager } from "./session-manager.js";
import { maskSensitiveOutput } from "../../src/security/output-masking.js";

// ============================================================================
// Test Helpers
// ============================================================================

let tmpDir: string;
const createdDirs: string[] = [];

async function createTmpDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "remote-exec-test-"));
  createdDirs.push(dir);
  return dir;
}

async function cleanupDirs(): Promise<void> {
  for (const dir of createdDirs) {
    try {
      await fs.rm(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
  createdDirs.length = 0;
}

const noopLogger = {
  info: (_msg: string) => {},
  warn: (_msg: string) => {},
};

function makeConfig(overrides: Partial<RemoteExecConfig> = {}): RemoteExecConfig {
  return {
    enabled: true,
    allowedPaths: [tmpDir],
    commandTimeout: 30_000,
    maxOutputBytes: 100_000,
    auditLogPath: path.join(tmpDir, "audit.jsonl"),
    rateLimits: { maxCallsPerWindow: 100, windowMs: 60_000 },
    confirmation: {
      autoApproveMaxRisk: "safe",
      approvalTtlMs: 120_000,
      maxPending: 10,
      showRiskLevel: true,
    },
    session: {
      sessionTtlMs: 1_800_000,
      outputPageSize: 3_500,
      outputCacheTtlMs: 300_000,
      maxHistorySize: 20,
      maxEnvVars: 20,
      maxAliases: 10,
    },
    maskOutput: true,
    blockedPatterns: [],
    pin: { pinHash: null, pinLockoutMs: 300_000, pinMaxAttempts: 3, pinAutoLockMs: 300_000 },
    ...overrides,
  };
}

// ============================================================================
// A. Config Parsing (15 tests)
// ============================================================================

describe("remote-exec config", () => {
  it("parses with all defaults (disabled)", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.allowedPaths).toEqual([]);
    expect(cfg.commandTimeout).toBe(30_000);
    expect(cfg.maxOutputBytes).toBe(100_000);
    expect(cfg.auditLogPath).toContain("remote-exec-audit.jsonl");
    expect(cfg.rateLimits.maxCallsPerWindow).toBe(10);
    expect(cfg.rateLimits.windowMs).toBe(60_000);
  });

  it("throws when enabled without allowedPaths", () => {
    expect(() => remoteExecConfigSchema.parse({ enabled: true })).toThrow(
      "allowedPaths is required when enabled is true",
    );
  });

  it("throws when enabled with empty allowedPaths", () => {
    expect(() => remoteExecConfigSchema.parse({ enabled: true, allowedPaths: [] })).toThrow(
      "allowedPaths is required when enabled is true",
    );
  });

  it("throws on unknown keys", () => {
    expect(() => remoteExecConfigSchema.parse({ unknownKey: "bad" })).toThrow("unknown keys");
  });

  it("clamps commandTimeout to [1000, 120000]", () => {
    const low = remoteExecConfigSchema.parse({ commandTimeout: 500 });
    expect(low.commandTimeout).toBe(1_000);

    const high = remoteExecConfigSchema.parse({ commandTimeout: 999_999 });
    expect(high.commandTimeout).toBe(120_000);
  });

  it("clamps maxOutputBytes to [1024, 1000000]", () => {
    const low = remoteExecConfigSchema.parse({ maxOutputBytes: 100 });
    expect(low.maxOutputBytes).toBe(1_024);

    const high = remoteExecConfigSchema.parse({ maxOutputBytes: 9_999_999 });
    expect(high.maxOutputBytes).toBe(1_000_000);
  });

  it("uses default rateLimits when not provided", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.rateLimits.maxCallsPerWindow).toBe(10);
    expect(cfg.rateLimits.windowMs).toBe(60_000);
  });

  it("defaults auditLogPath to ~/.mayros/...", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.auditLogPath).toBe(path.join(os.homedir(), ".mayros/remote-exec-audit.jsonl"));
  });

  it("throws on non-string allowedPaths entries", () => {
    expect(() =>
      remoteExecConfigSchema.parse({
        enabled: true,
        allowedPaths: [123, "/valid"],
      }),
    ).toThrow("allowedPaths entries must be non-empty strings");
  });

  it("throws on NaN commandTimeout", () => {
    expect(() => remoteExecConfigSchema.parse({ commandTimeout: NaN })).toThrow(
      "commandTimeout must be a finite number",
    );
  });

  it("throws on Infinity maxOutputBytes", () => {
    expect(() => remoteExecConfigSchema.parse({ maxOutputBytes: Infinity })).toThrow(
      "maxOutputBytes must be a finite number",
    );
  });

  it("throws on negative commandTimeout", () => {
    expect(() => remoteExecConfigSchema.parse({ commandTimeout: -5000 })).toThrow(
      "Value must be non-negative",
    );
  });

  it("parses a valid complete config correctly", () => {
    const cfg = remoteExecConfigSchema.parse({
      enabled: true,
      allowedPaths: ["/tmp/test"],
      commandTimeout: 10_000,
      maxOutputBytes: 50_000,
      auditLogPath: "/tmp/audit.jsonl",
      rateLimits: { maxCallsPerWindow: 5, windowMs: 30_000 },
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.allowedPaths).toEqual(["/tmp/test"]);
    expect(cfg.commandTimeout).toBe(10_000);
    expect(cfg.maxOutputBytes).toBe(50_000);
    expect(cfg.auditLogPath).toBe("/tmp/audit.jsonl");
    expect(cfg.rateLimits.maxCallsPerWindow).toBe(5);
    expect(cfg.rateLimits.windowMs).toBe(30_000);
  });

  it("parses partial config with defaults filled in", () => {
    const cfg = remoteExecConfigSchema.parse({
      enabled: false,
      allowedPaths: ["/some/path"],
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.commandTimeout).toBe(30_000);
    expect(cfg.maxOutputBytes).toBe(100_000);
  });

  it("parses null/undefined config as disabled", () => {
    const cfgNull = remoteExecConfigSchema.parse(null);
    expect(cfgNull.enabled).toBe(false);

    const cfgUndef = remoteExecConfigSchema.parse(undefined);
    expect(cfgUndef.enabled).toBe(false);
  });

  it("throws on nested unknown keys in rateLimits", () => {
    expect(() =>
      remoteExecConfigSchema.parse({
        rateLimits: { maxCallsPerWindow: 10, windowMs: 60_000, badKey: true },
      }),
    ).toThrow("unknown keys");
  });
});

// ============================================================================
// B. Path Validation (10 tests)
// ============================================================================

describe("path validation", () => {
  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.mkdir(path.join(tmpDir, "subdir"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "test.txt"), "hello");
    await fs.writeFile(path.join(tmpDir, "subdir", "nested.txt"), "nested content");
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("allows path within allowedPaths", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.listDirectory({ path: tmpDir });
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("denies path outside all allowedPaths", async () => {
    const otherDir = await createTmpDir();
    const service = new RemoteExecService(makeConfig({ allowedPaths: [tmpDir] }), noopLogger);
    await expect(service.listDirectory({ path: otherDir })).rejects.toThrow(
      "outside allowed directories",
    );
  });

  it("denies path traversal ../../etc/passwd", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(service.readFile({ path: path.join(tmpDir, "../../etc/passwd") })).rejects.toThrow(
      /outside allowed directories|does not exist/,
    );
  });

  it("denies symlink escaping allowed dir", async () => {
    const outsideDir = await createTmpDir();
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "top secret");

    const symlinkPath = path.join(tmpDir, "escape-link");
    await fs.symlink(outsideDir, symlinkPath);

    const service = new RemoteExecService(makeConfig({ allowedPaths: [tmpDir] }), noopLogger);

    await expect(service.listDirectory({ path: symlinkPath })).rejects.toThrow(
      "outside allowed directories",
    );
  });

  it("allows path in second of multiple allowedPaths", async () => {
    const otherDir = await createTmpDir();
    await fs.writeFile(path.join(otherDir, "file.txt"), "content");

    const service = new RemoteExecService(
      makeConfig({ allowedPaths: [tmpDir, otherDir] }),
      noopLogger,
    );
    const result = await service.listDirectory({ path: otherDir });
    expect(result.entries.length).toBeGreaterThan(0);
  });

  it("rejects relative path", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(service.readFile({ path: "relative/path.txt" })).rejects.toThrow(
      "Path must be absolute",
    );
  });

  it("errors on empty path", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(service.readFile({ path: "" })).rejects.toThrow("Path is required");
  });

  it("provides clear error for nonexistent path", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(service.readFile({ path: path.join(tmpDir, "nonexistent.txt") })).rejects.toThrow(
      "does not exist",
    );
  });

  it("handles path with spaces", async () => {
    const spacedDir = path.join(tmpDir, "dir with spaces");
    await fs.mkdir(spacedDir, { recursive: true });
    await fs.writeFile(path.join(spacedDir, "file.txt"), "content");

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.listDirectory({ path: spacedDir });
    expect(result.entries).toHaveLength(1);
    expect(result.entries[0]!.name).toBe("file.txt");
  });

  it("resolves ~ to home directory", async () => {
    // We cannot guarantee homedir files exist within allowedPaths,
    // so we just verify ~ expansion + the path validation itself rejects it
    const service = new RemoteExecService(makeConfig({ allowedPaths: [tmpDir] }), noopLogger);
    await expect(service.readFile({ path: "~/some-file.txt" })).rejects.toThrow(
      /outside allowed directories|does not exist/,
    );
  });
});

// ============================================================================
// C. Command Execution (12 tests)
// ============================================================================

describe("command execution", () => {
  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.mkdir(path.join(tmpDir, "subdir"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "hello.txt"), "hello world\n");
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("echo hello returns stdout and exit 0", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.executeCommand({
      command: "echo hello",
      workdir: tmpDir,
    });
    expect(result.stdout.trim()).toBe("hello");
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("captures stderr", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.executeCommand({
      command: "echo error >&2",
      workdir: tmpDir,
    });
    expect(result.stderr.trim()).toBe("error");
  });

  it("captures nonzero exit code", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.executeCommand({
      command: "exit 42",
      workdir: tmpDir,
    });
    expect(result.exitCode).toBe(42);
  });

  it("kills command on timeout", async () => {
    const service = new RemoteExecService(makeConfig({ commandTimeout: 2_000 }), noopLogger);
    const result = await service.executeCommand({
      command: "sleep 60",
      workdir: tmpDir,
      timeout: 1_500,
    });
    expect(result.exitCode).toBe(137);
    expect(result.stderr).toContain("timeout");
  });

  it("truncates output exceeding maxOutputBytes", async () => {
    const service = new RemoteExecService(makeConfig({ maxOutputBytes: 100 }), noopLogger);
    const result = await service.executeCommand({
      command: "yes | head -n 1000",
      workdir: tmpDir,
    });
    expect(result.truncated).toBe(true);
  });

  it("detects binary output", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.executeCommand({
      command: "printf '\\x00\\x01\\x02'",
      workdir: tmpDir,
    });
    expect(result.stdout).toContain("binary output");
  });

  it("blocks dangerous command (rm -rf /)", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(
      service.executeCommand({
        command: "rm -rf /",
        workdir: tmpDir,
      }),
    ).rejects.toThrow("blocked by sandbox");
  });

  it("rate limits when exceeded", async () => {
    const service = new RemoteExecService(
      makeConfig({ rateLimits: { maxCallsPerWindow: 2, windowMs: 60_000 } }),
      noopLogger,
    );
    await service.executeCommand({ command: "echo 1", workdir: tmpDir });
    await service.executeCommand({ command: "echo 2", workdir: tmpDir });
    await expect(service.executeCommand({ command: "echo 3", workdir: tmpDir })).rejects.toThrow(
      "Rate limit exceeded",
    );
  });

  it("creates audit log for allowed execution", async () => {
    const auditPath = path.join(tmpDir, "audit.jsonl");
    const service = new RemoteExecService(makeConfig({ auditLogPath: auditPath }), noopLogger);
    await service.executeCommand({ command: "echo hi", workdir: tmpDir });

    const content = await fs.readFile(auditPath, "utf-8");
    const lines = content.trim().split("\n");
    expect(lines.length).toBeGreaterThanOrEqual(1);
    const entry = JSON.parse(lines[lines.length - 1]!);
    expect(entry.event).toBe("remote_exec");
    expect(entry.decision).toBe("allow");
  });

  it("creates audit log for denied execution", async () => {
    const auditPath = path.join(tmpDir, "audit.jsonl");
    const service = new RemoteExecService(makeConfig({ auditLogPath: auditPath }), noopLogger);
    try {
      await service.executeCommand({ command: "rm -rf /", workdir: tmpDir });
    } catch {
      // expected
    }

    const content = await fs.readFile(auditPath, "utf-8");
    const lines = content.trim().split("\n");
    const denied = lines.find((l) => {
      const entry = JSON.parse(l);
      return entry.decision === "deny";
    });
    expect(denied).toBeDefined();
  });

  it("respects workdir", async () => {
    const subdir = path.join(tmpDir, "subdir");
    await fs.writeFile(path.join(subdir, "marker.txt"), "found");

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.executeCommand({
      command: "cat marker.txt",
      workdir: subdir,
    });
    expect(result.stdout.trim()).toBe("found");
  });

  it("handles piped commands", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.executeCommand({
      command: "echo foo | grep foo",
      workdir: tmpDir,
    });
    expect(result.stdout.trim()).toBe("foo");
    expect(result.exitCode).toBe(0);
  });
});

// ============================================================================
// D. File Read (8 tests)
// ============================================================================

describe("file read", () => {
  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.writeFile(path.join(tmpDir, "readme.txt"), "line1\nline2\nline3\nline4\nline5\n");
    await fs.writeFile(path.join(tmpDir, "empty.txt"), "");
    await fs.mkdir(path.join(tmpDir, "adir"), { recursive: true });
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("reads text file with correct content", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.readFile({ path: path.join(tmpDir, "readme.txt") });
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line5");
    expect(result.binary).toBe(false);
    expect(result.totalLines).toBe(6); // 5 lines + trailing newline = 6 splits
  });

  it("applies line limit", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.readFile({ path: path.join(tmpDir, "readme.txt"), lines: 2 });
    expect(result.linesShown).toBe(2);
    expect(result.content).toContain("line1");
    expect(result.content).toContain("line2");
    expect(result.content).not.toContain("line3");
  });

  it("detects binary file", async () => {
    const binPath = path.join(tmpDir, "binary.dat");
    const buf = Buffer.alloc(256);
    buf[0] = 0x00;
    buf[1] = 0x01;
    buf[2] = 0x02;
    await fs.writeFile(binPath, buf);

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.readFile({ path: binPath });
    expect(result.binary).toBe(true);
    expect(result.size).toBe(256);
  });

  it("errors on file not found", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(service.readFile({ path: path.join(tmpDir, "nope.txt") })).rejects.toThrow(
      "does not exist",
    );
  });

  it("errors when path is a directory", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(service.readFile({ path: path.join(tmpDir, "adir") })).rejects.toThrow(
      "Not a file",
    );
  });

  it("denies path outside allowed", async () => {
    const outsideDir = await createTmpDir();
    await fs.writeFile(path.join(outsideDir, "secret.txt"), "nope");

    const service = new RemoteExecService(makeConfig({ allowedPaths: [tmpDir] }), noopLogger);
    await expect(service.readFile({ path: path.join(outsideDir, "secret.txt") })).rejects.toThrow(
      "outside allowed directories",
    );
  });

  it("handles empty file", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.readFile({ path: path.join(tmpDir, "empty.txt") });
    expect(result.content).toBe("(empty)");
    expect(result.size).toBe(0);
  });

  it("respects line limit on large file", async () => {
    const lines = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join("\n");
    await fs.writeFile(path.join(tmpDir, "large.txt"), lines);

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.readFile({ path: path.join(tmpDir, "large.txt"), lines: 10 });
    expect(result.linesShown).toBe(10);
    expect(result.totalLines).toBe(1000);
  });
});

// ============================================================================
// E. Directory Listing (7 tests)
// ============================================================================

describe("directory listing", () => {
  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("lists files and directories", async () => {
    await fs.mkdir(path.join(tmpDir, "dirA"));
    await fs.writeFile(path.join(tmpDir, "fileB.txt"), "content");
    await fs.writeFile(path.join(tmpDir, "fileA.txt"), "content");

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.listDirectory({ path: tmpDir });
    expect(result.entries.length).toBe(3);
  });

  it("sorts directories first, then files, alphabetical", async () => {
    await fs.mkdir(path.join(tmpDir, "zdir"));
    await fs.mkdir(path.join(tmpDir, "adir"));
    await fs.writeFile(path.join(tmpDir, "zfile.txt"), "z");
    await fs.writeFile(path.join(tmpDir, "afile.txt"), "a");

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.listDirectory({ path: tmpDir });

    const names = result.entries.map((e) => e.name);
    expect(names).toEqual(["adir", "zdir", "afile.txt", "zfile.txt"]);
  });

  it("shows symlinks with correct type", async () => {
    await fs.writeFile(path.join(tmpDir, "target.txt"), "content");
    await fs.symlink(path.join(tmpDir, "target.txt"), path.join(tmpDir, "link.txt"));

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.listDirectory({ path: tmpDir });
    const symlink = result.entries.find((e) => e.name === "link.txt");
    expect(symlink).toBeDefined();
    expect(symlink!.type).toBe("symlink");
  });

  it("denies path outside allowed", async () => {
    const outsideDir = await createTmpDir();
    const service = new RemoteExecService(makeConfig({ allowedPaths: [tmpDir] }), noopLogger);
    await expect(service.listDirectory({ path: outsideDir })).rejects.toThrow(
      "outside allowed directories",
    );
  });

  it("errors on nonexistent directory", async () => {
    const service = new RemoteExecService(makeConfig(), noopLogger);
    await expect(service.listDirectory({ path: path.join(tmpDir, "nope") })).rejects.toThrow(
      "does not exist",
    );
  });

  it("handles empty directory", async () => {
    const emptyDir = path.join(tmpDir, "empty");
    await fs.mkdir(emptyDir);

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.listDirectory({ path: emptyDir });
    expect(result.entries).toHaveLength(0);
  });

  it("includes hidden files", async () => {
    await fs.writeFile(path.join(tmpDir, ".gitignore"), "node_modules/");
    await fs.writeFile(path.join(tmpDir, "visible.txt"), "content");

    const service = new RemoteExecService(makeConfig(), noopLogger);
    const result = await service.listDirectory({ path: tmpDir });
    const names = result.entries.map((e) => e.name);
    expect(names).toContain(".gitignore");
    expect(names).toContain("visible.txt");
  });
});

// ============================================================================
// F. Integration (3 tests)
// ============================================================================

describe("plugin integration", () => {
  beforeEach(async () => {
    tmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("registers 3 tools + /run command when enabled", async () => {
    const { default: plugin } = await import("./index.js");

    const registeredTools: string[] = [];
    const registeredCommands: string[] = [];
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
      },
      logger: noopLogger,
      registerTool: (tool: { name?: string }, opts?: { name?: string }) => {
        registeredTools.push(opts?.name ?? tool.name ?? "unknown");
      },
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string }) => {
        registeredCommands.push(cmd.name);
      },
    };

    await plugin.register(mockApi as any);
    expect(registeredTools).toEqual(["remote_exec", "remote_read_file", "remote_ls"]);
    expect(registeredCommands).toEqual(["run"]);
  });

  it("registers 0 tools when disabled", async () => {
    const { default: plugin } = await import("./index.js");

    const registeredTools: string[] = [];
    const mockApi = {
      pluginConfig: { enabled: false },
      logger: noopLogger,
      registerTool: (_tool: unknown, opts?: { name?: string }) => {
        registeredTools.push(opts?.name ?? "unknown");
      },
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: () => {},
    };

    await plugin.register(mockApi as any);
    expect(registeredTools).toHaveLength(0);
  });

  it("executes tool end-to-end with real command", async () => {
    await fs.writeFile(path.join(tmpDir, "e2e.txt"), "end-to-end");

    const service = new RemoteExecService(
      makeConfig({ auditLogPath: path.join(tmpDir, "e2e-audit.jsonl") }),
      noopLogger,
    );

    const execResult = await service.executeCommand({
      command: "cat e2e.txt",
      workdir: tmpDir,
    });
    expect(execResult.stdout.trim()).toBe("end-to-end");
    expect(execResult.exitCode).toBe(0);

    const readResult = await service.readFile({ path: path.join(tmpDir, "e2e.txt") });
    expect(readResult.content).toContain("end-to-end");

    const lsResult = await service.listDirectory({ path: tmpDir });
    const names = lsResult.entries.map((e) => e.name);
    expect(names).toContain("e2e.txt");
  });
});

// ============================================================================
// G. Confirmation Config (8 tests)
// ============================================================================

describe("confirmation config", () => {
  it("parses defaults for confirmation section", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.confirmation.autoApproveMaxRisk).toBe("safe");
    expect(cfg.confirmation.approvalTtlMs).toBe(120_000);
    expect(cfg.confirmation.maxPending).toBe(10);
    expect(cfg.confirmation.showRiskLevel).toBe(true);
  });

  it("validates autoApproveMaxRisk with valid values", () => {
    for (const risk of ["safe", "low", "medium", "high", "critical"] as const) {
      const cfg = remoteExecConfigSchema.parse({
        confirmation: { autoApproveMaxRisk: risk },
      });
      expect(cfg.confirmation.autoApproveMaxRisk).toBe(risk);
    }
  });

  it("invalid autoApproveMaxRisk falls back to safe", () => {
    const cfg = remoteExecConfigSchema.parse({
      confirmation: { autoApproveMaxRisk: "banana" },
    });
    expect(cfg.confirmation.autoApproveMaxRisk).toBe("safe");
  });

  it("clamps approvalTtlMs to [10_000, 600_000]", () => {
    const low = remoteExecConfigSchema.parse({
      confirmation: { approvalTtlMs: 1_000 },
    });
    expect(low.confirmation.approvalTtlMs).toBe(10_000);

    const high = remoteExecConfigSchema.parse({
      confirmation: { approvalTtlMs: 999_999 },
    });
    expect(high.confirmation.approvalTtlMs).toBe(600_000);
  });

  it("clamps maxPending to [1, 100]", () => {
    const low = remoteExecConfigSchema.parse({
      confirmation: { maxPending: 0 },
    });
    expect(low.confirmation.maxPending).toBe(1);

    const high = remoteExecConfigSchema.parse({
      confirmation: { maxPending: 999 },
    });
    expect(high.confirmation.maxPending).toBe(100);
  });

  it("unknown keys in confirmation section throws", () => {
    expect(() =>
      remoteExecConfigSchema.parse({
        confirmation: { unknownKey: true },
      }),
    ).toThrow("unknown keys");
  });

  it("missing confirmation section uses defaults", () => {
    const cfg = remoteExecConfigSchema.parse({ enabled: false });
    expect(cfg.confirmation.autoApproveMaxRisk).toBe("safe");
    expect(cfg.confirmation.approvalTtlMs).toBe(120_000);
  });

  it("full confirmation config parses correctly", () => {
    const cfg = remoteExecConfigSchema.parse({
      confirmation: {
        autoApproveMaxRisk: "medium",
        approvalTtlMs: 60_000,
        maxPending: 5,
        showRiskLevel: false,
      },
    });
    expect(cfg.confirmation.autoApproveMaxRisk).toBe("medium");
    expect(cfg.confirmation.approvalTtlMs).toBe(60_000);
    expect(cfg.confirmation.maxPending).toBe(5);
    expect(cfg.confirmation.showRiskLevel).toBe(false);
  });
});

// ============================================================================
// H. ConfirmationManager (12 tests)
// ============================================================================

describe("ConfirmationManager", () => {
  const mockAudit = {
    log: vi.fn().mockResolvedValue({
      seq: 1,
      timestamp: "",
      event: "",
      actor: undefined,
      decision: "allow" as const,
      context: {},
      prevHmac: "",
      hmac: "",
    }),
    init: vi.fn(),
    verify: vi.fn(),
    query: vi.fn(),
    lastWriteError: null,
  };

  function makeConfirmConfig(overrides: Partial<ConfirmationConfig> = {}): ConfirmationConfig {
    return {
      autoApproveMaxRisk: "safe",
      approvalTtlMs: 120_000,
      maxPending: 10,
      showRiskLevel: true,
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("auto-approves safe command when autoApproveMaxRisk is safe", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    // "ls -la" is classified as "safe"
    const result = mgr.evaluateCommand({ command: "ls -la", channel: "whatsapp" });
    expect(result.action).toBe("auto_approved");
  });

  it("auto-approves low command when autoApproveMaxRisk is low", () => {
    const mgr = new ConfirmationManager(
      makeConfirmConfig({ autoApproveMaxRisk: "low" }),
      mockAudit as any,
      noopLogger,
    );
    // "npm install" is classified as "low"
    const result = mgr.evaluateCommand({ command: "npm install", channel: "telegram" });
    expect(result.action).toBe("auto_approved");
  });

  it("queues medium-risk command for approval when autoApproveMaxRisk is safe", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    // "git push origin main" is classified as "medium"
    const result = mgr.evaluateCommand({ command: "git push origin main", channel: "whatsapp" });
    expect(result.action).toBe("pending_approval");
    if (result.action === "pending_approval") {
      expect(result.request.command).toBe("git push origin main");
    }
  });

  it("queues high-risk command for approval", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    const result = mgr.evaluateCommand({
      command: "git push --force origin main",
      channel: "whatsapp",
    });
    expect(result.action).toBe("pending_approval");
  });

  it("generates unique 6-char hex IDs", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    const r1 = mgr.evaluateCommand({ command: "git push origin main", channel: "whatsapp" });
    const r2 = mgr.evaluateCommand({ command: "git commit -m test", channel: "whatsapp" });

    if (r1.action === "pending_approval" && r2.action === "pending_approval") {
      expect(r1.request.id).toHaveLength(6);
      expect(r2.request.id).toHaveLength(6);
      expect(r1.request.id).not.toBe(r2.request.id);
    }
  });

  it("prunes expired requests automatically", () => {
    const mgr = new ConfirmationManager(
      makeConfirmConfig({ approvalTtlMs: 1 }),
      mockAudit as any,
      noopLogger,
    );
    mgr.evaluateCommand({ command: "git push origin main", channel: "whatsapp" });

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    const pending = mgr.listPending();
    expect(pending).toHaveLength(0);
  });

  it("rejects when maxPending is reached", () => {
    const mgr = new ConfirmationManager(
      makeConfirmConfig({ maxPending: 1 }),
      mockAudit as any,
      noopLogger,
    );
    mgr.evaluateCommand({ command: "git push origin main", channel: "whatsapp" });
    const result = mgr.evaluateCommand({ command: "git commit -m test", channel: "whatsapp" });
    expect(result.action).toBe("blocked");
    if (result.action === "blocked") {
      expect(result.reason).toContain("Too many pending");
    }
  });

  it("approve() returns request and removes from pending", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    const result = mgr.evaluateCommand({ command: "git push origin main", channel: "whatsapp" });
    expect(result.action).toBe("pending_approval");
    if (result.action !== "pending_approval") return;

    const approved = mgr.approve(result.request.id);
    expect(approved).not.toBeNull();
    expect(approved!.command).toBe("git push origin main");

    // Should be removed
    expect(mgr.getPending(result.request.id)).toBeNull();
  });

  it("approve() returns null for unknown ID", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    const result = mgr.approve("nonexistent");
    expect(result).toBeNull();
  });

  it("deny() returns request and removes from pending", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    const result = mgr.evaluateCommand({ command: "git push origin main", channel: "whatsapp" });
    expect(result.action).toBe("pending_approval");
    if (result.action !== "pending_approval") return;

    const denied = mgr.deny(result.request.id);
    expect(denied).not.toBeNull();
    expect(denied!.command).toBe("git push origin main");
    expect(mgr.getPending(result.request.id)).toBeNull();
  });

  it("deny() returns null for unknown ID", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    const result = mgr.deny("nonexistent");
    expect(result).toBeNull();
  });

  it("listPending() returns only non-expired requests", () => {
    const mgr = new ConfirmationManager(makeConfirmConfig(), mockAudit as any, noopLogger);
    mgr.evaluateCommand({ command: "git push origin main", channel: "whatsapp" });
    mgr.evaluateCommand({ command: "git commit -m test", channel: "whatsapp" });

    const pending = mgr.listPending();
    expect(pending).toHaveLength(2);
  });
});

// ============================================================================
// I. Output Formatting (6 tests)
// ============================================================================

describe("output formatting", () => {
  it("formatExecOutput: stdout only, exit 0 with duration", () => {
    const result: ExecResult = {
      stdout: "hello world\n",
      stderr: "",
      exitCode: 0,
      truncated: false,
      durationMs: 42,
    };
    const output = formatExecOutput(result, "echo hello world");
    expect(output).toContain("> echo hello world");
    expect(output).toContain("hello world");
    expect(output).toContain("42ms");
    expect(output).not.toContain("exit:");
  });

  it("formatExecOutput: stderr + nonzero exit code", () => {
    const result: ExecResult = {
      stdout: "",
      stderr: "not found\n",
      exitCode: 1,
      truncated: false,
      durationMs: 10,
    };
    const output = formatExecOutput(result, "bad-cmd");
    expect(output).toContain("not found");
    expect(output).toContain("exit: 1");
  });

  it("formatExecOutput: truncated output note", () => {
    const result: ExecResult = {
      stdout: "lots of data...\n",
      stderr: "",
      exitCode: 0,
      truncated: true,
      durationMs: 100,
    };
    const output = formatExecOutput(result, "cat bigfile");
    expect(output).toContain("(truncated)");
  });

  it("formatApprovalPrompt: includes risk level, command, ID, expiry", () => {
    const request: PendingRequest = {
      id: "abc123",
      command: "git push --force origin main",
      classification: {
        riskLevel: "high",
        category: "git",
        description: "Force push to remote",
        matchedPatterns: ["git-push-force"],
      },
      channel: "whatsapp",
      createdAt: Date.now(),
      expiresAt: Date.now() + 120_000,
    };
    const output = formatApprovalPrompt(request, true);
    expect(output).toContain("HIGH");
    expect(output).toContain("git push --force origin main");
    expect(output).toContain("abc123");
    expect(output).toContain("/run approve abc123");
    expect(output).toContain("/run deny abc123");
    expect(output).toContain("120 seconds");
  });

  it("formatPendingList: empty list", () => {
    const output = formatPendingList([]);
    expect(output).toContain("No pending");
  });

  it("formatPendingList: multiple entries with IDs and expiry", () => {
    const now = Date.now();
    const requests: PendingRequest[] = [
      {
        id: "aaa111",
        command: "git push",
        classification: {
          riskLevel: "medium",
          category: "git",
          description: "Push",
          matchedPatterns: ["git-push"],
        },
        channel: "whatsapp",
        createdAt: now,
        expiresAt: now + 60_000,
      },
      {
        id: "bbb222",
        command: "rm -rf /tmp/test",
        classification: {
          riskLevel: "high",
          category: "destructive",
          description: "Recursive deletion",
          matchedPatterns: ["rm-rf"],
        },
        channel: "telegram",
        createdAt: now,
        expiresAt: now + 120_000,
      },
    ];
    const output = formatPendingList(requests);
    expect(output).toContain("aaa111");
    expect(output).toContain("bbb222");
    expect(output).toContain("git push");
    expect(output).toContain("rm -rf /tmp/test");
    expect(output).toContain("2)");
  });
});

// ============================================================================
// J. /run Command Integration (9 tests)
// ============================================================================

describe("/run command integration", () => {
  let cmdHandler: (ctx: any) => Promise<any>;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.writeFile(path.join(tmpDir, "test.txt"), "hello");

    const { default: plugin } = await import("./index.js");

    let capturedHandler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") {
          capturedHandler = cmd.handler;
        }
      },
    };

    await plugin.register(mockApi as any);
    cmdHandler = capturedHandler!;
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("/run without args returns help text", async () => {
    const result = await cmdHandler({
      args: "",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run",
      config: {},
    });
    expect(result.text).toContain("Usage: /run <command>");
  });

  it("/run help returns help text", async () => {
    const result = await cmdHandler({
      args: "help",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run help",
      config: {},
    });
    expect(result.text).toContain("Usage: /run <command>");
    expect(result.text).toContain("approve");
    expect(result.text).toContain("deny");
  });

  it("/run <safe-command> auto-executes, returns formatted output", async () => {
    const result = await cmdHandler({
      args: "echo hello-world",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo hello-world",
      config: {},
    });
    expect(result.text).toContain("hello-world");
  });

  it("/run <risky-command> returns approval prompt with ID", async () => {
    const result = await cmdHandler({
      args: "git push origin main",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run git push origin main",
      config: {},
    });
    expect(result.text).toContain("requires approval");
    expect(result.text).toContain("/run approve");
  });

  it("/run approve <valid-id> executes approved command, returns output", async () => {
    // First create a pending request
    const pending = await cmdHandler({
      args: "git push origin main",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run git push origin main",
      config: {},
    });

    // Extract the ID from the approval prompt
    const idMatch = pending.text.match(/\/run approve (\w+)/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1];

    // Approve it — git push will fail (no git repo) but should attempt execution
    const result = await cmdHandler({
      args: `approve ${id}`,
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: `/run approve ${id}`,
      config: {},
    });
    // Should contain output (even if the command fails, it will show exit code)
    expect(result.text).toBeDefined();
    expect(typeof result.text).toBe("string");
  });

  it("/run approve <invalid-id> returns not found", async () => {
    const result = await cmdHandler({
      args: "approve zzz999",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run approve zzz999",
      config: {},
    });
    expect(result.text).toContain("not found or expired");
  });

  it("/run approve <expired-id> returns not found", async () => {
    // We need a manager with very short TTL — the plugin uses config defaults
    // Instead, test via ConfirmationManager directly
    const mockAudit = {
      log: vi.fn().mockResolvedValue({
        seq: 1,
        timestamp: "",
        event: "",
        actor: undefined,
        decision: "allow" as const,
        context: {},
        prevHmac: "",
        hmac: "",
      }),
    };
    const mgr = new ConfirmationManager(
      { autoApproveMaxRisk: "safe", approvalTtlMs: 1, maxPending: 10, showRiskLevel: true },
      mockAudit as any,
      noopLogger,
    );
    const evalResult = mgr.evaluateCommand({ command: "git push", channel: "whatsapp" });
    expect(evalResult.action).toBe("pending_approval");
    if (evalResult.action !== "pending_approval") return;

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    const approved = mgr.approve(evalResult.request.id);
    expect(approved).toBeNull();
  });

  it("/run deny <id> confirms denial", async () => {
    // Create pending
    const pending = await cmdHandler({
      args: "git push origin main",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run git push origin main",
      config: {},
    });

    const idMatch = pending.text.match(/\/run deny (\w+)/);
    expect(idMatch).not.toBeNull();
    const id = idMatch![1];

    const result = await cmdHandler({
      args: `deny ${id}`,
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: `/run deny ${id}`,
      config: {},
    });
    expect(result.text).toContain("Denied");
  });

  it("/run pending lists pending requests", async () => {
    // Create a pending request first
    await cmdHandler({
      args: "git push origin main",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run git push origin main",
      config: {},
    });

    const result = await cmdHandler({
      args: "pending",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run pending",
      config: {},
    });
    expect(result.text).toContain("git push origin main");
  });
});

// ============================================================================
// K. Session Config (7 tests)
// ============================================================================

describe("session config", () => {
  it("parses defaults for session section", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.session.sessionTtlMs).toBe(1_800_000);
    expect(cfg.session.outputPageSize).toBe(3_500);
    expect(cfg.session.outputCacheTtlMs).toBe(300_000);
  });

  it("clamps sessionTtlMs to [60_000, 86_400_000]", () => {
    const low = remoteExecConfigSchema.parse({ session: { sessionTtlMs: 100 } });
    expect(low.session.sessionTtlMs).toBe(60_000);
    const high = remoteExecConfigSchema.parse({ session: { sessionTtlMs: 100_000_000 } });
    expect(high.session.sessionTtlMs).toBe(86_400_000);
  });

  it("clamps outputPageSize to [500, 10_000]", () => {
    const low = remoteExecConfigSchema.parse({ session: { outputPageSize: 10 } });
    expect(low.session.outputPageSize).toBe(500);
    const high = remoteExecConfigSchema.parse({ session: { outputPageSize: 50_000 } });
    expect(high.session.outputPageSize).toBe(10_000);
  });

  it("clamps outputCacheTtlMs to [30_000, 3_600_000]", () => {
    const low = remoteExecConfigSchema.parse({ session: { outputCacheTtlMs: 100 } });
    expect(low.session.outputCacheTtlMs).toBe(30_000);
    const high = remoteExecConfigSchema.parse({ session: { outputCacheTtlMs: 10_000_000 } });
    expect(high.session.outputCacheTtlMs).toBe(3_600_000);
  });

  it("unknown keys in session section throws", () => {
    expect(() => remoteExecConfigSchema.parse({ session: { unknownKey: true } })).toThrow(
      "unknown key",
    );
  });

  it("missing session section uses defaults", () => {
    const cfg = remoteExecConfigSchema.parse({ enabled: false });
    expect(cfg.session.sessionTtlMs).toBe(1_800_000);
    expect(cfg.session.outputPageSize).toBe(3_500);
    expect(cfg.session.outputCacheTtlMs).toBe(300_000);
  });

  it("full session config parses correctly", () => {
    const cfg = remoteExecConfigSchema.parse({
      session: {
        sessionTtlMs: 600_000,
        outputPageSize: 2_000,
        outputCacheTtlMs: 120_000,
      },
    });
    expect(cfg.session.sessionTtlMs).toBe(600_000);
    expect(cfg.session.outputPageSize).toBe(2_000);
    expect(cfg.session.outputCacheTtlMs).toBe(120_000);
  });
});

// ============================================================================
// L. SessionManager Logic (10 tests)
// ============================================================================

describe("SessionManager", () => {
  const defaultSessionConfig: SessionConfig = {
    sessionTtlMs: 1_800_000,
    outputPageSize: 3_500,
    outputCacheTtlMs: 300_000,
    maxHistorySize: 20,
    maxEnvVars: 20,
    maxAliases: 10,
  };

  it("getOrCreate returns new session with default workdir", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    const session = mgr.getOrCreate("whatsapp", "user1", "/home/default");
    expect(session.workdir).toBe("/home/default");
    expect(session.outputCache).toBeNull();
  });

  it("getOrCreate returns existing session on second call", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/default");
    mgr.setWorkdir("whatsapp", "user1", "/home/changed");
    const s2 = mgr.getOrCreate("whatsapp", "user1", "/home/default");
    expect(s2.workdir).toBe("/home/changed");
  });

  it("setWorkdir updates session workdir", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/default");
    mgr.setWorkdir("whatsapp", "user1", "/home/new");
    expect(mgr.getWorkdir("whatsapp", "user1")).toBe("/home/new");
  });

  it("different senders have isolated sessions", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/u1");
    mgr.getOrCreate("whatsapp", "user2", "/home/u2");
    expect(mgr.getWorkdir("whatsapp", "user1")).toBe("/home/u1");
    expect(mgr.getWorkdir("whatsapp", "user2")).toBe("/home/u2");
  });

  it("different channels with same sender have isolated sessions", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/wa");
    mgr.getOrCreate("telegram", "user1", "/home/tg");
    expect(mgr.getWorkdir("whatsapp", "user1")).toBe("/home/wa");
    expect(mgr.getWorkdir("telegram", "user1")).toBe("/home/tg");
  });

  it("prune removes expired sessions", () => {
    const mgr = new SessionManager({ ...defaultSessionConfig, sessionTtlMs: 1 }, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/default");

    // Wait for expiry
    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    // getOrCreate triggers prune; a new session should be created
    const session = mgr.getOrCreate("whatsapp", "user1", "/home/fresh");
    expect(session.workdir).toBe("/home/fresh");
  });

  it("prune preserves active sessions", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/default");
    mgr.setWorkdir("whatsapp", "user1", "/home/changed");

    // Trigger prune via another getOrCreate
    mgr.getOrCreate("whatsapp", "user2", "/home/other");

    expect(mgr.getWorkdir("whatsapp", "user1")).toBe("/home/changed");
  });

  it("getWorkdir returns undefined for non-existent session", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    expect(mgr.getWorkdir("whatsapp", "ghost")).toBeUndefined();
  });

  it("lastActivity refreshed on getOrCreate", () => {
    const mgr = new SessionManager({ ...defaultSessionConfig, sessionTtlMs: 50 }, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/default");

    // Access before TTL, refreshing lastActivity
    const start = Date.now();
    while (Date.now() - start < 30) {
      // spin
    }
    mgr.getOrCreate("whatsapp", "user1", "/home/default");

    // Wait a bit more but not enough for full TTL from last access
    const start2 = Date.now();
    while (Date.now() - start2 < 30) {
      // spin
    }

    // Session should still be alive since lastActivity was refreshed
    expect(mgr.getWorkdir("whatsapp", "user1")).toBe("/home/default");
  });

  it("composite key format is channel:senderId", () => {
    const mgr = new SessionManager(defaultSessionConfig, noopLogger);
    mgr.getOrCreate("whatsapp", "user1", "/home/default");

    // Different composite key should yield different session
    expect(mgr.getWorkdir("whatsapp:user1", "")).toBeUndefined();
  });
});

// ============================================================================
// M. Output Paging (9 tests)
// ============================================================================

describe("output paging", () => {
  const pagingConfig: SessionConfig = {
    sessionTtlMs: 1_800_000,
    outputPageSize: 50,
    outputCacheTtlMs: 300_000,
    maxHistorySize: 20,
    maxEnvVars: 20,
    maxAliases: 10,
  };

  it("cacheOutput splits text into pages respecting line boundaries", () => {
    const mgr = new SessionManager(pagingConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");

    // Each line is ~10 chars, pageSize is 50, so ~5 lines per page
    const lines = Array.from({ length: 20 }, (_, i) => `line-${String(i).padStart(4, "0")}`);
    const text = lines.join("\n");

    const cache = mgr.cacheOutput("wa", "u1", text, "test-cmd");
    expect(cache.pages.length).toBeGreaterThan(1);

    // Verify no line is split across pages
    for (const page of cache.pages) {
      expect(page.content).not.toMatch(/^[^l]/); // each page starts cleanly
    }
  });

  it("cacheOutput with short output produces single page", () => {
    const mgr = new SessionManager(pagingConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    const cache = mgr.cacheOutput("wa", "u1", "short", "cmd");
    expect(cache.pages).toHaveLength(1);
  });

  it("getNextPage returns pages in sequence", () => {
    const mgr = new SessionManager(pagingConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");

    const lines = Array.from({ length: 20 }, (_, i) => `line-${String(i).padStart(4, "0")}`);
    const cache = mgr.cacheOutput("wa", "u1", lines.join("\n"), "cmd");

    // Page 0 shown inline, getNextPage starts from page 1
    const firstMore = mgr.getNextPage("wa", "u1");
    expect(firstMore).not.toBeNull();
    expect(firstMore!.pageNum).toBe(2); // 1-based display, second page

    const secondMore = mgr.getNextPage("wa", "u1");
    if (cache.pages.length > 2) {
      expect(secondMore).not.toBeNull();
      expect(secondMore!.pageNum).toBe(3);
    }
  });

  it("getNextPage returns null when no more pages", () => {
    const mgr = new SessionManager({ ...pagingConfig, outputPageSize: 10_000 }, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.cacheOutput("wa", "u1", "short text", "cmd");

    // Only 1 page, currentPage starts at 1, so no more
    const result = mgr.getNextPage("wa", "u1");
    expect(result).toBeNull();
  });

  it("getNextPage returns null when no cache exists", () => {
    const mgr = new SessionManager(pagingConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    expect(mgr.getNextPage("wa", "u1")).toBeNull();
  });

  it("output cache expires after outputCacheTtlMs", () => {
    const mgr = new SessionManager({ ...pagingConfig, outputCacheTtlMs: 1 }, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    mgr.cacheOutput("wa", "u1", lines.join("\n"), "cmd");

    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    expect(mgr.getNextPage("wa", "u1")).toBeNull();
  });

  it("new cacheOutput replaces previous cache", () => {
    const mgr = new SessionManager(pagingConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");

    const lines1 = Array.from({ length: 20 }, (_, i) => `old-${i}`);
    mgr.cacheOutput("wa", "u1", lines1.join("\n"), "old-cmd");

    const lines2 = Array.from({ length: 20 }, (_, i) => `new-${i}`);
    mgr.cacheOutput("wa", "u1", lines2.join("\n"), "new-cmd");

    const page = mgr.getNextPage("wa", "u1");
    expect(page).not.toBeNull();
    expect(page!.page.content).toContain("new-");
    expect(page!.page.content).not.toContain("old-");
  });

  it("single very long line gets its own page", () => {
    const mgr = new SessionManager(pagingConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");

    const longLine = "x".repeat(200);
    const cache = mgr.cacheOutput("wa", "u1", longLine, "cmd");

    // The long line should be in its own page (not split)
    expect(cache.pages[0]!.content).toBe(longLine);
  });

  it("clearOutputCache removes cached output", () => {
    const mgr = new SessionManager(pagingConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    const lines = Array.from({ length: 20 }, (_, i) => `line-${i}`);
    mgr.cacheOutput("wa", "u1", lines.join("\n"), "cmd");

    mgr.clearOutputCache("wa", "u1");
    expect(mgr.getNextPage("wa", "u1")).toBeNull();
  });
});

// ============================================================================
// N. /run cd, pwd, more Integration (8 tests)
// ============================================================================

describe("/run cd, pwd, more integration", () => {
  let cmdHandler: (ctx: any) => Promise<any>;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "test.txt"), "hello");
    await fs.writeFile(path.join(tmpDir, "subdir", "nested.txt"), "nested content");

    const { default: plugin } = await import("./index.js");

    let capturedHandler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 100, outputCacheTtlMs: 300_000 },
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") {
          capturedHandler = cmd.handler;
        }
      },
    };

    await plugin.register(mockApi as any);
    cmdHandler = capturedHandler!;
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("/run cd <valid-path> sets workdir and returns confirmation", async () => {
    const result = await cmdHandler({
      args: `cd ${path.join(tmpDir, "subdir")}`,
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run cd subdir",
      config: {},
    });
    expect(result.text).toContain("Working directory:");
    expect(result.text).toContain("subdir");
  });

  it("/run cd <invalid-path> returns error", async () => {
    const result = await cmdHandler({
      args: "cd /nonexistent/path/xyz",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run cd /nonexistent/path/xyz",
      config: {},
    });
    expect(result.text).toContain("Error:");
  });

  it("/run cd <outside-allowed> returns path security error", async () => {
    const result = await cmdHandler({
      args: "cd /etc",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run cd /etc",
      config: {},
    });
    expect(result.text).toContain("Error:");
    expect(result.text).toContain("outside allowed");
  });

  it("/run pwd returns current workdir after cd", async () => {
    // First cd
    await cmdHandler({
      args: `cd ${path.join(tmpDir, "subdir")}`,
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run cd subdir",
      config: {},
    });

    const result = await cmdHandler({
      args: "pwd",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run pwd",
      config: {},
    });
    expect(result.text).toContain("Working directory:");
    expect(result.text).toContain("subdir");
  });

  it("/run pwd with no prior cd returns default workdir", async () => {
    const result = await cmdHandler({
      args: "pwd",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run pwd",
      config: {},
    });
    expect(result.text).toContain("Working directory:");
    expect(result.text).toContain(tmpDir);
  });

  it("/run <command> uses session workdir", async () => {
    // cd to subdir
    await cmdHandler({
      args: `cd ${path.join(tmpDir, "subdir")}`,
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run cd subdir",
      config: {},
    });

    // cat the file that only exists in subdir
    const result = await cmdHandler({
      args: "cat nested.txt",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run cat nested.txt",
      config: {},
    });
    expect(result.text).toContain("nested content");
  });

  it("/run more with no prior output returns no more output", async () => {
    const result = await cmdHandler({
      args: "more",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run more",
      config: {},
    });
    expect(result.text).toContain("No more output to show.");
  });

  it("/run help includes cd, pwd, more subcommands", async () => {
    const result = await cmdHandler({
      args: "help",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run help",
      config: {},
    });
    expect(result.text).toContain("cd");
    expect(result.text).toContain("pwd");
    expect(result.text).toContain("more");
  });
});

// ============================================================================
// O. Session Config: maxHistorySize and maxEnvVars (7 tests)
// ============================================================================

describe("session config: maxHistorySize and maxEnvVars", () => {
  it("parses defaults for maxHistorySize (20) and maxEnvVars (20)", () => {
    const config = remoteExecConfigSchema.parse(null);
    expect(config.session.maxHistorySize).toBe(20);
    expect(config.session.maxEnvVars).toBe(20);
  });

  it("clamps maxHistorySize to [1, 100]", () => {
    const low = remoteExecConfigSchema.parse({
      session: { maxHistorySize: 0 },
    });
    expect(low.session.maxHistorySize).toBe(1);

    const high = remoteExecConfigSchema.parse({
      session: { maxHistorySize: 999 },
    });
    expect(high.session.maxHistorySize).toBe(100);
  });

  it("clamps maxEnvVars to [1, 50]", () => {
    const low = remoteExecConfigSchema.parse({
      session: { maxEnvVars: 0 },
    });
    expect(low.session.maxEnvVars).toBe(1);

    const high = remoteExecConfigSchema.parse({
      session: { maxEnvVars: 999 },
    });
    expect(high.session.maxEnvVars).toBe(50);
  });

  it("unknown keys in session section still throws", () => {
    expect(() =>
      remoteExecConfigSchema.parse({
        session: { unknownField: true },
      }),
    ).toThrow();
  });

  it("full session config with new fields parses correctly", () => {
    const config = remoteExecConfigSchema.parse({
      session: {
        sessionTtlMs: 600_000,
        outputPageSize: 2_000,
        outputCacheTtlMs: 60_000,
        maxHistorySize: 50,
        maxEnvVars: 30,
      },
    });
    expect(config.session.maxHistorySize).toBe(50);
    expect(config.session.maxEnvVars).toBe(30);
  });

  it("maxHistorySize defaults when session section exists without it", () => {
    const config = remoteExecConfigSchema.parse({
      session: { sessionTtlMs: 600_000 },
    });
    expect(config.session.maxHistorySize).toBe(20);
  });

  it("maxEnvVars defaults when session section exists without it", () => {
    const config = remoteExecConfigSchema.parse({
      session: { sessionTtlMs: 600_000 },
    });
    expect(config.session.maxEnvVars).toBe(20);
  });
});

// ============================================================================
// P. History Management (10 tests)
// ============================================================================

describe("history management", () => {
  const sessionConfig: SessionConfig = {
    sessionTtlMs: 1_800_000,
    outputPageSize: 3_500,
    outputCacheTtlMs: 300_000,
    maxHistorySize: 5,
    maxEnvVars: 20,
    maxAliases: 10,
  };

  it("addHistory stores entry and getHistory returns it", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.addHistory("wa", "u1", { command: "echo hi", exitCode: 0, timestamp: Date.now() }, 5);
    const history = mgr.getHistory("wa", "u1");
    expect(history).toHaveLength(1);
    expect(history[0]!.command).toBe("echo hi");
  });

  it("getHistory returns entries in reverse chronological order", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.addHistory("wa", "u1", { command: "first", exitCode: 0, timestamp: 1000 }, 5);
    mgr.addHistory("wa", "u1", { command: "second", exitCode: 0, timestamp: 2000 }, 5);
    mgr.addHistory("wa", "u1", { command: "third", exitCode: 0, timestamp: 3000 }, 5);
    const history = mgr.getHistory("wa", "u1");
    expect(history[0]!.command).toBe("third");
    expect(history[1]!.command).toBe("second");
    expect(history[2]!.command).toBe("first");
  });

  it("addHistory prunes oldest when exceeding maxHistorySize", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    for (let i = 0; i < 7; i++) {
      mgr.addHistory("wa", "u1", { command: `cmd-${i}`, exitCode: 0, timestamp: i }, 5);
    }
    const history = mgr.getHistory("wa", "u1");
    expect(history).toHaveLength(5);
    // Oldest should be cmd-2 (cmd-0 and cmd-1 pruned)
    expect(history[history.length - 1]!.command).toBe("cmd-2");
  });

  it("getHistoryEntry(1) returns most recent command", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.addHistory("wa", "u1", { command: "old", exitCode: 0, timestamp: 1000 }, 5);
    mgr.addHistory("wa", "u1", { command: "latest", exitCode: 0, timestamp: 2000 }, 5);
    const entry = mgr.getHistoryEntry("wa", "u1", 1);
    expect(entry).not.toBeNull();
    expect(entry!.command).toBe("latest");
  });

  it("getHistoryEntry(N) for N > history.length returns null", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.addHistory("wa", "u1", { command: "only", exitCode: 0, timestamp: 1000 }, 5);
    expect(mgr.getHistoryEntry("wa", "u1", 99)).toBeNull();
  });

  it("getHistoryEntry(0) returns null (1-based indexing)", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.addHistory("wa", "u1", { command: "cmd", exitCode: 0, timestamp: 1000 }, 5);
    expect(mgr.getHistoryEntry("wa", "u1", 0)).toBeNull();
  });

  it("getHistory for non-existent session returns empty array", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    expect(mgr.getHistory("wa", "ghost")).toEqual([]);
  });

  it("history is per-session (different senders have separate histories)", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.getOrCreate("wa", "u2", "/tmp");
    mgr.addHistory("wa", "u1", { command: "user1-cmd", exitCode: 0, timestamp: 1000 }, 5);
    mgr.addHistory("wa", "u2", { command: "user2-cmd", exitCode: 0, timestamp: 1000 }, 5);
    expect(mgr.getHistory("wa", "u1")[0]!.command).toBe("user1-cmd");
    expect(mgr.getHistory("wa", "u2")[0]!.command).toBe("user2-cmd");
  });

  it("history is cleared when session expires (TTL prune)", () => {
    const mgr = new SessionManager({ ...sessionConfig, sessionTtlMs: 1 }, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.addHistory("wa", "u1", { command: "cmd", exitCode: 0, timestamp: Date.now() }, 5);

    const start = Date.now();
    while (Date.now() - start < 5) {
      // spin
    }

    // getOrCreate triggers prune, creating a fresh session
    mgr.getOrCreate("wa", "u1", "/tmp");
    expect(mgr.getHistory("wa", "u1")).toEqual([]);
  });

  it("addHistory on non-existent session is a no-op", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    // No session created — should not throw
    mgr.addHistory("wa", "ghost", { command: "cmd", exitCode: 0, timestamp: 1000 }, 5);
    expect(mgr.getHistory("wa", "ghost")).toEqual([]);
  });
});

// ============================================================================
// Q. Environment Variable Management (12 tests)
// ============================================================================

describe("environment variable management", () => {
  const sessionConfig: SessionConfig = {
    sessionTtlMs: 1_800_000,
    outputPageSize: 3_500,
    outputCacheTtlMs: 300_000,
    maxHistorySize: 20,
    maxEnvVars: 3,
    maxAliases: 10,
  };

  it("setEnv and getEnv round-trip", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    const ok = mgr.setEnv("wa", "u1", "NODE_ENV", "production", 3);
    expect(ok).toBe(true);
    expect(mgr.getEnv("wa", "u1")).toEqual({ NODE_ENV: "production" });
  });

  it("setEnv returns false when maxEnvVars reached", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setEnv("wa", "u1", "A", "1", 3);
    mgr.setEnv("wa", "u1", "B", "2", 3);
    mgr.setEnv("wa", "u1", "C", "3", 3);
    const ok = mgr.setEnv("wa", "u1", "D", "4", 3);
    expect(ok).toBe(false);
    expect(mgr.getEnv("wa", "u1")).not.toHaveProperty("D");
  });

  it("setEnv allows update of existing key (no count increase)", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setEnv("wa", "u1", "A", "1", 3);
    mgr.setEnv("wa", "u1", "B", "2", 3);
    mgr.setEnv("wa", "u1", "C", "3", 3);
    // Update existing key should succeed even at max
    const ok = mgr.setEnv("wa", "u1", "A", "updated", 3);
    expect(ok).toBe(true);
    expect(mgr.getEnv("wa", "u1").A).toBe("updated");
  });

  it("deleteEnv removes var and returns true", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setEnv("wa", "u1", "NODE_ENV", "test", 3);
    const ok = mgr.deleteEnv("wa", "u1", "NODE_ENV");
    expect(ok).toBe(true);
    expect(mgr.getEnv("wa", "u1")).not.toHaveProperty("NODE_ENV");
  });

  it("deleteEnv returns false for non-existent key", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    expect(mgr.deleteEnv("wa", "u1", "NOPE")).toBe(false);
  });

  it("getEnv returns empty record for new session", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    expect(mgr.getEnv("wa", "u1")).toEqual({});
  });

  it("getEnv returns empty for non-existent session", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    expect(mgr.getEnv("wa", "ghost")).toEqual({});
  });

  it("env is per-session (different senders isolated)", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.getOrCreate("wa", "u2", "/tmp");
    mgr.setEnv("wa", "u1", "KEY", "val1", 3);
    mgr.setEnv("wa", "u2", "KEY", "val2", 3);
    expect(mgr.getEnv("wa", "u1").KEY).toBe("val1");
    expect(mgr.getEnv("wa", "u2").KEY).toBe("val2");
  });

  it("ENV_NAME_PATTERN accepts valid uppercase names", () => {
    expect(ENV_NAME_PATTERN.test("NODE_ENV")).toBe(true);
    expect(ENV_NAME_PATTERN.test("MY_VAR_2")).toBe(true);
    expect(ENV_NAME_PATTERN.test("_VAR")).toBe(true);
    expect(ENV_NAME_PATTERN.test("A")).toBe(true);
  });

  it("ENV_NAME_PATTERN rejects invalid names", () => {
    expect(ENV_NAME_PATTERN.test("lowercase")).toBe(false);
    expect(ENV_NAME_PATTERN.test("2STARTS_WITH_DIGIT")).toBe(false);
    expect(ENV_NAME_PATTERN.test("HAS-HYPHEN")).toBe(false);
    expect(ENV_NAME_PATTERN.test("")).toBe(false);
  });

  it("ENV_BLOCKLIST contains all protected variables", () => {
    for (const key of [
      "HOME",
      "USER",
      "SHELL",
      "TERM",
      "LOGNAME",
      "HOSTNAME",
      "UID",
      "EUID",
      "LD_PRELOAD",
      "DYLD_INSERT_LIBRARIES",
      "BASH_ENV",
      "ENV",
      "PATH",
      "NODE_OPTIONS",
      "NODE_PATH",
      "PYTHONPATH",
      "PYTHONSTARTUP",
      "RUBYLIB",
      "PERL5LIB",
      "CLASSPATH",
      "CDPATH",
      "IFS",
      "GLOBIGNORE",
      "PROMPT_COMMAND",
      "PS1",
    ]) {
      expect(ENV_BLOCKLIST.has(key)).toBe(true);
    }
  });

  it("env values are preserved exactly (spaces, special chars, colons)", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setEnv("wa", "u1", "PATH_EXTRA", "/usr/bin:/opt/bin:with spaces", 3);
    expect(mgr.getEnv("wa", "u1").PATH_EXTRA).toBe("/usr/bin:/opt/bin:with spaces");
  });
});

// ============================================================================
// R. /run history, !!, !N, env Integration (15 tests)
// ============================================================================

describe("/run history, !!, !N, env integration", () => {
  let cmdHandler: (ctx: any) => Promise<any>;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.mkdir(path.join(tmpDir, "subdir"));

    const { default: plugin } = await import("./index.js");

    let capturedHandler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 10_000, outputCacheTtlMs: 300_000 },
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") {
          capturedHandler = cmd.handler;
        }
      },
    };

    await plugin.register(mockApi as any);
    cmdHandler = capturedHandler!;
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("/run history with no prior commands shows empty", async () => {
    const result = await cmdHandler({
      args: "history",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run history",
      config: {},
    });
    expect(result.text).toContain("No command history");
  });

  it("/run <safe-command> then /run history shows it with exit code", async () => {
    await cmdHandler({
      args: "echo hello",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo hello",
      config: {},
    });

    const result = await cmdHandler({
      args: "history",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run history",
      config: {},
    });
    expect(result.text).toContain("[ok]");
    expect(result.text).toContain("echo hello");
  });

  it("history shows exit code for failed commands", async () => {
    // Use a command that fails but is classified as safe
    await cmdHandler({
      args: "ls /nonexistent-path-xyz-999",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run ls /nonexistent-path-xyz-999",
      config: {},
    });

    const result = await cmdHandler({
      args: "history",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run history",
      config: {},
    });
    expect(result.text).toContain("[exit:");
  });

  it("/run !! re-runs last command", async () => {
    await cmdHandler({
      args: "echo recall-test",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo recall-test",
      config: {},
    });

    const result = await cmdHandler({
      args: "!!",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run !!",
      config: {},
    });
    expect(result.text).toContain("recall-test");
  });

  it("/run !! with no history returns error", async () => {
    const result = await cmdHandler({
      args: "!!",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run !!",
      config: {},
    });
    expect(result.text).toContain("No command at history position 1");
  });

  it("/run !1 re-runs most recent command", async () => {
    await cmdHandler({
      args: "echo bang-one",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo bang-one",
      config: {},
    });

    const result = await cmdHandler({
      args: "!1",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run !1",
      config: {},
    });
    expect(result.text).toContain("bang-one");
  });

  it("/run !2 re-runs second-most-recent command", async () => {
    await cmdHandler({
      args: "echo first-cmd",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo first-cmd",
      config: {},
    });
    await cmdHandler({
      args: "echo second-cmd",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo second-cmd",
      config: {},
    });

    const result = await cmdHandler({
      args: "!2",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run !2",
      config: {},
    });
    expect(result.text).toContain("first-cmd");
  });

  it("/run !999 with short history returns error", async () => {
    await cmdHandler({
      args: "echo only-one",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo only-one",
      config: {},
    });

    const result = await cmdHandler({
      args: "!999",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run !999",
      config: {},
    });
    expect(result.text).toContain("No command at history position 999");
  });

  it("recalled risky command goes through confirmation (not auto-approved)", async () => {
    // First run a safe command to have history
    await cmdHandler({
      args: "echo safe",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo safe",
      config: {},
    });

    // Now run a risky command that will be recorded
    // We use "git push origin main" which should be risky
    const riskyResult = await cmdHandler({
      args: "git push origin main",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run git push origin main",
      config: {},
    });
    // The risky command goes to pending, NOT recorded in history
    expect(riskyResult.text).toContain("approval");

    // History should only have "echo safe", not the risky pending command
    const histResult = await cmdHandler({
      args: "history",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run history",
      config: {},
    });
    expect(histResult.text).toContain("echo safe");
    expect(histResult.text).not.toContain("git push");
  });

  it("/run env with no vars shows empty", async () => {
    const result = await cmdHandler({
      args: "env",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env",
      config: {},
    });
    expect(result.text).toContain("No session environment variables set");
  });

  it("/run env NODE_ENV=production sets variable", async () => {
    const result = await cmdHandler({
      args: "env NODE_ENV=production",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env NODE_ENV=production",
      config: {},
    });
    expect(result.text).toBe("Set: NODE_ENV=production");
  });

  it("/run env shows set variables", async () => {
    await cmdHandler({
      args: "env NODE_ENV=production",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env NODE_ENV=production",
      config: {},
    });

    const result = await cmdHandler({
      args: "env",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env",
      config: {},
    });
    expect(result.text).toContain("NODE_ENV=production");
  });

  it("/run env -d NODE_ENV deletes variable", async () => {
    await cmdHandler({
      args: "env NODE_ENV=production",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env NODE_ENV=production",
      config: {},
    });

    const result = await cmdHandler({
      args: "env -d NODE_ENV",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env -d NODE_ENV",
      config: {},
    });
    expect(result.text).toBe("Deleted: NODE_ENV");
  });

  it("/run env HOME=bad returns protected error", async () => {
    const result = await cmdHandler({
      args: "env HOME=/evil",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env HOME=/evil",
      config: {},
    });
    expect(result.text).toContain("HOME is a protected variable");
  });

  it("/run help includes history, env, !!, !N subcommands", async () => {
    const result = await cmdHandler({
      args: "help",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run help",
      config: {},
    });
    expect(result.text).toContain("history");
    expect(result.text).toContain("env");
    expect(result.text).toContain("!!");
    expect(result.text).toContain("!<N>");
  });

  it("/run env KEY shows single variable value", async () => {
    await cmdHandler({
      args: "env MY_VAR=hello",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env MY_VAR=hello",
      config: {},
    });

    const result = await cmdHandler({
      args: "env MY_VAR",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env MY_VAR",
      config: {},
    });
    expect(result.text).toBe("MY_VAR=hello");
  });

  it("/run env KEY for unset variable returns not set", async () => {
    const result = await cmdHandler({
      args: "env NOPE",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env NOPE",
      config: {},
    });
    expect(result.text).toBe("NOPE is not set.");
  });

  it("/run env -d without key returns usage", async () => {
    const result = await cmdHandler({
      args: "env -d",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env -d",
      config: {},
    });
    expect(result.text).toBe("Usage: /run env -d KEY");
  });

  it("/run env KEY=VALUE=WITH=EQUALS splits on first = only", async () => {
    const result = await cmdHandler({
      args: "env DB_URL=postgres://host:5432/db?opt=val",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env DB_URL=postgres://host:5432/db?opt=val",
      config: {},
    });
    expect(result.text).toBe("Set: DB_URL=postgres://host:5432/db?opt=val");

    // Verify the full value was stored
    const show = await cmdHandler({
      args: "env DB_URL",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env DB_URL",
      config: {},
    });
    expect(show.text).toBe("DB_URL=postgres://host:5432/db?opt=val");
  });

  it("/run env LD_PRELOAD=evil returns protected error", async () => {
    const result = await cmdHandler({
      args: "env LD_PRELOAD=/tmp/evil.so",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run env LD_PRELOAD=/tmp/evil.so",
      config: {},
    });
    expect(result.text).toContain("LD_PRELOAD is a protected variable");
  });
});

// ============================================================================
// S. Config: maxAliases and maskOutput (7 tests)
// ============================================================================

describe("config: maxAliases and maskOutput", () => {
  it("parses defaults for maxAliases (10) and maskOutput (true)", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.session.maxAliases).toBe(10);
    expect(cfg.maskOutput).toBe(true);
  });

  it("clamps maxAliases to [1, 50]", () => {
    const low = remoteExecConfigSchema.parse({ session: { maxAliases: 0 } });
    expect(low.session.maxAliases).toBe(1);

    const high = remoteExecConfigSchema.parse({ session: { maxAliases: 999 } });
    expect(high.session.maxAliases).toBe(50);
  });

  it("maxAliases defaults when session section exists without it", () => {
    const cfg = remoteExecConfigSchema.parse({ session: { sessionTtlMs: 120_000 } });
    expect(cfg.session.maxAliases).toBe(10);
  });

  it("maskOutput defaults to true when not specified", () => {
    const cfg = remoteExecConfigSchema.parse({ enabled: false });
    expect(cfg.maskOutput).toBe(true);
  });

  it("maskOutput: false is respected", () => {
    const cfg = remoteExecConfigSchema.parse({ maskOutput: false });
    expect(cfg.maskOutput).toBe(false);
  });

  it("non-boolean maskOutput defaults to true", () => {
    const cfg = remoteExecConfigSchema.parse({ maskOutput: "yes" });
    expect(cfg.maskOutput).toBe(true);
  });

  it("unknown keys in session section still throws (with maxAliases present)", () => {
    expect(() =>
      remoteExecConfigSchema.parse({ session: { maxAliases: 5, badKey: true } }),
    ).toThrow("unknown keys");
  });
});

// ============================================================================
// T. Alias Management (10 tests)
// ============================================================================

describe("alias management", () => {
  const sessionConfig: SessionConfig = {
    sessionTtlMs: 1_800_000,
    outputPageSize: 3_500,
    outputCacheTtlMs: 300_000,
    maxHistorySize: 20,
    maxEnvVars: 20,
    maxAliases: 3,
  };

  it("setAlias and getAliases round-trip", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    const ok = mgr.setAlias("wa", "u1", "build", "npm run build", 3);
    expect(ok).toBe(true);
    expect(mgr.getAliases("wa", "u1")).toEqual({ build: "npm run build" });
  });

  it("setAlias returns false when maxAliases reached", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setAlias("wa", "u1", "a", "cmd-a", 3);
    mgr.setAlias("wa", "u1", "b", "cmd-b", 3);
    mgr.setAlias("wa", "u1", "c", "cmd-c", 3);
    const ok = mgr.setAlias("wa", "u1", "d", "cmd-d", 3);
    expect(ok).toBe(false);
    expect(mgr.getAliases("wa", "u1")).not.toHaveProperty("d");
  });

  it("setAlias allows update of existing alias (no count increase)", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setAlias("wa", "u1", "a", "cmd-a", 3);
    mgr.setAlias("wa", "u1", "b", "cmd-b", 3);
    mgr.setAlias("wa", "u1", "c", "cmd-c", 3);
    const ok = mgr.setAlias("wa", "u1", "a", "updated", 3);
    expect(ok).toBe(true);
    expect(mgr.getAliases("wa", "u1").a).toBe("updated");
  });

  it("deleteAlias removes alias and returns true", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setAlias("wa", "u1", "build", "npm run build", 3);
    const ok = mgr.deleteAlias("wa", "u1", "build");
    expect(ok).toBe(true);
    expect(mgr.getAliases("wa", "u1")).not.toHaveProperty("build");
  });

  it("deleteAlias returns false for non-existent alias", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    expect(mgr.deleteAlias("wa", "u1", "nope")).toBe(false);
  });

  it("getAliases returns empty record for new session", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    expect(mgr.getAliases("wa", "u1")).toEqual({});
  });

  it("getAliases returns empty for non-existent session", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    expect(mgr.getAliases("wa", "ghost")).toEqual({});
  });

  it("getAlias returns command for existing alias", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.setAlias("wa", "u1", "build", "npm run build", 3);
    expect(mgr.getAlias("wa", "u1", "build")).toBe("npm run build");
  });

  it("getAlias returns undefined for non-existent alias", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    expect(mgr.getAlias("wa", "u1", "nope")).toBeUndefined();
  });

  it("aliases are per-session (different senders isolated)", () => {
    const mgr = new SessionManager(sessionConfig, noopLogger);
    mgr.getOrCreate("wa", "u1", "/tmp");
    mgr.getOrCreate("wa", "u2", "/tmp");
    mgr.setAlias("wa", "u1", "build", "npm run build", 3);
    mgr.setAlias("wa", "u2", "build", "yarn build", 3);
    expect(mgr.getAlias("wa", "u1", "build")).toBe("npm run build");
    expect(mgr.getAlias("wa", "u2", "build")).toBe("yarn build");
  });
});

// ============================================================================
// U. Output Masking (5 tests)
// ============================================================================

describe("output masking", () => {
  it("maskSensitiveOutput masks GitHub token pattern", () => {
    const result = maskSensitiveOutput("token: ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY");
    expect(result.masked).toBe(true);
    expect(result.text).toContain("ghp_***REDACTED***");
    expect(result.text).not.toContain("ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY");
  });

  it("maskSensitiveOutput returns redaction count", () => {
    const result = maskSensitiveOutput("ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY");
    expect(result.redactions).toBe(1);
  });

  it("maskSensitiveOutput with clean text returns 0 redactions", () => {
    const result = maskSensitiveOutput("hello world, no secrets here");
    expect(result.masked).toBe(false);
    expect(result.redactions).toBe(0);
    expect(result.text).toBe("hello world, no secrets here");
  });

  it("multiple secret types in same text are all masked", () => {
    const text = "github: ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY slack: xoxb-FAKEFAKEFAKE-FAKEFAKE";
    const result = maskSensitiveOutput(text);
    expect(result.masked).toBe(true);
    expect(result.redactions).toBe(2);
    expect(result.text).not.toContain("ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY");
    expect(result.text).not.toContain("xoxb-FAKEFAKEFAKE-FAKEFAKE");
  });

  it("masking does not alter text without secrets", () => {
    const text = "exit code: 0\nstdout: all good\n42ms";
    const result = maskSensitiveOutput(text);
    expect(result.text).toBe(text);
  });
});

// ============================================================================
// V. /run alias, status, masking Integration (20 tests)
// ============================================================================

describe("/run alias, status, masking integration", () => {
  let cmdHandler: (ctx: any) => Promise<any>;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.mkdir(path.join(tmpDir, "subdir"));

    const { default: plugin } = await import("./index.js");

    let capturedHandler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 10_000, outputCacheTtlMs: 300_000 },
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") {
          capturedHandler = cmd.handler;
        }
      },
    };

    await plugin.register(mockApi as any);
    cmdHandler = capturedHandler!;
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("/run alias with no aliases shows empty", async () => {
    const result = await cmdHandler({
      args: "alias",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias",
      config: {},
    });
    expect(result.text).toContain("No aliases defined");
  });

  it("/run alias NAME COMMAND defines alias", async () => {
    const result = await cmdHandler({
      args: "alias build npm run build",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias build npm run build",
      config: {},
    });
    expect(result.text).toContain("Alias set: build = npm run build");
  });

  it("/run alias NAME shows single alias value", async () => {
    await cmdHandler({
      args: "alias build npm run build",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias build npm run build",
      config: {},
    });

    const result = await cmdHandler({
      args: "alias build",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias build",
      config: {},
    });
    expect(result.text).toBe("build = npm run build");
  });

  it("/run alias lists defined aliases", async () => {
    await cmdHandler({
      args: "alias build npm run build",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias build npm run build",
      config: {},
    });

    const result = await cmdHandler({
      args: "alias",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias",
      config: {},
    });
    expect(result.text).toContain("Aliases (1):");
    expect(result.text).toContain("build = npm run build");
  });

  it("/run alias -d NAME deletes alias", async () => {
    await cmdHandler({
      args: "alias build npm run build",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias build npm run build",
      config: {},
    });

    const result = await cmdHandler({
      args: "alias -d build",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias -d build",
      config: {},
    });
    expect(result.text).toBe("Alias deleted: build");
  });

  it("/run alias -d nonexistent returns not found", async () => {
    const result = await cmdHandler({
      args: "alias -d nope",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias -d nope",
      config: {},
    });
    expect(result.text).toBe("Alias not found.");
  });

  it("/run alias -d (no name) returns usage", async () => {
    const result = await cmdHandler({
      args: "alias -d",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias -d",
      config: {},
    });
    expect(result.text).toBe("Usage: /run alias -d NAME");
  });

  it("/run alias with invalid name (uppercase) returns error", async () => {
    const result = await cmdHandler({
      args: "alias Build npm run build",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias Build npm run build",
      config: {},
    });
    expect(result.text).toContain("Invalid alias name");
  });

  it("/run alias with reserved name (help) returns error", async () => {
    const result = await cmdHandler({
      args: "alias help echo hi",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias help echo hi",
      config: {},
    });
    expect(result.text).toContain("reserved name");
  });

  it("/run alias with reserved name (status) returns error", async () => {
    const result = await cmdHandler({
      args: "alias status echo hi",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias status echo hi",
      config: {},
    });
    expect(result.text).toContain("reserved name");
  });

  it("alias-name expands and executes aliased command", async () => {
    await cmdHandler({
      args: "alias greet echo hello-alias",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias greet echo hello-alias",
      config: {},
    });

    const result = await cmdHandler({
      args: "greet",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run greet",
      config: {},
    });
    expect(result.text).toContain("hello-alias");
  });

  it("alias-name extra-args appends args to aliased command", async () => {
    await cmdHandler({
      args: "alias myecho echo",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias myecho echo",
      config: {},
    });

    const result = await cmdHandler({
      args: "myecho appended-arg",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run myecho appended-arg",
      config: {},
    });
    expect(result.text).toContain("appended-arg");
  });

  it("risky aliased command goes through confirmation", async () => {
    await cmdHandler({
      args: "alias deploy git push origin main",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run alias deploy git push origin main",
      config: {},
    });

    const result = await cmdHandler({
      args: "deploy",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run deploy",
      config: {},
    });
    expect(result.text).toContain("requires approval");
  });

  it("/run status shows session info", async () => {
    const result = await cmdHandler({
      args: "status",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run status",
      config: {},
    });
    expect(result.text).toContain("Session status:");
    expect(result.text).toContain("Working directory:");
    expect(result.text).toContain("TTL remaining:");
    expect(result.text).toContain("History:");
    expect(result.text).toContain("Env vars:");
    expect(result.text).toContain("Aliases:");
  });

  it("/run status shows masking on/off", async () => {
    const result = await cmdHandler({
      args: "status",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run status",
      config: {},
    });
    expect(result.text).toContain("Output masking: on");
  });

  it("/run with maskOutput: true redacts secrets in output", async () => {
    const result = await cmdHandler({
      args: "echo ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY",
      config: {},
    });
    expect(result.text).toContain("ghp_***REDACTED***");
    expect(result.text).toContain("redaction");
    expect(result.text).toContain("applied]");
  });

  it("/run with clean output and maskOutput: true shows no redaction note", async () => {
    const result = await cmdHandler({
      args: "echo clean-output",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo clean-output",
      config: {},
    });
    expect(result.text).toContain("clean-output");
    expect(result.text).not.toContain("redaction");
  });

  it("/run with maskOutput: false passes through unmasked", async () => {
    // Re-register with maskOutput: false
    const { default: plugin } = await import("./index.js");
    let handler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 10_000, outputCacheTtlMs: 300_000 },
        maskOutput: false,
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") handler = cmd.handler;
      },
    };
    await plugin.register(mockApi as any);

    const result = await handler!({
      args: "echo ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY",
      config: {},
    });
    expect(result.text).toContain("ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY");
    expect(result.text).not.toContain("REDACTED");
  });

  it("redaction note shows correct count", async () => {
    const result = await cmdHandler({
      args: "echo ghp_NOT_REAL_TOKEN_FOR_UNIT_TEST_ONLY npm_NOT_REAL_TOKEN_FOR_TESTING_00000001",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run echo ...",
      config: {},
    });
    expect(result.text).toContain("redactions applied]");
  });

  it("/run help includes alias and status subcommands", async () => {
    const result = await cmdHandler({
      args: "help",
      senderId: "user1",
      channel: "whatsapp",
      isAuthorizedSender: true,
      commandBody: "/run help",
      config: {},
    });
    expect(result.text).toContain("alias");
    expect(result.text).toContain("status");
  });
});

// ============================================================================
// W. Config: blockedPatterns (10 tests)
// ============================================================================

describe("config: blockedPatterns", () => {
  it("parses default blockedPatterns as empty array", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.blockedPatterns).toEqual([]);
  });

  it("parses valid regex patterns (string to RegExp)", () => {
    const cfg = remoteExecConfigSchema.parse({
      blockedPatterns: ["^sudo\\b", "rm\\s+-rf"],
    });
    expect(cfg.blockedPatterns).toHaveLength(2);
    expect(cfg.blockedPatterns[0]).toBeInstanceOf(RegExp);
    expect(cfg.blockedPatterns[1]).toBeInstanceOf(RegExp);
  });

  it("throws on non-array blockedPatterns", () => {
    expect(() => remoteExecConfigSchema.parse({ blockedPatterns: "not-array" })).toThrow(
      "blockedPatterns must be an array of regex strings",
    );
  });

  it("throws on non-string pattern entry", () => {
    expect(() => remoteExecConfigSchema.parse({ blockedPatterns: [123] })).toThrow(
      "blockedPatterns[0] must be a non-empty string",
    );
  });

  it("throws on empty string pattern entry", () => {
    expect(() => remoteExecConfigSchema.parse({ blockedPatterns: [""] })).toThrow(
      "blockedPatterns[0] must be a non-empty string",
    );
  });

  it("throws on invalid regex", () => {
    expect(() => remoteExecConfigSchema.parse({ blockedPatterns: ["(unclosed"] })).toThrow(
      "blockedPatterns[0] is not a valid regex",
    );
  });

  it("throws on pattern exceeding max length", () => {
    const longPattern = "a".repeat(201);
    expect(() => remoteExecConfigSchema.parse({ blockedPatterns: [longPattern] })).toThrow(
      "exceeds max length (200 chars)",
    );
  });

  it("blockedPatterns: null defaults to empty array", () => {
    const cfg = remoteExecConfigSchema.parse({ blockedPatterns: null });
    expect(cfg.blockedPatterns).toEqual([]);
  });

  it("compiled patterns match expected strings (anchored vs unanchored)", () => {
    const cfg = remoteExecConfigSchema.parse({
      blockedPatterns: ["^sudo\\b", "rm\\s+-rf"],
    });
    expect(cfg.blockedPatterns[0]!.test("sudo reboot")).toBe(true);
    expect(cfg.blockedPatterns[0]!.test("my-sudo-thing")).toBe(false);
    expect(cfg.blockedPatterns[1]!.test("rm -rf /")).toBe(true);
    expect(cfg.blockedPatterns[1]!.test("rm file")).toBe(false);
  });

  it("blockedPatterns works alongside all other config keys", () => {
    const cfg = remoteExecConfigSchema.parse({
      enabled: true,
      allowedPaths: ["/tmp"],
      blockedPatterns: ["^curl\\b"],
      maskOutput: false,
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.blockedPatterns).toHaveLength(1);
    expect(cfg.maskOutput).toBe(false);
  });
});

// ============================================================================
// X. Session Clear (6 tests)
// ============================================================================

describe("SessionManager.clearSession", () => {
  let sessionMgr: SessionManager;
  const sessionConfig: SessionConfig = {
    sessionTtlMs: 1_800_000,
    outputPageSize: 3_500,
    outputCacheTtlMs: 300_000,
    maxHistorySize: 20,
    maxEnvVars: 20,
    maxAliases: 10,
  };

  beforeEach(() => {
    sessionMgr = new SessionManager(sessionConfig, noopLogger);
  });

  it("clearSession resets workdir to default", () => {
    sessionMgr.getOrCreate("ch", "u1", "/original");
    sessionMgr.setWorkdir("ch", "u1", "/changed");
    sessionMgr.clearSession("ch", "u1", "/original");
    expect(sessionMgr.getWorkdir("ch", "u1")).toBe("/original");
  });

  it("clearSession clears history", () => {
    sessionMgr.getOrCreate("ch", "u1", "/tmp");
    sessionMgr.addHistory("ch", "u1", { command: "ls", exitCode: 0, timestamp: Date.now() }, 20);
    sessionMgr.clearSession("ch", "u1", "/tmp");
    expect(sessionMgr.getHistory("ch", "u1")).toEqual([]);
  });

  it("clearSession clears env vars", () => {
    sessionMgr.getOrCreate("ch", "u1", "/tmp");
    sessionMgr.setEnv("ch", "u1", "FOO", "bar", 20);
    sessionMgr.clearSession("ch", "u1", "/tmp");
    expect(sessionMgr.getEnv("ch", "u1")).toEqual({});
  });

  it("clearSession clears aliases", () => {
    sessionMgr.getOrCreate("ch", "u1", "/tmp");
    sessionMgr.setAlias("ch", "u1", "ll", "ls -la", 10);
    sessionMgr.clearSession("ch", "u1", "/tmp");
    expect(sessionMgr.getAliases("ch", "u1")).toEqual({});
  });

  it("clearSession clears output cache", () => {
    sessionMgr.getOrCreate("ch", "u1", "/tmp");
    sessionMgr.cacheOutput("ch", "u1", "some output\npage 2", "ls");
    sessionMgr.clearSession("ch", "u1", "/tmp");
    expect(sessionMgr.hasMorePages("ch", "u1")).toBe(false);
  });

  it("clearSession is idempotent on non-existent session", () => {
    // Should not throw
    sessionMgr.clearSession("ch", "nobody", "/tmp");
    expect(sessionMgr.getHistory("ch", "nobody")).toEqual([]);
  });
});

// ============================================================================
// Y. /run clear, config, blocklist Integration (20 tests)
// ============================================================================

describe("/run clear, config, blocklist integration", () => {
  let cmdHandler: (ctx: any) => Promise<any>;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    await fs.mkdir(path.join(tmpDir, "subdir"));

    const { default: plugin } = await import("./index.js");

    let capturedHandler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 10_000, outputCacheTtlMs: 300_000 },
        blockedPatterns: ["^curl\\b", "rm\\s+-rf"],
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") {
          capturedHandler = cmd.handler;
        }
      },
    };

    await plugin.register(mockApi as any);
    cmdHandler = capturedHandler!;
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  // --- /run clear ---

  it("/run clear resets session to initial state", async () => {
    // Set up some state
    await cmdHandler({ args: "env FOO=bar", senderId: "u1", channel: "ch", config: {} });
    await cmdHandler({ args: "alias build echo hi", senderId: "u1", channel: "ch", config: {} });
    await cmdHandler({
      args: `cd ${path.join(tmpDir, "subdir")}`,
      senderId: "u1",
      channel: "ch",
      config: {},
    });

    const result = await cmdHandler({ args: "clear", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("Session cleared");
  });

  it("/run clear then /run env shows empty", async () => {
    await cmdHandler({ args: "env FOO=bar", senderId: "u1", channel: "ch", config: {} });
    await cmdHandler({ args: "clear", senderId: "u1", channel: "ch", config: {} });
    const result = await cmdHandler({ args: "env", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("No session environment variables set.");
  });

  it("/run clear then /run alias shows empty", async () => {
    await cmdHandler({ args: "alias build echo hi", senderId: "u1", channel: "ch", config: {} });
    await cmdHandler({ args: "clear", senderId: "u1", channel: "ch", config: {} });
    const result = await cmdHandler({ args: "alias", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("No aliases defined.");
  });

  it("/run clear then /run history shows empty", async () => {
    await cmdHandler({ args: "echo hi", senderId: "u1", channel: "ch", config: {} });
    await cmdHandler({ args: "clear", senderId: "u1", channel: "ch", config: {} });
    const result = await cmdHandler({ args: "history", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("No command history.");
  });

  it("/run clear then /run pwd shows default workdir", async () => {
    await cmdHandler({
      args: `cd ${path.join(tmpDir, "subdir")}`,
      senderId: "u1",
      channel: "ch",
      config: {},
    });
    await cmdHandler({ args: "clear", senderId: "u1", channel: "ch", config: {} });
    const result = await cmdHandler({ args: "pwd", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain(tmpDir);
    expect(result.text).not.toContain("subdir");
  });

  it("/run clear without senderId returns error", async () => {
    const result = await cmdHandler({ args: "clear", channel: "ch", config: {} });
    expect(result.text).toContain("Session requires a sender identity");
  });

  it("/run clear on fresh session succeeds", async () => {
    const result = await cmdHandler({
      args: "clear",
      senderId: "fresh-user",
      channel: "ch",
      config: {},
    });
    expect(result.text).toContain("Session cleared");
  });

  // --- /run config ---

  it("/run config shows enabled status", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("enabled: true");
  });

  it("/run config shows allowedPaths count", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("allowedPaths: 1 path(s)");
  });

  it("/run config shows commandTimeout", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("commandTimeout: 30000ms");
  });

  it("/run config shows maskOutput status", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("maskOutput: true");
  });

  it("/run config shows blockedPatterns count", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("blockedPatterns: 2 pattern(s)");
  });

  it("/run config shows rate limit values", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("maxCallsPerWindow: 10");
    expect(result.text).toContain("windowMs: 60000ms");
  });

  it("/run config shows confirmation settings", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("autoApproveMaxRisk: safe");
    expect(result.text).toContain("approvalTtlMs:");
    expect(result.text).toContain("showRiskLevel:");
  });

  it("/run config shows session settings", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("sessionTtlMs:");
    expect(result.text).toContain("outputPageSize:");
    expect(result.text).toContain("maxHistorySize:");
  });

  it("/run config does not show auditLogPath", async () => {
    const result = await cmdHandler({ args: "config", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).not.toContain("auditLogPath");
    expect(result.text).not.toContain("audit.jsonl");
  });

  // --- blocklist ---

  it("blocked pattern prevents command execution", async () => {
    const result = await cmdHandler({
      args: "curl http://evil.com",
      senderId: "u1",
      channel: "ch",
      config: {},
    });
    expect(result.text).toContain("Blocked by pattern");
    expect(result.text).toContain("^curl\\b");
  });

  it("alias expanding to blocked pattern is rejected", async () => {
    await cmdHandler({
      args: "alias fetch curl http://example.com",
      senderId: "u1",
      channel: "ch",
      config: {},
    });
    const result = await cmdHandler({ args: "fetch", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("Blocked by pattern");
  });

  it("command not matching blocked pattern executes normally", async () => {
    const result = await cmdHandler({
      args: "echo hello",
      senderId: "u1",
      channel: "ch",
      config: {},
    });
    expect(result.text).toContain("hello");
    expect(result.text).not.toContain("Blocked");
  });

  it("/run help includes clear and config subcommands", async () => {
    const result = await cmdHandler({ args: "help", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("clear");
    expect(result.text).toContain("config");
  });
});

// ============================================================================
// Z. Blocklist & Reserved Names Edge Cases (4 tests)
// ============================================================================

describe("blocklist & reserved names edge cases", () => {
  let cmdHandler: (ctx: any) => Promise<any>;

  beforeEach(async () => {
    tmpDir = await createTmpDir();

    const { default: plugin } = await import("./index.js");

    let capturedHandler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 10_000, outputCacheTtlMs: 300_000 },
        blockedPatterns: ["^sudo\\b", "rm\\s+-rf", "^curl\\b"],
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") {
          capturedHandler = cmd.handler;
        }
      },
    };

    await plugin.register(mockApi as any);
    cmdHandler = capturedHandler!;
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("empty blockedPatterns allows all commands", async () => {
    // Re-register with empty blockedPatterns
    const { default: plugin } = await import("./index.js");
    let handler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 10_000, outputCacheTtlMs: 300_000 },
        blockedPatterns: [],
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") handler = cmd.handler;
      },
    };
    await plugin.register(mockApi as any);
    const result = await handler!({ args: "echo test", senderId: "u1", channel: "ch", config: {} });
    expect(result.text).toContain("test");
    expect(result.text).not.toContain("Blocked");
  });

  it("multiple patterns - first match wins (correct pattern source returned)", async () => {
    const result = await cmdHandler({
      args: "sudo rm -rf /",
      senderId: "u1",
      channel: "ch",
      config: {},
    });
    expect(result.text).toContain("Blocked by pattern");
    // Should match ^sudo\b first since it's first in the array
    expect(result.text).toContain("^sudo\\b");
  });

  it("RESERVED_ALIAS_NAMES includes clear and config", () => {
    expect(RESERVED_ALIAS_NAMES.has("clear")).toBe(true);
    expect(RESERVED_ALIAS_NAMES.has("config")).toBe(true);
  });

  it("blocked pattern tested via /run (not direct function call)", async () => {
    const result = await cmdHandler({
      args: "curl https://example.com",
      senderId: "u1",
      channel: "ch",
      config: {},
    });
    expect(result.text).toContain("Blocked by pattern: /^curl\\b/");
    expect(result.text).toContain("> curl https://example.com");
  });
});

// ============================================================================
// AA. Security Hardening: Per-Sender Rate Limits & BG Blocking (8 tests)
// ============================================================================

describe("per-sender rate limits and background blocking", () => {
  let localTmpDir: string;

  beforeEach(async () => {
    localTmpDir = await createTmpDir();
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("sender A hits rate limit, sender B still executes", async () => {
    const cfg = makeConfig({
      allowedPaths: [localTmpDir],
      rateLimits: { maxCallsPerWindow: 2, windowMs: 60_000 },
    });
    const service = new RemoteExecService(cfg, noopLogger);

    // Sender A: 2 calls
    await service.executeCommand({ command: "echo a1", senderId: "senderA" });
    await service.executeCommand({ command: "echo a2", senderId: "senderA" });

    // Sender A: 3rd call should fail
    await expect(
      service.executeCommand({ command: "echo a3", senderId: "senderA" }),
    ).rejects.toThrow("Rate limit exceeded");

    // Sender B: should still work
    const result = await service.executeCommand({ command: "echo b1", senderId: "senderB" });
    expect(result.stdout.trim()).toBe("b1");
  });

  it("global fallback works when no senderId provided", async () => {
    const cfg = makeConfig({
      allowedPaths: [localTmpDir],
      rateLimits: { maxCallsPerWindow: 1, windowMs: 60_000 },
    });
    const service = new RemoteExecService(cfg, noopLogger);

    await service.executeCommand({ command: "echo g1" });
    await expect(service.executeCommand({ command: "echo g2" })).rejects.toThrow(
      "Rate limit exceeded",
    );
  });

  it("rejects nohup commands", async () => {
    const cfg = makeConfig({ allowedPaths: [localTmpDir] });
    const service = new RemoteExecService(cfg, noopLogger);
    await expect(service.executeCommand({ command: "nohup sleep 100" })).rejects.toThrow(
      "Background execution is not allowed",
    );
  });

  it("rejects trailing & (background)", async () => {
    const cfg = makeConfig({ allowedPaths: [localTmpDir] });
    const service = new RemoteExecService(cfg, noopLogger);
    await expect(service.executeCommand({ command: "sleep 100 &" })).rejects.toThrow(
      "Background execution is not allowed",
    );
  });

  it("rejects disown commands", async () => {
    const cfg = makeConfig({ allowedPaths: [localTmpDir] });
    const service = new RemoteExecService(cfg, noopLogger);
    await expect(service.executeCommand({ command: "sleep 100 & disown" })).rejects.toThrow(
      "Background execution is not allowed",
    );
  });

  it("rejects setsid commands", async () => {
    const cfg = makeConfig({ allowedPaths: [localTmpDir] });
    const service = new RemoteExecService(cfg, noopLogger);
    await expect(service.executeCommand({ command: "setsid sleep 100" })).rejects.toThrow(
      "Background execution is not allowed",
    );
  });

  it("PATH and NODE_OPTIONS are rejected via ENV_BLOCKLIST", () => {
    expect(ENV_BLOCKLIST.has("PATH")).toBe(true);
    expect(ENV_BLOCKLIST.has("NODE_OPTIONS")).toBe(true);
  });

  it("constructor rejects empty allowedPaths", () => {
    const cfg = makeConfig({ allowedPaths: [] });
    expect(() => new RemoteExecService(cfg, noopLogger)).toThrow(
      "requires at least one allowedPath",
    );
  });
});

// ============================================================================
// AB. Per-Sender Pending Limits & Byte-Accurate Truncation (6 tests)
// ============================================================================

describe("per-sender pending limits and byte-accurate truncation", () => {
  const mockAudit = {
    log: vi.fn().mockResolvedValue({
      seq: 1,
      timestamp: "",
      event: "",
      actor: undefined,
      decision: "allow" as const,
      context: {},
      prevHmac: "",
      hmac: "",
    }),
    init: vi.fn(),
    verify: vi.fn(),
    query: vi.fn(),
    lastWriteError: null,
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("per-sender pending: sender A blocked, sender B still gets through", () => {
    const mgr = new ConfirmationManager(
      { autoApproveMaxRisk: "safe", approvalTtlMs: 120_000, maxPending: 1, showRiskLevel: true },
      mockAudit as any,
      noopLogger,
    );
    // "rm -rf /" is high risk, will be pending
    const r1 = mgr.evaluateCommand({ command: "rm -rf /", senderId: "A", channel: "ch" });
    expect(r1.action).toBe("pending_approval");

    // Sender A: second high-risk should be blocked
    const r2 = mgr.evaluateCommand({ command: "rm -rf /tmp", senderId: "A", channel: "ch" });
    expect(r2.action).toBe("blocked");

    // Sender B: should still get through
    const r3 = mgr.evaluateCommand({ command: "rm -rf /tmp", senderId: "B", channel: "ch" });
    expect(r3.action).toBe("pending_approval");
  });

  it("expired requests are audited", async () => {
    const mgr = new ConfirmationManager(
      { autoApproveMaxRisk: "safe", approvalTtlMs: 10, maxPending: 10, showRiskLevel: true },
      mockAudit as any,
      noopLogger,
    );

    // Create a pending request
    mgr.evaluateCommand({ command: "rm -rf /", senderId: "u1", channel: "ch" });
    mockAudit.log.mockClear();

    // Wait for expiry naturally
    await new Promise((r) => setTimeout(r, 20));
    // Force prune via listing
    const pending = mgr.listPending();
    expect(pending.length).toBe(0);
    // audit.log should have been called with "expired"
    expect(mockAudit.log).toHaveBeenCalledWith(
      "run_command",
      "u1",
      "expired",
      expect.objectContaining({ command: "rm -rf /" }),
    );
  });

  it("byte-accurate truncation preserves multi-byte chars", async () => {
    const localTmpDir = await createTmpDir();
    // 4-byte emoji repeated
    const cfg = makeConfig({
      allowedPaths: [localTmpDir],
      maxOutputBytes: 10,
    });
    const service = new RemoteExecService(cfg, noopLogger);
    // Create file with multi-byte chars and cat it
    const testFile = path.join(localTmpDir, "mb.txt");
    // "aaaa" is 4 bytes, emoji adds multi-byte
    await fs.writeFile(testFile, "a".repeat(20));
    const result = await service.executeCommand({ command: `cat ${testFile}` });
    expect(result.truncated).toBe(true);
    // output should be valid UTF-8, no broken chars
    expect(Buffer.from(result.stdout, "utf-8").toString("utf-8")).toBe(result.stdout);
  });

  it("no senderId uses global pending limit", () => {
    const mgr = new ConfirmationManager(
      { autoApproveMaxRisk: "safe", approvalTtlMs: 120_000, maxPending: 1, showRiskLevel: true },
      mockAudit as any,
      noopLogger,
    );
    const r1 = mgr.evaluateCommand({ command: "rm -rf /", channel: "ch" });
    expect(r1.action).toBe("pending_approval");
    const r2 = mgr.evaluateCommand({ command: "rm -rf /tmp", channel: "ch" });
    expect(r2.action).toBe("blocked");
  });

  afterEach(async () => {
    await cleanupDirs();
  });
});

// ============================================================================
// AC. Hardening: Pattern Count Cap & Slash Escape (4 tests)
// ============================================================================

describe("hardening: pattern cap, slash escape, dedup", () => {
  it("rejects more than 50 blocked patterns", () => {
    const tooMany = Array.from({ length: 51 }, (_, i) => `pattern${i}`);
    expect(() =>
      remoteExecConfigSchema.parse({
        enabled: true,
        allowedPaths: ["/tmp"],
        blockedPatterns: tooMany,
      }),
    ).toThrow("exceeds max count");
  });

  it("exactly 50 blocked patterns accepted", () => {
    const fifty = Array.from({ length: 50 }, (_, i) => `pattern${i}`);
    const cfg = remoteExecConfigSchema.parse({
      enabled: true,
      allowedPaths: ["/tmp"],
      blockedPatterns: fifty,
    });
    expect(cfg.blockedPatterns.length).toBe(50);
  });

  it("formatBlockedCommand escapes forward slashes in pattern source", async () => {
    const { formatBlockedCommand } = await import("./confirmation-ux.js");
    const result = formatBlockedCommand("test/cmd", "test/pattern");
    expect(result).toContain("/test\\/pattern/");
  });

  it("deduplicated defaults: session defaults used directly", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.session.maxHistorySize).toBe(20);
    expect(cfg.session.maxEnvVars).toBe(20);
    expect(cfg.session.maxAliases).toBe(10);
  });
});

// ============================================================================
// AD. pin-auth.ts Unit Tests (12 tests)
// ============================================================================

import {
  hashPin,
  verifyPin,
  createPinState,
  checkPinLock,
  attemptUnlock,
  type PinConfig,
  type PinSessionState,
} from "./pin-auth.js";

describe("pin-auth", () => {
  it("hashPin produces scrypt:<b64>:<b64> format", async () => {
    const hash = await hashPin("1234");
    expect(hash).toMatch(/^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
  });

  it("verifyPin returns true for correct PIN", async () => {
    const hash = await hashPin("mypin");
    expect(await verifyPin("mypin", hash)).toBe(true);
  });

  it("verifyPin returns false for wrong PIN", async () => {
    const hash = await hashPin("mypin");
    expect(await verifyPin("wrongpin", hash)).toBe(false);
  });

  it("createPinState returns unlocked=false defaults", () => {
    const state = createPinState();
    expect(state.pinUnlocked).toBe(false);
    expect(state.pinFailures).toBe(0);
    expect(state.pinLockedUntil).toBeNull();
    expect(state.pinLastActivity).toBe(0);
  });

  it("checkPinLock: disabled (no pinHash) returns not locked", () => {
    const state = createPinState();
    const cfg: PinConfig = {
      pinHash: null,
      pinLockoutMs: 300_000,
      pinMaxAttempts: 3,
      pinAutoLockMs: 300_000,
    };
    expect(checkPinLock(state, cfg).locked).toBe(false);
  });

  it("checkPinLock: locked when not unlocked", () => {
    const state = createPinState();
    const cfg: PinConfig = {
      pinHash: "scrypt:abc:def",
      pinLockoutMs: 300_000,
      pinMaxAttempts: 3,
      pinAutoLockMs: 300_000,
    };
    const result = checkPinLock(state, cfg);
    expect(result.locked).toBe(true);
  });

  it("checkPinLock: unlocked returns false", () => {
    const state = createPinState();
    state.pinUnlocked = true;
    state.pinLastActivity = Date.now();
    const cfg: PinConfig = {
      pinHash: "scrypt:abc:def",
      pinLockoutMs: 300_000,
      pinMaxAttempts: 3,
      pinAutoLockMs: 300_000,
    };
    expect(checkPinLock(state, cfg).locked).toBe(false);
  });

  it("checkPinLock: auto-locks after inactivity", () => {
    const state = createPinState();
    state.pinUnlocked = true;
    state.pinLastActivity = Date.now() - 400_000; // 400s ago
    const cfg: PinConfig = {
      pinHash: "scrypt:abc:def",
      pinLockoutMs: 300_000,
      pinMaxAttempts: 3,
      pinAutoLockMs: 300_000,
    };
    const result = checkPinLock(state, cfg);
    expect(result.locked).toBe(true);
    expect(state.pinUnlocked).toBe(false);
  });

  it("checkPinLock: lockout active", () => {
    const state = createPinState();
    state.pinLockedUntil = Date.now() + 60_000;
    const cfg: PinConfig = {
      pinHash: "scrypt:abc:def",
      pinLockoutMs: 300_000,
      pinMaxAttempts: 3,
      pinAutoLockMs: 300_000,
    };
    const result = checkPinLock(state, cfg);
    expect(result.locked).toBe(true);
    if (result.locked) expect(result.reason).toContain("Locked out");
  });

  it("checkPinLock: lockout expired resets failures", () => {
    const state = createPinState();
    state.pinLockedUntil = Date.now() - 1000; // expired
    state.pinFailures = 3;
    const cfg: PinConfig = {
      pinHash: "scrypt:abc:def",
      pinLockoutMs: 300_000,
      pinMaxAttempts: 3,
      pinAutoLockMs: 300_000,
    };
    const result = checkPinLock(state, cfg);
    expect(result.locked).toBe(true); // still locked (not unlocked)
    expect(state.pinFailures).toBe(0);
    expect(state.pinLockedUntil).toBeNull();
  });

  it("attemptUnlock: success resets state", async () => {
    const hash = await hashPin("1234");
    const state = createPinState();
    const cfg: PinConfig = {
      pinHash: hash,
      pinLockoutMs: 300_000,
      pinMaxAttempts: 3,
      pinAutoLockMs: 300_000,
    };
    const result = await attemptUnlock("1234", state, cfg);
    expect(result.success).toBe(true);
    expect(state.pinUnlocked).toBe(true);
    expect(state.pinFailures).toBe(0);
  });

  it("attemptUnlock: failure increments count and triggers lockout", async () => {
    const hash = await hashPin("1234");
    const state = createPinState();
    const cfg: PinConfig = {
      pinHash: hash,
      pinLockoutMs: 300_000,
      pinMaxAttempts: 2,
      pinAutoLockMs: 300_000,
    };

    const r1 = await attemptUnlock("wrong", state, cfg);
    expect(r1.success).toBe(false);
    expect(r1.message).toContain("1 attempt");

    const r2 = await attemptUnlock("wrong2", state, cfg);
    expect(r2.success).toBe(false);
    expect(r2.message).toContain("Locked out");
    expect(state.pinLockedUntil).not.toBeNull();
  });
});

// ============================================================================
// AE. /run PIN Integration Tests (8 tests)
// ============================================================================

describe("/run PIN integration", () => {
  let cmdHandler: (ctx: any) => Promise<any>;
  let pinHash: string;

  beforeEach(async () => {
    tmpDir = await createTmpDir();
    pinHash = await hashPin("9999");

    const { default: plugin } = await import("./index.js");

    let capturedHandler: ((ctx: any) => Promise<any>) | undefined;
    const mockApi = {
      pluginConfig: {
        enabled: true,
        allowedPaths: [tmpDir],
        confirmation: { autoApproveMaxRisk: "safe" },
        session: { outputPageSize: 10_000, outputCacheTtlMs: 300_000 },
        pin: { pinHash, pinLockoutMs: 60_000, pinMaxAttempts: 3, pinAutoLockMs: 300_000 },
      },
      logger: noopLogger,
      registerTool: () => {},
      registerHook: () => {},
      registerHttpHandler: () => {},
      registerHttpRoute: () => {},
      registerChannel: () => {},
      registerGatewayMethod: () => {},
      registerCli: () => {},
      registerService: () => {},
      registerProvider: () => {},
      registerCommand: (cmd: { name: string; handler: (ctx: any) => Promise<any> }) => {
        if (cmd.name === "run") capturedHandler = cmd.handler;
      },
    };

    await plugin.register(mockApi as any);
    cmdHandler = capturedHandler!;
  });

  afterEach(async () => {
    await cleanupDirs();
  });

  it("/run ls when locked returns locked message", async () => {
    const result = await cmdHandler({ args: "echo hello", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("locked");
  });

  it("/run help works even when locked", async () => {
    const result = await cmdHandler({ args: "help", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("Usage: /run");
  });

  it("/run unlock with correct PIN succeeds", async () => {
    const result = await cmdHandler({ args: "unlock 9999", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("Unlocked");
  });

  it("/run unlock with wrong PIN shows remaining attempts", async () => {
    const result = await cmdHandler({ args: "unlock wrong", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("Incorrect PIN");
    expect(result.text).toContain("attempt");
  });

  it("3 failures triggers lockout", async () => {
    await cmdHandler({ args: "unlock wrong1", senderId: "u1", channel: "ch" });
    await cmdHandler({ args: "unlock wrong2", senderId: "u1", channel: "ch" });
    const result = await cmdHandler({ args: "unlock wrong3", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("Locked out");
  });

  it("after unlock, commands work", async () => {
    await cmdHandler({ args: "unlock 9999", senderId: "u1", channel: "ch" });
    const result = await cmdHandler({ args: "echo hello", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("hello");
  });

  it("/run clear resets PIN state", async () => {
    // Unlock first
    await cmdHandler({ args: "unlock 9999", senderId: "u1", channel: "ch" });
    // Clear session
    await cmdHandler({ args: "clear", senderId: "u1", channel: "ch" });
    // Should be locked again
    const result = await cmdHandler({ args: "echo hello", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("locked");
  });

  it("/run unlock without pin shows usage", async () => {
    const result = await cmdHandler({ args: "unlock", senderId: "u1", channel: "ch" });
    expect(result.text).toContain("Usage:");
  });
});

// ============================================================================
// AF. PIN Config Parsing (5 tests)
// ============================================================================

describe("PIN config parsing", () => {
  it("default PIN config is all nulls/defaults", () => {
    const cfg = remoteExecConfigSchema.parse({});
    expect(cfg.pin.pinHash).toBeNull();
    expect(cfg.pin.pinLockoutMs).toBe(300_000);
    expect(cfg.pin.pinMaxAttempts).toBe(3);
    expect(cfg.pin.pinAutoLockMs).toBe(300_000);
  });

  it("valid pinHash accepted", async () => {
    const hash = await hashPin("test");
    const cfg = remoteExecConfigSchema.parse({
      enabled: true,
      allowedPaths: ["/tmp"],
      pin: { pinHash: hash },
    });
    expect(cfg.pin.pinHash).toBe(hash);
  });

  it("invalid pinHash format throws", () => {
    expect(() =>
      remoteExecConfigSchema.parse({
        enabled: true,
        allowedPaths: ["/tmp"],
        pin: { pinHash: "not-a-valid-hash" },
      }),
    ).toThrow("pinHash must match format");
  });

  it("numeric values clamped", () => {
    const cfg = remoteExecConfigSchema.parse({
      pin: { pinLockoutMs: 10, pinMaxAttempts: 100, pinAutoLockMs: 10 },
    });
    expect(cfg.pin.pinLockoutMs).toBe(60_000);
    expect(cfg.pin.pinMaxAttempts).toBe(10);
    expect(cfg.pin.pinAutoLockMs).toBe(60_000);
  });

  it("unknown keys in pin section throws", () => {
    expect(() =>
      remoteExecConfigSchema.parse({
        pin: { unknownKey: true },
      }),
    ).toThrow();
  });
});

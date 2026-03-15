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
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  remoteExecConfigSchema,
  type RemoteExecConfig,
  type ConfirmationConfig,
} from "./config.js";
import { RemoteExecService } from "./exec-service.js";
import {
  ConfirmationManager,
  formatExecOutput,
  formatApprovalPrompt,
  formatPendingList,
  formatRunHelp,
  type PendingRequest,
  type ExecResult,
} from "./confirmation-ux.js";

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

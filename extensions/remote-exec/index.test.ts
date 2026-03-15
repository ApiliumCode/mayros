/**
 * Remote Exec Plugin Tests
 *
 * Tests cover:
 * - Configuration parsing (defaults, validation, clamping, error cases)
 * - Path validation (allowedPaths, traversal, symlinks, resolution)
 * - Command execution (stdout/stderr, exit codes, timeout, truncation, binary)
 * - File reading (text, binary, line limits, errors)
 * - Directory listing (sorting, types, empty, errors)
 * - Plugin integration (registration, disabled state)
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { remoteExecConfigSchema, type RemoteExecConfig } from "./config.js";
import { RemoteExecService } from "./exec-service.js";

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

  it("registers 3 tools when enabled", async () => {
    const { default: plugin } = await import("./index.js");

    const registeredTools: string[] = [];
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
      registerCommand: () => {},
    };

    await plugin.register(mockApi as any);
    expect(registeredTools).toEqual(["remote_exec", "remote_read_file", "remote_ls"]);
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

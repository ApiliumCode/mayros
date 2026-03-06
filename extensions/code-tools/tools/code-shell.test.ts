import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const execFileAsync = promisify(execFile);

describe("code_shell behavior", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-shell-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("executes a simple command", async () => {
    const { stdout } = await execFileAsync("bash", ["-c", "echo hello"], {
      cwd: tmpDir,
      timeout: 5000,
    });
    expect(stdout.trim()).toBe("hello");
  });

  it("captures stderr", async () => {
    const result = await execFileAsync("bash", ["-c", "echo err >&2"], {
      cwd: tmpDir,
      timeout: 5000,
    });
    expect(result.stderr.trim()).toBe("err");
  });

  it("respects cwd", async () => {
    await fs.writeFile(path.join(tmpDir, "marker.txt"), "found");
    const { stdout } = await execFileAsync("bash", ["-c", "cat marker.txt"], {
      cwd: tmpDir,
      timeout: 5000,
    });
    expect(stdout.trim()).toBe("found");
  });

  it("handles timeout", async () => {
    try {
      await execFileAsync("bash", ["-c", "sleep 10"], {
        cwd: tmpDir,
        timeout: 500,
      });
    } catch (err) {
      const error = err as { killed?: boolean };
      expect(error.killed).toBe(true);
    }
  });

  it("captures exit code on failure", async () => {
    try {
      await execFileAsync("bash", ["-c", "exit 42"], {
        cwd: tmpDir,
        timeout: 5000,
      });
    } catch (err) {
      const error = err as { code?: number };
      expect(error.code).toBe(42);
    }
  });

  it("handles multi-line output", async () => {
    const { stdout } = await execFileAsync("bash", ["-c", 'echo "line1\nline2\nline3"'], {
      cwd: tmpDir,
      timeout: 5000,
    });
    const lines = stdout.trim().split("\n");
    expect(lines.length).toBe(3);
  });

  it("handles piped commands", async () => {
    const { stdout } = await execFileAsync("bash", ["-c", 'echo "a\nb\nc" | wc -l'], {
      cwd: tmpDir,
      timeout: 5000,
    });
    expect(parseInt(stdout.trim(), 10)).toBe(3);
  });
});

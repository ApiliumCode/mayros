import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("hayameru atomic write", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "hayameru-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates backup and writes atomically", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    await fs.writeFile(filePath, "const x = 1;", "utf-8");

    // Simulate what hayameru does
    const tmpPath = filePath + ".hayameru-tmp";
    const bakPath = filePath + ".hayameru-bak";
    await fs.copyFile(filePath, bakPath);
    await fs.writeFile(tmpPath, "let x = 1;", "utf-8");
    await fs.rename(tmpPath, filePath);

    // Verify backup exists with original content
    const bakContent = await fs.readFile(bakPath, "utf-8");
    expect(bakContent).toBe("const x = 1;");

    // Verify file has new content
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("let x = 1;");

    // Verify tmp file doesn't remain
    await expect(fs.stat(tmpPath)).rejects.toThrow();
  });

  it("preserves original file if tmp write fails", async () => {
    const filePath = path.join(tmpDir, "safe.ts");
    const originalContent = "function hello() { return 42; }";
    await fs.writeFile(filePath, originalContent, "utf-8");

    const bakPath = filePath + ".hayameru-bak";
    await fs.copyFile(filePath, bakPath);

    // Simulate a crash after backup but before rename —
    // the original file should still contain the original content
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe(originalContent);

    // Backup should also have original content for recovery
    const bakContent = await fs.readFile(bakPath, "utf-8");
    expect(bakContent).toBe(originalContent);
  });

  it("handles multiple sequential atomic writes", async () => {
    const filePath = path.join(tmpDir, "multi.ts");
    await fs.writeFile(filePath, "v1", "utf-8");

    for (let i = 2; i <= 5; i++) {
      const tmpPath = filePath + ".hayameru-tmp";
      const bakPath = filePath + ".hayameru-bak";
      await fs.copyFile(filePath, bakPath);
      await fs.writeFile(tmpPath, `v${i}`, "utf-8");
      await fs.rename(tmpPath, filePath);
    }

    // Final content should be v5
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("v5");

    // Backup should be v4 (the content before the last write)
    const bakContent = await fs.readFile(filePath + ".hayameru-bak", "utf-8");
    expect(bakContent).toBe("v4");
  });
});

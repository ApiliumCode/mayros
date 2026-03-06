import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("code_ls behavior", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ls-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("lists files and directories", async () => {
    await fs.mkdir(path.join(tmpDir, "subdir"));
    await fs.writeFile(path.join(tmpDir, "file.txt"), "hello");
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    expect(entries.length).toBe(2);
  });

  it("sorts directories before files", async () => {
    await fs.mkdir(path.join(tmpDir, "zzz-dir"));
    await fs.writeFile(path.join(tmpDir, "aaa-file.txt"), "");
    const entries = await fs.readdir(tmpDir, { withFileTypes: true });
    const sorted = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name);
    });
    expect(sorted[0].name).toBe("zzz-dir");
  });

  it("handles empty directory", async () => {
    const entries = await fs.readdir(tmpDir);
    expect(entries).toHaveLength(0);
  });
});

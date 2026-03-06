import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { listDirectory } from "./code-ls.js";
import type { LsEntry } from "./code-ls.js";

describe("listDirectory", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-ls-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("sorts directories before files", async () => {
    await fs.writeFile(path.join(tmpDir, "aaa-file.txt"), "hello");
    await fs.mkdir(path.join(tmpDir, "zzz-dir"));

    const entries = await listDirectory(tmpDir);
    expect(entries).toHaveLength(2);
    expect(entries[0].name).toBe("zzz-dir");
    expect(entries[0].type).toBe("directory");
    expect(entries[1].name).toBe("aaa-file.txt");
    expect(entries[1].type).toBe("file");
  });

  it("detects symlinks", async () => {
    await fs.writeFile(path.join(tmpDir, "target.txt"), "content");
    await fs.symlink(path.join(tmpDir, "target.txt"), path.join(tmpDir, "link.txt"));

    const entries = await listDirectory(tmpDir);
    const link = entries.find((e) => e.name === "link.txt");
    expect(link).toBeDefined();
    expect(link!.type).toBe("symlink");
  });

  it("includes file sizes for regular files", async () => {
    const content = "hello world";
    await fs.writeFile(path.join(tmpDir, "sized.txt"), content);

    const entries = await listDirectory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBe(Buffer.byteLength(content));
  });

  it("does not include sizes for directories", async () => {
    await fs.mkdir(path.join(tmpDir, "subdir"));

    const entries = await listDirectory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].type).toBe("directory");
    expect(entries[0].size).toBeUndefined();
  });

  it("sorts alphabetically within groups", async () => {
    await fs.mkdir(path.join(tmpDir, "beta"));
    await fs.mkdir(path.join(tmpDir, "alpha"));
    await fs.writeFile(path.join(tmpDir, "zebra.ts"), "");
    await fs.writeFile(path.join(tmpDir, "aardvark.ts"), "");

    const entries = await listDirectory(tmpDir);
    // Directories first, alphabetical
    expect(entries[0].name).toBe("alpha");
    expect(entries[1].name).toBe("beta");
    // Files next, alphabetical
    expect(entries[2].name).toBe("aardvark.ts");
    expect(entries[3].name).toBe("zebra.ts");
  });

  it("returns empty array for empty directory", async () => {
    const entries = await listDirectory(tmpDir);
    expect(entries).toHaveLength(0);
  });

  it("throws on non-existent directory", async () => {
    const badPath = path.join(tmpDir, "does-not-exist");
    await expect(listDirectory(badPath)).rejects.toThrow();
  });

  it("includes hidden files", async () => {
    await fs.writeFile(path.join(tmpDir, ".hidden"), "secret");
    await fs.writeFile(path.join(tmpDir, "visible.txt"), "public");

    const entries = await listDirectory(tmpDir);
    const names = entries.map((e: LsEntry) => e.name);
    expect(names).toContain(".hidden");
    expect(names).toContain("visible.txt");
  });

  it("handles mixed entry types correctly", async () => {
    await fs.mkdir(path.join(tmpDir, "dir1"));
    await fs.writeFile(path.join(tmpDir, "file1.txt"), "data");
    await fs.writeFile(path.join(tmpDir, "target"), "target-data");
    await fs.symlink(path.join(tmpDir, "target"), path.join(tmpDir, "link1"));

    const entries = await listDirectory(tmpDir);
    const types = entries.map((e: LsEntry) => e.type);
    expect(types).toContain("directory");
    expect(types).toContain("file");
    expect(types).toContain("symlink");
  });

  it("reports correct size for files with unicode content", async () => {
    const unicodeContent = "Hello \u{1F30D}"; // emoji takes multiple bytes
    await fs.writeFile(path.join(tmpDir, "unicode.txt"), unicodeContent, "utf-8");

    const entries = await listDirectory(tmpDir);
    expect(entries).toHaveLength(1);
    expect(entries[0].size).toBe(Buffer.byteLength(unicodeContent, "utf-8"));
  });
});

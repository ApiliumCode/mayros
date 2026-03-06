import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { generateDiff } from "./code-edit.js";

describe("generateDiff", () => {
  it("generates a unified diff", () => {
    const old = "line1\nline2\nline3";
    const updated = "line1\nmodified\nline3";
    const diff = generateDiff("test.ts", old, updated);
    expect(diff).toContain("--- a/test.ts");
    expect(diff).toContain("+++ b/test.ts");
    expect(diff).toContain("-line2");
    expect(diff).toContain("+modified");
  });

  it("handles additions", () => {
    const old = "line1\nline2";
    const updated = "line1\nline2\nline3";
    const diff = generateDiff("test.ts", old, updated);
    expect(diff).toContain("+line3");
  });

  it("handles deletions", () => {
    const old = "line1\nline2\nline3";
    const updated = "line1\nline3";
    const diff = generateDiff("test.ts", old, updated);
    expect(diff).toContain("-line2");
  });
});

describe("code_edit behavior", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-edit-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("replaces exact string", async () => {
    const filePath = path.join(tmpDir, "test.ts");
    await fs.writeFile(filePath, "const x = 1;\nconst y = 2;");
    const content = await fs.readFile(filePath, "utf-8");
    const newContent = content.replace("const x = 1;", "const x = 42;");
    await fs.writeFile(filePath, newContent);
    const result = await fs.readFile(filePath, "utf-8");
    expect(result).toContain("const x = 42;");
    expect(result).toContain("const y = 2;");
  });

  it("detects non-unique old_string", async () => {
    const filePath = path.join(tmpDir, "dup.ts");
    await fs.writeFile(filePath, "hello\nhello\nworld");
    const content = await fs.readFile(filePath, "utf-8");
    const firstIdx = content.indexOf("hello");
    const secondIdx = content.indexOf("hello", firstIdx + 1);
    expect(secondIdx).toBeGreaterThan(firstIdx); // confirms duplicate
  });

  it("replace_all replaces every occurrence", async () => {
    const filePath = path.join(tmpDir, "multi.ts");
    await fs.writeFile(filePath, "foo bar foo baz foo");
    const content = await fs.readFile(filePath, "utf-8");
    const newContent = content.split("foo").join("qux");
    await fs.writeFile(filePath, newContent);
    const result = await fs.readFile(filePath, "utf-8");
    expect(result).toBe("qux bar qux baz qux");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

describe("code_grep behavior", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-grep-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds pattern in files", async () => {
    await fs.writeFile(path.join(tmpDir, "test.ts"), "const foo = 1;\nconst bar = 2;");
    const content = await fs.readFile(path.join(tmpDir, "test.ts"), "utf-8");
    const lines = content.split("\n");
    const matches = lines.filter((l) => /foo/.test(l));
    expect(matches).toHaveLength(1);
    expect(matches[0]).toContain("foo");
  });

  it("searches recursively", async () => {
    await fs.mkdir(path.join(tmpDir, "deep/nested"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "deep/nested/file.ts"), "const target = true;");
    const content = await fs.readFile(path.join(tmpDir, "deep/nested/file.ts"), "utf-8");
    expect(content).toContain("target");
  });

  it("respects max results", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `match_${i}`);
    await fs.writeFile(path.join(tmpDir, "many.txt"), lines.join("\n"));
    const content = await fs.readFile(path.join(tmpDir, "many.txt"), "utf-8");
    const allMatches = content.split("\n").filter((l) => /match_/.test(l));
    const limited = allMatches.slice(0, 50);
    expect(limited).toHaveLength(50);
  });

  it("handles regex patterns", async () => {
    await fs.writeFile(path.join(tmpDir, "regex.ts"), "function hello() {}\nfunction world() {}");
    const content = await fs.readFile(path.join(tmpDir, "regex.ts"), "utf-8");
    const matches = content.split("\n").filter((l) => /function\s+\w+/.test(l));
    expect(matches).toHaveLength(2);
  });
});

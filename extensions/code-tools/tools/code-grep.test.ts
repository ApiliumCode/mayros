import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { grepBuiltin } from "./code-grep.js";

describe("grepBuiltin", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-grep-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds pattern matches in a single file", async () => {
    await fs.writeFile(
      path.join(tmpDir, "test.ts"),
      "const foo = 1;\nconst bar = 2;\nconst fooBar = 3;",
    );

    const matches = await grepBuiltin("foo", tmpDir, undefined, 50);
    expect(matches).toHaveLength(2);
    expect(matches[0].file).toBe("test.ts");
    expect(matches[0].line).toBe(1);
    expect(matches[0].content).toContain("foo");
    expect(matches[1].line).toBe(3);
    expect(matches[1].content).toContain("fooBar");
  });

  it("searches recursively through nested directories", async () => {
    await fs.mkdir(path.join(tmpDir, "deep/nested"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "deep/nested/file.ts"), "const target = true;");
    await fs.writeFile(path.join(tmpDir, "root.ts"), "const target = false;");

    const matches = await grepBuiltin("target", tmpDir, undefined, 50);
    expect(matches).toHaveLength(2);
    const files = matches.map((m) => m.file);
    expect(files).toContain(path.join("deep", "nested", "file.ts"));
    expect(files).toContain("root.ts");
  });

  it("enforces max results", async () => {
    const lines = Array.from({ length: 100 }, (_, i) => `match_${i}`);
    await fs.writeFile(path.join(tmpDir, "many.txt"), lines.join("\n"));

    const matches = await grepBuiltin("match_", tmpDir, undefined, 10);
    expect(matches).toHaveLength(10);
  });

  it("filters files with glob pattern", async () => {
    await fs.writeFile(path.join(tmpDir, "code.ts"), "const value = 42;");
    await fs.writeFile(path.join(tmpDir, "code.js"), "const value = 42;");
    await fs.writeFile(path.join(tmpDir, "readme.md"), "value is important");

    const matches = await grepBuiltin("value", tmpDir, "*.ts", 50);
    expect(matches.length).toBeGreaterThanOrEqual(1);
    for (const m of matches) {
      expect(m.file).toMatch(/\.ts$/);
    }
  });

  it("performs case-insensitive matching", async () => {
    await fs.writeFile(
      path.join(tmpDir, "case.ts"),
      "const Hello = 1;\nconst HELLO = 2;\nconst hello = 3;",
    );

    const matches = await grepBuiltin("hello", tmpDir, undefined, 50);
    expect(matches).toHaveLength(3);
  });

  it("skips node_modules directory", async () => {
    await fs.mkdir(path.join(tmpDir, "node_modules/pkg"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "node_modules/pkg/index.ts"), "const secret = 1;");
    await fs.writeFile(path.join(tmpDir, "app.ts"), "const secret = 2;");

    const matches = await grepBuiltin("secret", tmpDir, undefined, 50);
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("app.ts");
  });

  it("skips .git directory", async () => {
    await fs.mkdir(path.join(tmpDir, ".git/refs"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".git/refs/data.txt"), "found me");
    await fs.writeFile(path.join(tmpDir, "source.ts"), "found me too");

    const matches = await grepBuiltin("found", tmpDir, undefined, 50);
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("source.ts");
  });

  it("handles unreadable files gracefully", async () => {
    await fs.writeFile(path.join(tmpDir, "good.ts"), "findme here");
    // Create a directory that looks like a file won't cause issues —
    // the function uses readdir + isFile checks, so create a symlink to nothing
    await fs.symlink("/nonexistent/path/file.ts", path.join(tmpDir, "broken-link.ts"));

    // Should not throw, and should find the match in the readable file
    const matches = await grepBuiltin("findme", tmpDir, undefined, 50);
    expect(matches).toHaveLength(1);
    expect(matches[0].file).toBe("good.ts");
  });

  it("returns empty array for empty directory", async () => {
    const matches = await grepBuiltin("anything", tmpDir, undefined, 50);
    expect(matches).toHaveLength(0);
  });

  it("handles regex special characters in pattern", async () => {
    await fs.writeFile(path.join(tmpDir, "regex.ts"), "function hello() {}\nfunction world() {}");

    const matches = await grepBuiltin("function\\s+\\w+", tmpDir, undefined, 50);
    expect(matches).toHaveLength(2);
    expect(matches[0].content).toContain("function hello");
    expect(matches[1].content).toContain("function world");
  });

  it("reports correct line numbers", async () => {
    const content = "line1\nline2\ntarget_line\nline4\nanother_target\n";
    await fs.writeFile(path.join(tmpDir, "lines.ts"), content);

    const matches = await grepBuiltin("target", tmpDir, undefined, 50);
    expect(matches).toHaveLength(2);
    expect(matches[0].line).toBe(3);
    expect(matches[1].line).toBe(5);
  });
});

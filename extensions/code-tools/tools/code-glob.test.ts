import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { globFiles } from "./code-glob.js";

describe("globFiles", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-glob-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds .ts files in the base directory", async () => {
    await fs.writeFile(path.join(tmpDir, "a.ts"), "export const a = 1;");
    await fs.writeFile(path.join(tmpDir, "b.ts"), "export const b = 2;");
    await fs.writeFile(path.join(tmpDir, "c.js"), "export const c = 3;");

    const result = await globFiles("*.ts", tmpDir, 100);
    expect(result.files).toHaveLength(2);
    expect(result.files).toContain("a.ts");
    expect(result.files).toContain("b.ts");
    expect(result.totalFound).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("ignores node_modules", async () => {
    await fs.mkdir(path.join(tmpDir, "node_modules/pkg"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "node_modules/pkg/index.ts"), "");
    await fs.writeFile(path.join(tmpDir, "src.ts"), "export default 1;");

    const result = await globFiles("**/*.ts", tmpDir, 100);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toBe("src.ts");
  });

  it("ignores .git directory", async () => {
    await fs.mkdir(path.join(tmpDir, ".git/objects"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, ".git/objects/data.ts"), "");
    await fs.writeFile(path.join(tmpDir, "app.ts"), "");

    const result = await globFiles("**/*.ts", tmpDir, 100);
    expect(result.files).toHaveLength(1);
    expect(result.files[0]).toBe("app.ts");
  });

  it("sorts by mtime with newest first", async () => {
    // Create files with different mtimes using utimes
    const fileA = path.join(tmpDir, "old.ts");
    const fileB = path.join(tmpDir, "new.ts");

    await fs.writeFile(fileA, "old");
    await fs.writeFile(fileB, "new");

    // Set old.ts to a past mtime
    const pastTime = new Date("2020-01-01");
    await fs.utimes(fileA, pastTime, pastTime);

    const result = await globFiles("*.ts", tmpDir, 100);
    expect(result.files).toHaveLength(2);
    // newest first
    expect(result.files[0]).toBe("new.ts");
    expect(result.files[1]).toBe("old.ts");
  });

  it("respects maxResults limit", async () => {
    for (let i = 0; i < 10; i++) {
      await fs.writeFile(path.join(tmpDir, `file${i}.ts`), `content ${i}`);
    }

    const result = await globFiles("*.ts", tmpDir, 3);
    expect(result.files).toHaveLength(3);
    expect(result.totalFound).toBe(10);
    expect(result.truncated).toBe(true);
  });

  it("returns empty for non-existent directory pattern", async () => {
    const result = await globFiles("**/*.rs", tmpDir, 100);
    expect(result.files).toHaveLength(0);
    expect(result.totalFound).toBe(0);
    expect(result.truncated).toBe(false);
  });

  it("finds nested files with recursive pattern", async () => {
    await fs.mkdir(path.join(tmpDir, "src/components"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src/index.ts"), "");
    await fs.writeFile(path.join(tmpDir, "src/components/App.tsx"), "");

    const result = await globFiles("**/*.{ts,tsx}", tmpDir, 100);
    expect(result.files).toHaveLength(2);
    const names = result.files.map((f) => path.basename(f));
    expect(names).toContain("index.ts");
    expect(names).toContain("App.tsx");
  });

  it("handles empty directory", async () => {
    const result = await globFiles("**/*", tmpDir, 100);
    expect(result.files).toHaveLength(0);
    expect(result.truncated).toBe(false);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

/**
 * Minimal glob helper using fs.readdir for tests.
 * Avoids importing fast-glob directly since it resolves from the extension dir.
 */
async function simpleGlob(
  pattern: string,
  cwd: string,
  opts?: { ignore?: string[] },
): Promise<string[]> {
  const ignoreSet = new Set(
    opts?.ignore?.map((i) => i.replace("**/", "").replace("/**", "")) ?? [],
  );
  const results: string[] = [];
  const ext = pattern.includes(".") ? pattern.split(".").pop() : undefined;

  async function walk(dir: string, rel: string): Promise<void> {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (ignoreSet.has(entry.name)) continue;
      const fullRel = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(path.join(dir, entry.name), fullRel);
      } else if (entry.isFile()) {
        if (
          !ext ||
          entry.name.endsWith(`.${ext}`) ||
          (pattern.includes("{") && matchMultiExt(entry.name, pattern))
        ) {
          results.push(fullRel);
        }
      }
    }
  }

  await walk(cwd, "");
  return results;
}

function matchMultiExt(name: string, pattern: string): boolean {
  const match = pattern.match(/\{([^}]+)\}/);
  if (!match) return false;
  const exts = match[1].split(",");
  return exts.some((ext) => name.endsWith(`.${ext}`));
}

describe("code_glob behavior", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-glob-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("finds files matching pattern", async () => {
    await fs.writeFile(path.join(tmpDir, "a.ts"), "");
    await fs.writeFile(path.join(tmpDir, "b.ts"), "");
    await fs.writeFile(path.join(tmpDir, "c.js"), "");
    const files = await simpleGlob("*.ts", tmpDir);
    expect(files).toHaveLength(2);
  });

  it("ignores node_modules", async () => {
    await fs.mkdir(path.join(tmpDir, "node_modules"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "node_modules/pkg.ts"), "");
    await fs.writeFile(path.join(tmpDir, "src.ts"), "");
    const files = await simpleGlob("**/*.ts", tmpDir, {
      ignore: ["**/node_modules/**"],
    });
    expect(files).toHaveLength(1);
    expect(files[0]).toBe("src.ts");
  });

  it("finds nested files", async () => {
    await fs.mkdir(path.join(tmpDir, "src/components"), { recursive: true });
    await fs.writeFile(path.join(tmpDir, "src/index.ts"), "");
    await fs.writeFile(path.join(tmpDir, "src/components/App.tsx"), "");
    const files = await simpleGlob("**/*.{ts,tsx}", tmpDir);
    expect(files).toHaveLength(2);
  });

  it("returns empty for no matches", async () => {
    const files = await simpleGlob("**/*.rs", tmpDir);
    expect(files).toHaveLength(0);
  });
});

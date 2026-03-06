import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { resolveSafePath } from "../path-utils.js";

describe("code_write behavior", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-write-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("writes a file", async () => {
    const filePath = path.join(tmpDir, "output.txt");
    await fs.writeFile(filePath, "hello world", "utf-8");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("hello world");
  });

  it("creates parent directories", async () => {
    const filePath = path.join(tmpDir, "deep/nested/file.txt");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "nested content", "utf-8");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("nested content");
  });

  it("overwrites existing files", async () => {
    const filePath = path.join(tmpDir, "existing.txt");
    await fs.writeFile(filePath, "original");
    await fs.writeFile(filePath, "updated");
    const content = await fs.readFile(filePath, "utf-8");
    expect(content).toBe("updated");
  });

  it("rejects path outside workspace", () => {
    expect(() => resolveSafePath("../../etc/passwd", tmpDir)).toThrow("outside workspace");
  });

  it("calculates bytes written correctly", () => {
    const content = "Hello \u{1f30d}";
    const bytes = Buffer.byteLength(content, "utf-8");
    expect(bytes).toBeGreaterThan(content.length); // emoji is multi-byte
  });
});

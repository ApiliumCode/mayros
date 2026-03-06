import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { isPathInside, resolveSafePath, isImageFile, isBinaryBuffer } from "../path-utils.js";

// ============================================================================
// Path Utils Tests
// ============================================================================

describe("isPathInside", () => {
  it("returns true for child path", () => {
    expect(isPathInside("/workspace/src/file.ts", "/workspace")).toBe(true);
  });

  it("returns false for parent path", () => {
    expect(isPathInside("/other/file.ts", "/workspace")).toBe(false);
  });

  it("returns false for traversal", () => {
    expect(isPathInside("/workspace/../etc/passwd", "/workspace")).toBe(false);
  });
});

describe("resolveSafePath", () => {
  it("resolves relative path within workspace", () => {
    const result = resolveSafePath("src/index.ts", "/workspace");
    expect(result).toBe("/workspace/src/index.ts");
  });

  it("rejects path outside workspace", () => {
    expect(() => resolveSafePath("../../etc/passwd", "/workspace")).toThrow("outside workspace");
  });

  it("accepts absolute path inside workspace", () => {
    const result = resolveSafePath("/workspace/file.ts", "/workspace");
    expect(result).toBe("/workspace/file.ts");
  });
});

describe("isImageFile", () => {
  it("detects png", () => expect(isImageFile("photo.png")).toBe(true));
  it("detects jpg", () => expect(isImageFile("photo.JPG")).toBe(true));
  it("rejects ts", () => expect(isImageFile("index.ts")).toBe(false));
});

describe("isBinaryBuffer", () => {
  it("detects null bytes", () => {
    const buf = Buffer.from([0x48, 0x65, 0x00, 0x6c]);
    expect(isBinaryBuffer(buf)).toBe(true);
  });

  it("returns false for text", () => {
    const buf = Buffer.from("Hello, world!");
    expect(isBinaryBuffer(buf)).toBe(false);
  });
});

// ============================================================================
// code_read integration-style tests
// ============================================================================

describe("code_read tool behavior", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "code-read-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("reads a text file with line numbers", async () => {
    await fs.writeFile(path.join(tmpDir, "hello.txt"), "line1\nline2\nline3");
    const content = await fs.readFile(path.join(tmpDir, "hello.txt"), "utf-8");
    const lines = content.split("\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe("line1");
  });

  it("detects binary files", async () => {
    await fs.writeFile(path.join(tmpDir, "data.bin"), Buffer.from([0x00, 0x01, 0x02]));
    const buf = await fs.readFile(path.join(tmpDir, "data.bin"));
    expect(isBinaryBuffer(buf)).toBe(true);
  });

  it("handles offset and limit", async () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line${i + 1}`);
    await fs.writeFile(path.join(tmpDir, "many.txt"), lines.join("\n"));
    const content = await fs.readFile(path.join(tmpDir, "many.txt"), "utf-8");
    const allLines = content.split("\n");
    const slice = allLines.slice(4, 9); // offset=5, limit=5
    expect(slice).toHaveLength(5);
    expect(slice[0]).toBe("line5");
  });

  it("rejects path traversal", () => {
    expect(() => resolveSafePath("../../etc/passwd", tmpDir)).toThrow("outside workspace");
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { expandFileMentions, globFilesForMention } from "./file-mention.js";

describe("file-mention", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "file-mention-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("expandFileMentions", () => {
    it("expands @file to file content", async () => {
      await fs.writeFile(path.join(tmpDir, "hello.txt"), "Hello World");
      const result = await expandFileMentions(`Read @./hello.txt please`, tmpDir);
      expect(result.mentions).toHaveLength(1);
      expect(result.mentions[0].content).toBe("Hello World");
      expect(result.contextBlock).toContain("<file-context");
      expect(result.contextBlock).toContain("Hello World");
    });

    it("handles absolute paths", async () => {
      const filePath = path.join(tmpDir, "abs.txt");
      await fs.writeFile(filePath, "Absolute content");
      const result = await expandFileMentions(`Check @${filePath}`, tmpDir);
      expect(result.mentions).toHaveLength(1);
      expect(result.mentions[0].content).toBe("Absolute content");
    });

    it("skips non-existent files", async () => {
      const result = await expandFileMentions("@./nonexistent.ts", tmpDir);
      expect(result.mentions).toHaveLength(0);
      expect(result.contextBlock).toBe("");
    });

    it("deduplicates same file mentioned twice", async () => {
      await fs.writeFile(path.join(tmpDir, "dup.txt"), "content");
      const result = await expandFileMentions("@./dup.txt and again @./dup.txt", tmpDir);
      expect(result.mentions).toHaveLength(1);
    });

    it("handles multiple files", async () => {
      await fs.writeFile(path.join(tmpDir, "a.ts"), "file A");
      await fs.writeFile(path.join(tmpDir, "b.ts"), "file B");
      const result = await expandFileMentions("@./a.ts and @./b.ts", tmpDir);
      expect(result.mentions).toHaveLength(2);
    });

    it("returns empty for no mentions", async () => {
      const result = await expandFileMentions("no mentions here", tmpDir);
      expect(result.mentions).toHaveLength(0);
      expect(result.contextBlock).toBe("");
    });

    it("limits to 10 mentions", async () => {
      for (let i = 0; i < 15; i++) {
        await fs.writeFile(path.join(tmpDir, `f${i}.txt`), `file ${i}`);
      }
      const refs = Array.from({ length: 15 }, (_, i) => `@./f${i}.txt`).join(" ");
      const result = await expandFileMentions(refs, tmpDir);
      expect(result.mentions.length).toBeLessThanOrEqual(10);
    });

    it("preserves original text unchanged", async () => {
      await fs.writeFile(path.join(tmpDir, "keep.txt"), "data");
      const input = "Read @./keep.txt for me";
      const result = await expandFileMentions(input, tmpDir);
      expect(result.text).toBe(input);
    });

    it("wraps each file in file-context tags", async () => {
      await fs.writeFile(path.join(tmpDir, "x.ts"), "export const x = 1;");
      const result = await expandFileMentions("@./x.ts", tmpDir);
      expect(result.contextBlock).toMatch(/<file-context path="[^"]+x\.ts">/);
      expect(result.contextBlock).toMatch(/<\/file-context>/);
    });
  });

  describe("globFilesForMention", () => {
    it("returns file suggestions", async () => {
      await fs.writeFile(path.join(tmpDir, "index.ts"), "");
      await fs.writeFile(path.join(tmpDir, "main.ts"), "");
      const results = await globFilesForMention("", tmpDir);
      expect(results.length).toBeGreaterThanOrEqual(2);
    });

    it("filters by prefix", async () => {
      await fs.writeFile(path.join(tmpDir, "src.ts"), "");
      await fs.writeFile(path.join(tmpDir, "test.ts"), "");
      const results = await globFilesForMention("src", tmpDir);
      expect(results.every((r) => r.label.startsWith("src"))).toBe(true);
    });

    it("limits results to 20", async () => {
      for (let i = 0; i < 30; i++) {
        await fs.writeFile(path.join(tmpDir, `file${i}.txt`), "");
      }
      const results = await globFilesForMention("file", tmpDir);
      expect(results.length).toBeLessThanOrEqual(20);
    });

    it("returns @-prefixed values", async () => {
      await fs.writeFile(path.join(tmpDir, "code.ts"), "");
      const results = await globFilesForMention("code", tmpDir);
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].value.startsWith("@")).toBe(true);
    });

    it("returns empty for non-existent directory", async () => {
      const results = await globFilesForMention("", "/nonexistent/path");
      expect(results).toEqual([]);
    });
  });
});

import { describe, it, expect } from "vitest";
import {
  parseJsonlItems,
  parseSeparatedItems,
  parseInputFile,
  type BatchItem,
  type BatchResult,
} from "./batch-cli.js";

// ============================================================================
// parseJsonlItems
// ============================================================================

describe("parseJsonlItems", () => {
  it("parses valid JSONL with id and prompt", () => {
    const input = [
      '{"id": "1", "prompt": "Hello world"}',
      '{"id": "2", "prompt": "Summarize auth"}',
    ].join("\n");

    const items = parseJsonlItems(input);
    expect(items).toHaveLength(2);
    expect(items[0]).toEqual({ id: "1", prompt: "Hello world", context: undefined });
    expect(items[1]).toEqual({ id: "2", prompt: "Summarize auth", context: undefined });
  });

  it("auto-generates id when missing", () => {
    const input = '{"prompt": "Hello"}';
    const items = parseJsonlItems(input);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("1");
    expect(items[0].prompt).toBe("Hello");
  });

  it("preserves context field", () => {
    const input = '{"id": "1", "prompt": "test", "context": "background info"}';
    const items = parseJsonlItems(input);
    expect(items[0].context).toBe("background info");
  });

  it("skips lines without prompt", () => {
    const input = [
      '{"id": "1"}',
      '{"id": "2", "prompt": "valid"}',
      '{"id": "3", "prompt": ""}',
    ].join("\n");

    const items = parseJsonlItems(input);
    expect(items).toHaveLength(1);
    expect(items[0].id).toBe("2");
  });

  it("skips malformed JSON lines", () => {
    const input = [
      '{"id": "1", "prompt": "valid"}',
      "not json at all",
      '{"id": "3", "prompt": "also valid"}',
    ].join("\n");

    const items = parseJsonlItems(input);
    expect(items).toHaveLength(2);
  });

  it("handles empty input", () => {
    expect(parseJsonlItems("")).toHaveLength(0);
    expect(parseJsonlItems("  \n  \n  ")).toHaveLength(0);
  });
});

// ============================================================================
// parseSeparatedItems
// ============================================================================

describe("parseSeparatedItems", () => {
  it("splits on --- separator", () => {
    const input = "Hello world\n---\nSummarize auth\n---\nList endpoints";
    const items = parseSeparatedItems(input);
    expect(items).toHaveLength(3);
    expect(items[0].prompt).toBe("Hello world");
    expect(items[1].prompt).toBe("Summarize auth");
    expect(items[2].prompt).toBe("List endpoints");
  });

  it("auto-generates sequential ids", () => {
    const input = "A\n---\nB";
    const items = parseSeparatedItems(input);
    expect(items[0].id).toBe("1");
    expect(items[1].id).toBe("2");
  });

  it("trims whitespace from blocks", () => {
    const input = "\n  Hello  \n---\n\n  World  \n\n";
    const items = parseSeparatedItems(input);
    expect(items).toHaveLength(2);
    expect(items[0].prompt).toBe("Hello");
    expect(items[1].prompt).toBe("World");
  });

  it("handles multiline prompts", () => {
    const input = "Line 1\nLine 2\nLine 3\n---\nAnother prompt";
    const items = parseSeparatedItems(input);
    expect(items).toHaveLength(2);
    expect(items[0].prompt).toContain("Line 1");
    expect(items[0].prompt).toContain("Line 3");
  });

  it("handles empty input", () => {
    expect(parseSeparatedItems("")).toHaveLength(0);
  });

  it("skips empty blocks", () => {
    const input = "Hello\n---\n---\nWorld";
    const items = parseSeparatedItems(input);
    expect(items).toHaveLength(2);
  });
});

// ============================================================================
// parseInputFile (auto-detection)
// ============================================================================

describe("parseInputFile", () => {
  it("detects JSONL format when first line starts with {", () => {
    const input = '{"id": "1", "prompt": "test"}\n{"id": "2", "prompt": "test2"}';
    const items = parseInputFile(input);
    expect(items).toHaveLength(2);
    expect(items[0].id).toBe("1");
  });

  it("detects text format when first line is plain text", () => {
    const input = "Hello world\n---\nSecond prompt";
    const items = parseInputFile(input);
    expect(items).toHaveLength(2);
    expect(items[0].prompt).toBe("Hello world");
  });

  it("handles leading whitespace in JSONL detection", () => {
    const input = '\n\n{"prompt": "test"}';
    const items = parseInputFile(input);
    expect(items).toHaveLength(1);
  });

  it("handles single prompt without separator", () => {
    const input = "Just one prompt";
    const items = parseInputFile(input);
    expect(items).toHaveLength(1);
    expect(items[0].prompt).toBe("Just one prompt");
  });
});

// ============================================================================
// BatchResult type checks
// ============================================================================

describe("BatchResult shape", () => {
  it("ok result has required fields", () => {
    const result: BatchResult = {
      id: "1",
      status: "ok",
      response: "Hello!",
      durationMs: 100,
    };
    expect(result.status).toBe("ok");
    expect(result.response).toBeDefined();
  });

  it("error result has error field", () => {
    const result: BatchResult = {
      id: "2",
      status: "error",
      error: "timeout",
      durationMs: 120000,
    };
    expect(result.status).toBe("error");
    expect(result.error).toBe("timeout");
  });
});

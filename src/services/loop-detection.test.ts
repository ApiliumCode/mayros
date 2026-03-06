import { describe, expect, it } from "vitest";
import { LoopDetector, normalizeContent, similarity } from "./loop-detection.js";

describe("normalizeContent", () => {
  it("lowercases and collapses whitespace", () => {
    expect(normalizeContent("  Hello   World  ")).toBe("hello world");
  });

  it("returns empty string for blank input", () => {
    expect(normalizeContent("   ")).toBe("");
  });
});

describe("similarity", () => {
  it("returns 1.0 for identical normalised strings", () => {
    expect(similarity("Hello World", "hello world")).toBe(1.0);
  });

  it("returns 0.0 when one string is empty", () => {
    expect(similarity("abc", "")).toBe(0.0);
  });

  it("returns a value between 0 and 1 for partially matching strings", () => {
    const score = similarity("fix the bug in parser", "fix the bug in scanner");
    expect(score).toBeGreaterThan(0.4);
    expect(score).toBeLessThan(1.0);
  });
});

describe("LoopDetector", () => {
  it("detects no loop when entries are unique", () => {
    const detector = new LoopDetector({ maxRepeats: 3, windowSize: 5 });
    const r1 = detector.addEntry({ type: "tool-call", content: "read file A", timestamp: 1 });
    const r2 = detector.addEntry({ type: "tool-call", content: "edit file B", timestamp: 2 });
    expect(r1.detected).toBe(false);
    expect(r2.detected).toBe(false);
  });

  it("detects a loop when the same content repeats >= maxRepeats", () => {
    const detector = new LoopDetector({ maxRepeats: 3, windowSize: 10 });
    detector.addEntry({ type: "tool-call", content: "read file X", timestamp: 1 });
    detector.addEntry({ type: "tool-call", content: "read file X", timestamp: 2 });
    const result = detector.addEntry({ type: "tool-call", content: "read file X", timestamp: 3 });

    expect(result.detected).toBe(true);
    expect(result.repeatCount).toBe(3);
    expect(result.pattern).toBe("read file x");
  });

  it("detects loops using similarity threshold for near-identical entries", () => {
    const detector = new LoopDetector({
      maxRepeats: 3,
      windowSize: 10,
      similarityThreshold: 0.8,
    });
    detector.addEntry({
      type: "response",
      content: "The file contains errors on line 10",
      timestamp: 1,
    });
    detector.addEntry({
      type: "response",
      content: "The file contains errors on line 10",
      timestamp: 2,
    });
    const result = detector.addEntry({
      type: "response",
      content: "The file contains errors on line 10.",
      timestamp: 3,
    });

    expect(result.detected).toBe(true);
    expect(result.repeatCount).toBe(3);
  });

  it("trims entries to windowSize", () => {
    const detector = new LoopDetector({ maxRepeats: 3, windowSize: 4 });
    // Push 3 identical entries, then 2 different ones — the first identical
    // entries should be evicted.
    detector.addEntry({ type: "tool-call", content: "A", timestamp: 1 });
    detector.addEntry({ type: "tool-call", content: "A", timestamp: 2 });
    detector.addEntry({ type: "tool-call", content: "A", timestamp: 3 });
    // Now window has [A, A, A, B] after next add:
    detector.addEntry({ type: "tool-call", content: "B", timestamp: 4 });
    // Window becomes [A, A, B, C]:
    const result = detector.addEntry({ type: "tool-call", content: "C", timestamp: 5 });

    // Only 2 "A" entries remain in the window of 4.
    expect(result.detected).toBe(false);
    expect(result.repeatCount).toBeLessThan(3);
  });

  it("resets all entries", () => {
    const detector = new LoopDetector({ maxRepeats: 2, windowSize: 5 });
    detector.addEntry({ type: "tool-call", content: "repeat", timestamp: 1 });
    detector.addEntry({ type: "tool-call", content: "repeat", timestamp: 2 });
    expect(detector.check().detected).toBe(true);

    detector.reset();
    expect(detector.check().detected).toBe(false);
    expect(detector.check().repeatCount).toBe(0);
  });
});

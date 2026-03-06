import { describe, it, expect } from "vitest";
import { evaluateCompaction } from "./compaction-trigger.js";
import type { CompactionInput, CompactionDecision } from "./compaction-trigger.js";

describe("evaluateCompaction", () => {
  it("does not trigger at exactly 95% (must be strictly greater)", () => {
    const result: CompactionDecision = evaluateCompaction({
      usedTokens: 121_600,
      contextWindow: 128_000,
    });
    // 121600 / 128000 = 0.95 exactly
    expect(result.usageRatio).toBe(0.95);
    expect(result.shouldCompact).toBe(false);
  });

  it("triggers just above 95%", () => {
    const result = evaluateCompaction({
      usedTokens: 121_601,
      contextWindow: 128_000,
    });
    expect(result.usageRatio).toBeGreaterThan(0.95);
    expect(result.shouldCompact).toBe(true);
  });

  it("triggers at 100% usage", () => {
    const result = evaluateCompaction({
      usedTokens: 128_000,
      contextWindow: 128_000,
    });
    expect(result.usageRatio).toBe(1);
    expect(result.usagePercent).toBe(100);
    expect(result.shouldCompact).toBe(true);
  });

  it("does not trigger and avoids division by zero when contextWindow is 0", () => {
    const result = evaluateCompaction({
      usedTokens: 50_000,
      contextWindow: 0,
    });
    expect(result.shouldCompact).toBe(false);
    expect(result.usageRatio).toBe(0);
    expect(result.usagePercent).toBe(0);
  });

  it("does not trigger with negative contextWindow", () => {
    const result = evaluateCompaction({
      usedTokens: 1000,
      contextWindow: -1,
    });
    expect(result.shouldCompact).toBe(false);
    expect(result.usageRatio).toBe(0);
  });

  it("handles negative usedTokens without triggering", () => {
    const result = evaluateCompaction({
      usedTokens: -500,
      contextWindow: 128_000,
    });
    expect(result.usageRatio).toBeLessThan(0);
    expect(result.shouldCompact).toBe(false);
  });

  it("uses a custom threshold of 0.80", () => {
    const input: CompactionInput = {
      usedTokens: 103_000,
      contextWindow: 128_000,
      threshold: 0.8,
    };
    const result = evaluateCompaction(input);
    // 103000 / 128000 ~ 0.8047
    expect(result.usageRatio).toBeGreaterThan(0.8);
    expect(result.shouldCompact).toBe(true);
  });

  it("does not trigger at exactly the custom threshold", () => {
    const result = evaluateCompaction({
      usedTokens: 80_000,
      contextWindow: 100_000,
      threshold: 0.8,
    });
    // 80000 / 100000 = 0.80 exactly, must be strictly greater
    expect(result.usageRatio).toBe(0.8);
    expect(result.shouldCompact).toBe(false);
  });

  it("handles very large token counts (100M+)", () => {
    const result = evaluateCompaction({
      usedTokens: 196_000_000,
      contextWindow: 200_000_000,
    });
    expect(result.usageRatio).toBeCloseTo(0.98, 2);
    expect(result.shouldCompact).toBe(true);
    expect(result.usagePercent).toBe(98);
  });

  it("calculates usage percent correctly with rounding", () => {
    const result = evaluateCompaction({
      usedTokens: 190_001,
      contextWindow: 200_000,
    });
    // 190001 / 200000 = 0.9500005 => rounds to 95%
    expect(result.usagePercent).toBe(95);
    expect(result.shouldCompact).toBe(true);
  });

  it("returns 0% for zero tokens used", () => {
    const result = evaluateCompaction({
      usedTokens: 0,
      contextWindow: 128_000,
    });
    expect(result.usageRatio).toBe(0);
    expect(result.usagePercent).toBe(0);
    expect(result.shouldCompact).toBe(false);
  });

  it("defaults threshold to 0.95 when not provided", () => {
    // Just below 95%: should not compact
    const below = evaluateCompaction({
      usedTokens: 121_599,
      contextWindow: 128_000,
    });
    expect(below.shouldCompact).toBe(false);

    // Just above 95%: should compact
    const above = evaluateCompaction({
      usedTokens: 121_601,
      contextWindow: 128_000,
    });
    expect(above.shouldCompact).toBe(true);
  });
});

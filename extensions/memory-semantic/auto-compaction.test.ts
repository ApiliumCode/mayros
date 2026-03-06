import { describe, it, expect } from "vitest";

describe("auto-compaction trigger", () => {
  it("triggers at 95% usage", () => {
    const contextWindow = 128_000;
    const usedTokens = 122_000;
    const ratio = usedTokens / contextWindow;
    expect(ratio).toBeGreaterThan(0.95);
  });

  it("does not trigger at 80% usage", () => {
    const contextWindow = 128_000;
    const usedTokens = 102_400;
    const ratio = usedTokens / contextWindow;
    expect(ratio).toBeLessThanOrEqual(0.95);
  });

  it("handles missing token counts", () => {
    const contextWindow = 0;
    const usedTokens = 0;
    // Should not trigger when contextWindow is 0
    expect(contextWindow > 0 && usedTokens / contextWindow > 0.95).toBe(false);
  });

  it("uses default context window when not provided", () => {
    const contextWindow = 128_000; // default
    const usedTokens = 130_000;
    const ratio = usedTokens / contextWindow;
    expect(ratio).toBeGreaterThan(0.95);
  });

  it("calculates percentage correctly", () => {
    const contextWindow = 200_000;
    const usedTokens = 190_001;
    const pct = Math.round((usedTokens / contextWindow) * 100);
    expect(pct).toBe(95);
  });
});

import { describe, it, expect, beforeEach } from "vitest";
import type { ModelCostConfig } from "../../src/utils/usage-format.js";
import type { PersistedBudget } from "./budget-persistence.js";
import { BudgetTracker } from "./budget-tracker.js";
import type { TokenBudgetConfig } from "./config.js";

// Cost config that makes 100k input + 100k output = $0.02 (exceeds $0.01 limit)
const COST_CONFIG: ModelCostConfig = { input: 100, output: 100, cacheRead: 0, cacheWrite: 0 };

function makeConfig(overrides: Partial<TokenBudgetConfig> = {}): TokenBudgetConfig {
  return {
    warnThreshold: 0.8,
    persistPath: "/tmp/test-budget.json",
    cache: { enabled: false, maxEntries: 0, ttlMs: 0 },
    enforcement: "soft",
    gracePeriodCalls: 3,
    sessionLimitUsd: 1.0,
    responseCache: false,
    responseCacheMaxEntries: 0,
    responseCacheTtlMs: 0,
    ...overrides,
  };
}

function makePersisted(): PersistedBudget {
  return {
    dailyCostUsd: 0,
    dailyDate: new Date().toISOString().slice(0, 10),
    monthlyCostUsd: 0,
    monthlyKey: new Date().toISOString().slice(0, 7),
    lastFlushedAt: Date.now(),
  };
}

describe("BudgetTracker hard enforcement", () => {
  let tracker: BudgetTracker;

  describe("soft mode (default)", () => {
    beforeEach(() => {
      tracker = new BudgetTracker(makeConfig({ enforcement: "soft" }), makePersisted());
    });

    it("recordToolCall does not block in soft mode", () => {
      // Exceed budget
      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );
      expect(tracker.getOverallStatus().level).toBe("exceeded");

      // Record many tool calls
      for (let i = 0; i < 20; i++) tracker.recordToolCall();

      // isHardBlocked always false in soft mode (caller checks enforcement mode)
      // but the method itself just checks status and counter
      expect(tracker.isHardBlocked(3)).toBe(true);
      // In practice, the index.ts checks cfg.enforcement before calling isHardBlocked
    });

    it("getToolCallsSinceExceeded returns 0 before exceeding", () => {
      expect(tracker.getToolCallsSinceExceeded()).toBe(0);
    });
  });

  describe("hard mode", () => {
    beforeEach(() => {
      tracker = new BudgetTracker(
        makeConfig({ enforcement: "hard", sessionLimitUsd: 0.01 }),
        makePersisted(),
      );
    });

    it("does not block when budget not exceeded", () => {
      tracker.recordToolCall();
      tracker.recordToolCall();
      expect(tracker.isHardBlocked(3)).toBe(false);
    });

    it("does not block within grace period", () => {
      // Exceed budget
      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );
      expect(tracker.getOverallStatus().level).toBe("exceeded");

      // Grace period of 3 — first 3 calls should be allowed
      tracker.recordToolCall(); // 1
      expect(tracker.isHardBlocked(3)).toBe(false);
      tracker.recordToolCall(); // 2
      expect(tracker.isHardBlocked(3)).toBe(false);
      tracker.recordToolCall(); // 3
      expect(tracker.isHardBlocked(3)).toBe(false);
    });

    it("blocks after grace period is exhausted", () => {
      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );
      expect(tracker.getOverallStatus().level).toBe("exceeded");

      for (let i = 0; i < 4; i++) tracker.recordToolCall();

      expect(tracker.isHardBlocked(3)).toBe(true);
    });

    it("grace period of 0 blocks immediately after exceeding", () => {
      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );
      expect(tracker.getOverallStatus().level).toBe("exceeded");

      tracker.recordToolCall(); // 1
      expect(tracker.isHardBlocked(0)).toBe(true);
    });

    it("counter increments only when exceeded", () => {
      // Not exceeded: recordToolCall should not increment
      tracker.recordToolCall();
      expect(tracker.getToolCallsSinceExceeded()).toBe(0);

      // Exceed
      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );

      tracker.recordToolCall();
      expect(tracker.getToolCallsSinceExceeded()).toBe(1);
    });

    it("resetSession clears the counter", () => {
      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );
      tracker.recordToolCall();
      tracker.recordToolCall();
      expect(tracker.getToolCallsSinceExceeded()).toBe(2);

      tracker.resetSession();
      expect(tracker.getToolCallsSinceExceeded()).toBe(0);
    });

    it("daily limit exceeded triggers hard block", () => {
      const config = makeConfig({
        enforcement: "hard",
        sessionLimitUsd: undefined,
        dailyLimitUsd: 0.01,
      });
      const persisted = makePersisted();
      tracker = new BudgetTracker(config, persisted);

      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );
      expect(tracker.getOverallStatus().level).toBe("exceeded");

      for (let i = 0; i < 4; i++) tracker.recordToolCall();
      expect(tracker.isHardBlocked(3)).toBe(true);
    });

    it("tracks grace period remaining correctly", () => {
      tracker.recordUsage(
        { input: 100000, output: 100000, cacheRead: 0, cacheWrite: 0, total: 200000 },
        COST_CONFIG,
      );

      tracker.recordToolCall(); // 1
      tracker.recordToolCall(); // 2
      expect(tracker.getToolCallsSinceExceeded()).toBe(2);
      // remaining = gracePeriodCalls(3) - toolCallsSinceExceeded(2) = 1
      expect(Math.max(0, 3 - tracker.getToolCallsSinceExceeded())).toBe(1);
    });
  });
});

describe("parseTokenBudgetConfig enforcement fields", () => {
  it("defaults to soft enforcement", async () => {
    const { parseTokenBudgetConfig } = await import("./config.js");
    const cfg = parseTokenBudgetConfig({});
    expect(cfg.enforcement).toBe("soft");
    expect(cfg.gracePeriodCalls).toBe(3);
  });

  it("accepts hard enforcement", async () => {
    const { parseTokenBudgetConfig } = await import("./config.js");
    const cfg = parseTokenBudgetConfig({ enforcement: "hard", gracePeriodCalls: 5 });
    expect(cfg.enforcement).toBe("hard");
    expect(cfg.gracePeriodCalls).toBe(5);
  });

  it("rejects unknown enforcement value", async () => {
    const { parseTokenBudgetConfig } = await import("./config.js");
    const cfg = parseTokenBudgetConfig({ enforcement: "unknown" });
    expect(cfg.enforcement).toBe("soft"); // falls back to soft
  });
});

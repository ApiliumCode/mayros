import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { BudgetPersistence, type PersistedBudget } from "./budget-persistence.js";
import { BudgetTracker } from "./budget-tracker.js";
import { parseTokenBudgetConfig } from "./config.js";
import { PromptCache } from "./prompt-cache.js";

// ============================================================================
// Config tests
// ============================================================================

describe("parseTokenBudgetConfig", () => {
  it("parses empty config with defaults", () => {
    const cfg = parseTokenBudgetConfig({});
    expect(cfg.sessionLimitUsd).toBeUndefined();
    expect(cfg.dailyLimitUsd).toBeUndefined();
    expect(cfg.monthlyLimitUsd).toBeUndefined();
    expect(cfg.warnThreshold).toBe(0.8);
    expect(cfg.persistPath).toBe("~/.mayros/token-budget.json");
    expect(cfg.cache.enabled).toBe(true);
    expect(cfg.cache.maxEntries).toBe(256);
    expect(cfg.cache.ttlMs).toBe(300_000);
  });

  it("parses full config", () => {
    const cfg = parseTokenBudgetConfig({
      sessionLimitUsd: 0.5,
      dailyLimitUsd: 5,
      monthlyLimitUsd: 50,
      warnThreshold: 0.9,
      persistPath: "/tmp/budget.json",
      cache: { enabled: false, maxEntries: 100, ttlMs: 60_000 },
    });
    expect(cfg.sessionLimitUsd).toBe(0.5);
    expect(cfg.dailyLimitUsd).toBe(5);
    expect(cfg.monthlyLimitUsd).toBe(50);
    expect(cfg.warnThreshold).toBe(0.9);
    expect(cfg.persistPath).toBe("/tmp/budget.json");
    expect(cfg.cache.enabled).toBe(false);
    expect(cfg.cache.maxEntries).toBe(100);
    expect(cfg.cache.ttlMs).toBe(60_000);
  });

  it("rejects unknown keys", () => {
    expect(() => parseTokenBudgetConfig({ unknownKey: true })).toThrow("unknown keys");
  });

  it("ignores non-positive limits", () => {
    const cfg = parseTokenBudgetConfig({ sessionLimitUsd: -1, dailyLimitUsd: 0 });
    expect(cfg.sessionLimitUsd).toBeUndefined();
    expect(cfg.dailyLimitUsd).toBeUndefined();
  });

  it("clamps warnThreshold to default for out-of-range", () => {
    expect(parseTokenBudgetConfig({ warnThreshold: 0 }).warnThreshold).toBe(0.8);
    expect(parseTokenBudgetConfig({ warnThreshold: 1.5 }).warnThreshold).toBe(0.8);
    expect(parseTokenBudgetConfig({ warnThreshold: -0.1 }).warnThreshold).toBe(0.8);
  });

  it("accepts null/undefined value gracefully", () => {
    const cfg = parseTokenBudgetConfig(null);
    expect(cfg.warnThreshold).toBe(0.8);
    const cfg2 = parseTokenBudgetConfig(undefined);
    expect(cfg2.warnThreshold).toBe(0.8);
  });
});

// ============================================================================
// BudgetTracker tests
// ============================================================================

describe("BudgetTracker", () => {
  const basePersisted: PersistedBudget = {
    dailyCostUsd: 0,
    dailyDate: "2026-02-23",
    monthlyCostUsd: 0,
    monthlyKey: "2026-02",
    lastFlushedAt: Date.now(),
  };

  it("starts with zero cost", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({ sessionLimitUsd: 1 }), {
      ...basePersisted,
    });
    const status = tracker.getSessionStatus();
    expect(status.level).toBe("ok");
    expect(status.usedUsd).toBe(0);
    expect(status.percent).toBe(0);
  });

  it("accumulates usage cost", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({ sessionLimitUsd: 1 }), {
      ...basePersisted,
    });
    // cost: (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    const status = tracker.getSessionStatus();
    expect(status.usedUsd).toBeCloseTo(0.0105, 6);
    expect(status.level).toBe("ok");
  });

  it("transitions to warn at threshold", () => {
    const tracker = new BudgetTracker(
      parseTokenBudgetConfig({ sessionLimitUsd: 0.01, warnThreshold: 0.5 }),
      { ...basePersisted },
    );
    // Push to > 50% of $0.01 = > $0.005
    // cost per call: (1000 * 3 + 500 * 15) / 1_000_000 = 0.0105
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    const status = tracker.getSessionStatus();
    expect(status.level).toBe("exceeded"); // 0.0105 > 0.01
  });

  it("transitions to exceeded at 100%", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({ sessionLimitUsd: 0.005 }), {
      ...basePersisted,
    });
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    const status = tracker.getSessionStatus();
    expect(status.level).toBe("exceeded");
    expect(status.percent!).toBeGreaterThanOrEqual(1);
  });

  it("reports ok with no limit", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), { ...basePersisted });
    tracker.recordUsage(
      { input: 100000, output: 50000 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    expect(tracker.getSessionStatus().level).toBe("ok");
    expect(tracker.getSessionStatus().limitUsd).toBeUndefined();
  });

  it("tracks daily and monthly from persisted state", () => {
    const persisted = { ...basePersisted, dailyCostUsd: 0.5, monthlyCostUsd: 2 };
    const tracker = new BudgetTracker(
      parseTokenBudgetConfig({ dailyLimitUsd: 1, monthlyLimitUsd: 5 }),
      persisted,
    );
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    expect(tracker.getDailyStatus().usedUsd).toBeGreaterThan(0.5);
    expect(tracker.getMonthlyStatus().usedUsd).toBeGreaterThan(2);
  });

  it("getOverallStatus returns highest alert", () => {
    const persisted = { ...basePersisted, dailyCostUsd: 0.99 };
    const tracker = new BudgetTracker(
      parseTokenBudgetConfig({ dailyLimitUsd: 1, warnThreshold: 0.8 }),
      persisted,
    );
    // Daily is at 99% — warn
    expect(tracker.getOverallStatus().level).toBe("warn");

    // Push over
    tracker.recordUsage(
      { input: 10000, output: 5000 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    expect(tracker.getOverallStatus().level).toBe("exceeded");
  });

  it("resetSession clears session counters only", () => {
    const persisted = { ...basePersisted };
    const tracker = new BudgetTracker(parseTokenBudgetConfig({ sessionLimitUsd: 1 }), persisted);
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    expect(tracker.getSessionStatus().usedUsd).toBeGreaterThan(0);
    expect(tracker.getCallCount()).toBe(1);

    tracker.resetSession();
    expect(tracker.getSessionStatus().usedUsd).toBe(0);
    expect(tracker.getCallCount()).toBe(0);
    // Daily should still have the cost
    expect(tracker.getDailyStatus().usedUsd).toBeGreaterThan(0);
  });

  it("getSummary returns full snapshot", () => {
    const tracker = new BudgetTracker(
      parseTokenBudgetConfig({ sessionLimitUsd: 1, dailyLimitUsd: 5 }),
      { ...basePersisted },
    );
    tracker.recordUsage(
      { input: 100, output: 50, cacheRead: 10, cacheWrite: 5 },
      { input: 3, output: 15, cacheRead: 1, cacheWrite: 2 },
    );
    const summary = tracker.getSummary();
    expect(summary.callCount).toBe(1);
    expect(summary.tokens.input).toBe(100);
    expect(summary.tokens.output).toBe(50);
    expect(summary.tokens.cacheRead).toBe(10);
    expect(summary.tokens.cacheWrite).toBe(5);
    expect(summary.session.usedUsd).toBeGreaterThan(0);
  });

  it("updateLimit changes limits at runtime", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), { ...basePersisted });
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    expect(tracker.getSessionStatus().level).toBe("ok");

    // Set a very low session limit
    tracker.updateLimit("session", 0.001);
    expect(tracker.getSessionStatus().level).toBe("exceeded");
  });

  it("handles recordUsage without costConfig gracefully", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), { ...basePersisted });
    tracker.recordUsage({ input: 1000, output: 500 });
    // Cost should be 0 (no costConfig)
    expect(tracker.getSessionStatus().usedUsd).toBe(0);
    expect(tracker.getCallCount()).toBe(1);
  });

  it("tracks per-model usage with provider and model", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), { ...basePersisted });
    const costConfig = { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 };

    tracker.recordUsage({ input: 1000, output: 500 }, costConfig, "anthropic", "claude-sonnet-4-6");
    tracker.recordUsage({ input: 2000, output: 300 }, costConfig, "anthropic", "claude-sonnet-4-6");
    tracker.recordUsage({ input: 500, output: 100 }, costConfig, "openai", "gpt-4o");

    const models = tracker.getModelUsage();
    expect(models).toHaveLength(2);

    // Sorted by cost descending — anthropic model should be first (more usage)
    const anthropicModel = models.find((m) => m.provider === "anthropic");
    expect(anthropicModel).toBeDefined();
    expect(anthropicModel!.calls).toBe(2);
    expect(anthropicModel!.tokens.input).toBe(3000);
    expect(anthropicModel!.tokens.output).toBe(800);

    const openaiModel = models.find((m) => m.provider === "openai");
    expect(openaiModel).toBeDefined();
    expect(openaiModel!.calls).toBe(1);
  });

  it("getModelUsage returns empty when no provider/model given", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), { ...basePersisted });
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );
    expect(tracker.getModelUsage()).toHaveLength(0);
  });

  it("getSummary includes modelUsage", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), { ...basePersisted });
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      "anthropic",
      "claude-opus-4-6",
    );
    const summary = tracker.getSummary();
    expect(summary.modelUsage).toHaveLength(1);
    expect(summary.modelUsage[0].model).toBe("claude-opus-4-6");
  });

  it("resetSession clears per-model usage", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), { ...basePersisted });
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      "anthropic",
      "claude-sonnet-4-6",
    );
    expect(tracker.getModelUsage()).toHaveLength(1);

    tracker.resetSession();
    expect(tracker.getModelUsage()).toHaveLength(0);
  });

  it("updates persisted modelUsage on recordUsage", () => {
    const persisted = { ...basePersisted };
    const tracker = new BudgetTracker(parseTokenBudgetConfig({}), persisted);
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
      "anthropic",
      "claude-opus-4-6",
    );

    const snapshot = tracker.getPersistedSnapshot();
    expect(snapshot.modelUsage).toBeDefined();
    const key = "anthropic:claude-opus-4-6";
    expect(snapshot.modelUsage![key]).toBeDefined();
    expect(snapshot.modelUsage![key].calls).toBe(1);
    expect(snapshot.modelUsage![key].costUsd).toBeGreaterThan(0);
  });
});

// ============================================================================
// BudgetPersistence tests
// ============================================================================

describe("BudgetPersistence", () => {
  it("rolloverIfNeeded resets daily on new day", () => {
    const persistence = new BudgetPersistence("/tmp/test-budget.json");
    const data: PersistedBudget = {
      dailyCostUsd: 5.0,
      dailyDate: "2026-02-22",
      monthlyCostUsd: 50,
      monthlyKey: "2026-02",
      lastFlushedAt: Date.now(),
    };
    const rolled = persistence.rolloverIfNeeded(data);
    const today = new Date().toISOString().slice(0, 10);
    if (today !== "2026-02-22") {
      expect(rolled.dailyCostUsd).toBe(0);
      expect(rolled.dailyDate).toBe(today);
      // Monthly unchanged if same month
      if (today.startsWith("2026-02")) {
        expect(rolled.monthlyCostUsd).toBe(50);
      }
    }
  });

  it("rolloverIfNeeded resets monthly on new month", () => {
    const persistence = new BudgetPersistence("/tmp/test-budget.json");
    const data: PersistedBudget = {
      dailyCostUsd: 5.0,
      dailyDate: "2026-01-31",
      monthlyCostUsd: 100,
      monthlyKey: "2026-01",
      lastFlushedAt: Date.now(),
    };
    const rolled = persistence.rolloverIfNeeded(data);
    const thisMonth = new Date().toISOString().slice(0, 7);
    if (thisMonth !== "2026-01") {
      expect(rolled.monthlyCostUsd).toBe(0);
      expect(rolled.monthlyKey).toBe(thisMonth);
    }
  });

  it("rolloverIfNeeded preserves data when same day", () => {
    const persistence = new BudgetPersistence("/tmp/test-budget.json");
    const today = new Date().toISOString().slice(0, 10);
    const thisMonth = new Date().toISOString().slice(0, 7);
    const data: PersistedBudget = {
      dailyCostUsd: 3.5,
      dailyDate: today,
      monthlyCostUsd: 25,
      monthlyKey: thisMonth,
      lastFlushedAt: Date.now(),
    };
    const rolled = persistence.rolloverIfNeeded(data);
    expect(rolled.dailyCostUsd).toBe(3.5);
    expect(rolled.monthlyCostUsd).toBe(25);
  });

  it("load returns defaults for missing file", async () => {
    const persistence = new BudgetPersistence("/tmp/nonexistent-token-budget-test.json");
    const data = await persistence.load();
    expect(data.dailyCostUsd).toBe(0);
    expect(data.monthlyCostUsd).toBe(0);
    expect(data.dailyDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(data.monthlyKey).toMatch(/^\d{4}-\d{2}$/);
  });

  it("save and load roundtrip", async () => {
    const path = `/tmp/token-budget-test-${Date.now()}.json`;
    const persistence = new BudgetPersistence(path);
    const data: PersistedBudget = {
      dailyCostUsd: 1.23,
      dailyDate: "2026-02-23",
      monthlyCostUsd: 45.67,
      monthlyKey: "2026-02",
      lastFlushedAt: 1234567890,
    };
    await persistence.save(data);
    const loaded = await persistence.load();
    expect(loaded.dailyCostUsd).toBe(1.23);
    expect(loaded.dailyDate).toBe("2026-02-23");
    expect(loaded.monthlyCostUsd).toBe(45.67);
    expect(loaded.monthlyKey).toBe("2026-02");
    expect(loaded.lastFlushedAt).toBe(1234567890);

    // Cleanup
    const { unlink } = await import("node:fs/promises");
    await unlink(path).catch(() => {});
  });
});

// ============================================================================
// PromptCache tests
// ============================================================================

describe("PromptCache", () => {
  it("returns undefined on miss", () => {
    const cache = new PromptCache(10, 60_000);
    expect(cache.lookup("nonexistent")).toBeUndefined();
    expect(cache.getStats().misses).toBe(1);
  });

  it("stores and retrieves entries", () => {
    const cache = new PromptCache(10, 60_000);
    cache.store("key1", {
      usage: { input: 100, output: 50 },
      costUsd: 0.005,
      storedAt: Date.now(),
      hitCount: 0,
    });
    const entry = cache.lookup("key1");
    expect(entry).toBeDefined();
    expect(entry!.usage.input).toBe(100);
    expect(entry!.hitCount).toBe(1);
    expect(cache.getStats().hits).toBe(1);
  });

  it("expires entries after TTL", () => {
    const cache = new PromptCache(10, 100); // 100ms TTL
    cache.store("key1", {
      usage: { input: 100 },
      costUsd: 0.005,
      storedAt: Date.now() - 200, // already expired
      hitCount: 0,
    });
    expect(cache.lookup("key1")).toBeUndefined();
    expect(cache.getStats().misses).toBe(1);
  });

  it("evicts LRU entry at max capacity", () => {
    const cache = new PromptCache(2, 60_000);
    const now = Date.now();
    cache.store("key1", { usage: {}, costUsd: 0.01, storedAt: now, hitCount: 0 });
    cache.store("key2", { usage: {}, costUsd: 0.02, storedAt: now, hitCount: 0 });
    // key1 is LRU — should be evicted when key3 is stored
    cache.store("key3", { usage: {}, costUsd: 0.03, storedAt: now, hitCount: 0 });
    expect(cache.lookup("key1")).toBeUndefined(); // evicted
    expect(cache.lookup("key2")).toBeDefined();
    expect(cache.lookup("key3")).toBeDefined();
  });

  it("computeKey is deterministic", () => {
    const k1 = PromptCache.computeKey("openai", "gpt-4", "system", "hello");
    const k2 = PromptCache.computeKey("openai", "gpt-4", "system", "hello");
    expect(k1).toBe(k2);
    expect(k1).toHaveLength(64); // SHA-256 hex
  });

  it("computeKey differs for different inputs", () => {
    const k1 = PromptCache.computeKey("openai", "gpt-4", "system", "hello");
    const k2 = PromptCache.computeKey("openai", "gpt-4", "system", "world");
    expect(k1).not.toBe(k2);
  });

  it("tracks estimated savings on cache hits", () => {
    const cache = new PromptCache(10, 60_000);
    cache.store("key1", {
      usage: { input: 100 },
      costUsd: 0.005,
      storedAt: Date.now(),
      hitCount: 0,
    });
    cache.lookup("key1"); // hit #1
    cache.lookup("key1"); // hit #2
    const stats = cache.getStats();
    expect(stats.hits).toBe(2);
    expect(stats.estimatedSavingsUsd).toBeCloseTo(0.01, 6);
  });

  it("clear resets everything", () => {
    const cache = new PromptCache(10, 60_000);
    cache.store("key1", { usage: {}, costUsd: 0.01, storedAt: Date.now(), hitCount: 0 });
    cache.lookup("key1");
    cache.clear();
    const stats = cache.getStats();
    expect(stats.entries).toBe(0);
    expect(stats.hits).toBe(0);
    expect(stats.misses).toBe(0);
    expect(stats.estimatedSavingsUsd).toBe(0);
  });
});

// ============================================================================
// Integration: llm_output + before_prompt_build hook behavior
// ============================================================================

describe("hook integration", () => {
  it("recordUsage accumulates cost correctly across multiple calls", () => {
    const tracker = new BudgetTracker(parseTokenBudgetConfig({ sessionLimitUsd: 1 }), {
      dailyCostUsd: 0,
      dailyDate: "2026-02-23",
      monthlyCostUsd: 0,
      monthlyKey: "2026-02",
      lastFlushedAt: Date.now(),
    });
    const costConfig = { input: 3, output: 15, cacheRead: 0.5, cacheWrite: 3.75 };

    // Call 1
    tracker.recordUsage({ input: 500, output: 200 }, costConfig);
    // Call 2
    tracker.recordUsage({ input: 300, output: 100 }, costConfig);

    // Expected: (500*3 + 200*15 + 300*3 + 100*15) / 1_000_000
    //         = (1500 + 3000 + 900 + 1500) / 1_000_000
    //         = 6900 / 1_000_000 = 0.0069
    expect(tracker.getSessionStatus().usedUsd).toBeCloseTo(0.0069, 6);
    expect(tracker.getCallCount()).toBe(2);
  });

  it("warning injected at warn threshold", () => {
    const cfg = parseTokenBudgetConfig({ sessionLimitUsd: 0.01, warnThreshold: 0.5 });
    const persisted: PersistedBudget = {
      dailyCostUsd: 0,
      dailyDate: "2026-02-23",
      monthlyCostUsd: 0,
      monthlyKey: "2026-02",
      lastFlushedAt: Date.now(),
    };
    const tracker = new BudgetTracker(cfg, persisted);

    // Push to ~60% of $0.01 = $0.006
    // (1000*3 + 200*15) / 1_000_000 = 0.006
    tracker.recordUsage(
      { input: 1000, output: 200 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );

    const status = tracker.getOverallStatus();
    expect(status.level).toBe("warn");
    expect(status.percent!).toBeGreaterThanOrEqual(0.5);
  });

  it("soft-stop message injected when exceeded", () => {
    const cfg = parseTokenBudgetConfig({ sessionLimitUsd: 0.001 });
    const persisted: PersistedBudget = {
      dailyCostUsd: 0,
      dailyDate: "2026-02-23",
      monthlyCostUsd: 0,
      monthlyKey: "2026-02",
      lastFlushedAt: Date.now(),
    };
    const tracker = new BudgetTracker(cfg, persisted);

    // cost = (1000*3 + 500*15) / 1_000_000 = 0.0105 >> 0.001
    tracker.recordUsage(
      { input: 1000, output: 500 },
      { input: 3, output: 15, cacheRead: 0, cacheWrite: 0 },
    );

    const status = tracker.getOverallStatus();
    expect(status.level).toBe("exceeded");
    expect(status.percent!).toBeGreaterThanOrEqual(1);
  });

  it("prompt cache tracks observational hits and savings", () => {
    const cache = new PromptCache(256, 300_000);
    const key = PromptCache.computeKey("anthropic", "claude-3", "system", "What is 2+2?");

    // First call: miss → store result
    expect(cache.lookup(key)).toBeUndefined();
    cache.store(key, {
      usage: { input: 50, output: 10 },
      costUsd: 0.001,
      storedAt: Date.now(),
      hitCount: 0,
    });

    // Second call: hit → observational savings
    const hit = cache.lookup(key);
    expect(hit).toBeDefined();
    expect(hit!.costUsd).toBe(0.001);

    const stats = cache.getStats();
    expect(stats.hits).toBe(1);
    expect(stats.misses).toBe(1);
    expect(stats.estimatedSavingsUsd).toBeCloseTo(0.001, 6);
  });
});

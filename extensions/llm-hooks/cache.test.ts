import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { HookCache } from "./cache.js";
import type { LlmHookEvaluation } from "./llm-evaluator.js";

// ============================================================================
// Helper
// ============================================================================

function makeEval(overrides: Partial<LlmHookEvaluation> = {}): LlmHookEvaluation {
  return {
    decision: "approve",
    reason: "Looks good",
    hookName: "test-hook",
    model: "anthropic/claude-sonnet-4-20250514",
    durationMs: 150,
    cached: false,
    ...overrides,
  };
}

// ============================================================================
// HookCache
// ============================================================================

describe("HookCache", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns undefined for cache miss (session)", () => {
    const cache = new HookCache();
    expect(cache.get("session", "nonexistent")).toBeUndefined();
  });

  it("returns undefined for cache miss (global)", () => {
    const cache = new HookCache();
    expect(cache.get("global", "nonexistent")).toBeUndefined();
  });

  it("returns undefined for 'none' scope", () => {
    const cache = new HookCache();
    cache.set("none", "key", makeEval());
    expect(cache.get("none", "key")).toBeUndefined();
  });

  it("stores and retrieves session cache entry", () => {
    const cache = new HookCache();
    const evaluation = makeEval({ decision: "deny", reason: "Blocked" });

    cache.set("session", "key-1", evaluation);
    const result = cache.get("session", "key-1");

    expect(result).toBeDefined();
    expect(result?.decision).toBe("deny");
    expect(result?.reason).toBe("Blocked");
  });

  it("stores and retrieves global cache entry", () => {
    const cache = new HookCache(60000);
    const evaluation = makeEval({ decision: "warn", reason: "Caution" });

    cache.set("global", "key-1", evaluation);
    const result = cache.get("global", "key-1");

    expect(result).toBeDefined();
    expect(result?.decision).toBe("warn");
    expect(result?.reason).toBe("Caution");
  });

  it("global cache entry expires after TTL", () => {
    const cache = new HookCache(1000); // 1s TTL
    const evaluation = makeEval();

    cache.set("global", "key-1", evaluation);

    // Still valid at 500ms
    vi.advanceTimersByTime(500);
    expect(cache.get("global", "key-1")).toBeDefined();

    // Expired at 1500ms
    vi.advanceTimersByTime(1000);
    expect(cache.get("global", "key-1")).toBeUndefined();
  });

  it("session cache entries do not expire", () => {
    const cache = new HookCache(1000);
    const evaluation = makeEval();

    cache.set("session", "key-1", evaluation);

    // Session entries have no TTL
    vi.advanceTimersByTime(100000);
    expect(cache.get("session", "key-1")).toBeDefined();
  });

  it("clearSession removes only session entries", () => {
    const cache = new HookCache();
    cache.set("session", "s-1", makeEval());
    cache.set("global", "g-1", makeEval());

    cache.clearSession();

    expect(cache.get("session", "s-1")).toBeUndefined();
    expect(cache.get("global", "g-1")).toBeDefined();
  });

  it("clearAll removes all entries", () => {
    const cache = new HookCache();
    cache.set("session", "s-1", makeEval());
    cache.set("global", "g-1", makeEval());

    cache.clearAll();

    expect(cache.get("session", "s-1")).toBeUndefined();
    expect(cache.get("global", "g-1")).toBeUndefined();
  });

  it("stats returns correct counts", () => {
    const cache = new HookCache();
    cache.set("session", "s-1", makeEval());
    cache.set("session", "s-2", makeEval());
    cache.set("global", "g-1", makeEval());

    const s = cache.stats();
    expect(s.sessionSize).toBe(2);
    expect(s.globalSize).toBe(1);
  });

  it("stats prunes expired global entries", () => {
    const cache = new HookCache(1000);
    cache.set("global", "g-1", makeEval());
    cache.set("global", "g-2", makeEval());

    vi.advanceTimersByTime(2000); // Both expired

    const s = cache.stats();
    expect(s.globalSize).toBe(0);
  });

  it("buildKey creates deterministic keys", () => {
    const cache = new HookCache();
    const key1 = cache.buildKey("hook-a", "body123", "ctx456");
    const key2 = cache.buildKey("hook-a", "body123", "ctx456");
    expect(key1).toBe(key2);
    expect(key1).toBe("hook-a:body123:ctx456");
  });

  it("buildKey produces different keys for different inputs", () => {
    const cache = new HookCache();
    const key1 = cache.buildKey("hook-a", "body1", "ctx1");
    const key2 = cache.buildKey("hook-b", "body1", "ctx1");
    expect(key1).not.toBe(key2);
  });

  it("hashBody returns consistent hashes", () => {
    const cache = new HookCache();
    const h1 = cache.hashBody("Analyze this command.");
    const h2 = cache.hashBody("Analyze this command.");
    expect(h1).toBe(h2);
  });

  it("hashBody returns different hashes for different content", () => {
    const cache = new HookCache();
    const h1 = cache.hashBody("Body A");
    const h2 = cache.hashBody("Body B");
    expect(h1).not.toBe(h2);
  });

  it("hashContext returns consistent hashes", () => {
    const cache = new HookCache();
    const h1 = cache.hashContext({ toolName: "exec" });
    const h2 = cache.hashContext({ toolName: "exec" });
    expect(h1).toBe(h2);
  });

  it("set with 'none' scope is a no-op", () => {
    const cache = new HookCache();
    cache.set("none", "key", makeEval());
    const s = cache.stats();
    expect(s.sessionSize).toBe(0);
    expect(s.globalSize).toBe(0);
  });
});

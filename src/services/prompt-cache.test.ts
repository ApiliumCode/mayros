import { describe, it, expect, beforeEach } from "vitest";
import { PromptCache } from "./prompt-cache.js";

describe("PromptCache", () => {
  let cache: PromptCache;

  beforeEach(() => {
    cache = new PromptCache();
  });

  // 1
  it("hash returns consistent 16-char hex string", () => {
    const h1 = cache.hash("hello world");
    const h2 = cache.hash("hello world");
    expect(h1).toBe(h2);
    expect(h1).toHaveLength(16);
    expect(/^[0-9a-f]+$/.test(h1)).toBe(true);
  });

  // 2
  it("hash returns different values for different inputs", () => {
    expect(cache.hash("hello")).not.toBe(cache.hash("world"));
  });

  // 3
  it("first lookup returns false (miss)", () => {
    const longPrefix = "a".repeat(200);
    expect(cache.lookup(longPrefix)).toBe(false);
  });

  // 4
  it("second lookup returns true (hit)", () => {
    const longPrefix = "a".repeat(200);
    cache.lookup(longPrefix); // miss
    expect(cache.lookup(longPrefix)).toBe(true); // hit
  });

  // 5
  it("getStats tracks hits and misses", () => {
    const p1 = "prefix-one-" + "x".repeat(200);
    const p2 = "prefix-two-" + "y".repeat(200);
    cache.lookup(p1); // miss
    cache.lookup(p1); // hit
    cache.lookup(p2); // miss
    cache.lookup(p1); // hit

    const stats = cache.getStats();
    expect(stats.entries).toBe(2);
    expect(stats.totalHits).toBe(2);
    expect(stats.totalMisses).toBe(2);
    expect(stats.hitRate).toBe(0.5);
  });

  // 6
  it("clear resets all state", () => {
    cache.lookup("x".repeat(200));
    cache.clear();
    const stats = cache.getStats();
    expect(stats.entries).toBe(0);
    expect(stats.totalHits).toBe(0);
    expect(stats.totalMisses).toBe(0);
  });

  // 7
  it("evicts oldest entry when at capacity", () => {
    const smallCache = new PromptCache(3);
    smallCache.lookup("aaa" + "x".repeat(200));
    smallCache.lookup("bbb" + "x".repeat(200));
    smallCache.lookup("ccc" + "x".repeat(200));
    // Cache is full (3 entries)
    smallCache.lookup("ddd" + "x".repeat(200));
    // Should have evicted one
    expect(smallCache.getStats().entries).toBe(3);
  });

  // 8
  it("identifyCacheable returns single cacheable for static prompt", () => {
    const prompt = "You are a helpful coding assistant. Follow these rules: " + "x".repeat(200);
    const segments = cache.identifyCacheable(prompt);
    expect(segments).toHaveLength(1);
    expect(segments[0]!.cacheable).toBe(true);
  });

  // 9
  it("identifyCacheable splits on dynamic content", () => {
    const prompt =
      "You are a coding assistant. " +
      "x".repeat(200) +
      " Current date: 2026-03-06T12:00:00Z. Do your best.";
    const segments = cache.identifyCacheable(prompt);
    expect(segments.length).toBeGreaterThanOrEqual(2);
    expect(segments[0]!.cacheable).toBe(true);
    expect(segments[segments.length - 1]!.cacheable).toBe(false);
  });

  // 10
  it("identifyCacheable returns non-cacheable for short prompts", () => {
    const segments = cache.identifyCacheable("Short prompt");
    expect(segments).toHaveLength(1);
    expect(segments[0]!.cacheable).toBe(false);
  });

  // 11
  it("savedTokensEstimate increases with hits", () => {
    const prefix = "a".repeat(400); // ~100 tokens
    cache.lookup(prefix); // miss
    cache.lookup(prefix); // hit
    cache.lookup(prefix); // hit
    const stats = cache.getStats();
    expect(stats.savedTokensEstimate).toBeGreaterThan(0);
  });

  // 12
  it("identifyCacheable detects {{variable}} patterns", () => {
    const prompt = "Static instructions " + "x".repeat(200) + " {{user_name}} dynamic part";
    const segments = cache.identifyCacheable(prompt);
    expect(segments.length).toBeGreaterThanOrEqual(2);
  });
});

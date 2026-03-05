/**
 * LLM Hook Cache
 *
 * Two-tier caching for LLM hook evaluation results: session-scoped
 * (cleared on session end) and global-scoped (TTL-based expiry).
 */

import type { LlmHookEvaluation } from "./llm-evaluator.js";

// ============================================================================
// Types
// ============================================================================

export type CacheScope = "none" | "session" | "global";

export type CacheEntry = {
  result: LlmHookEvaluation;
  expiresAt: number;
  key: string;
};

// ============================================================================
// Hashing
// ============================================================================

/**
 * Simple string hash (djb2 variant) — not cryptographic, just for cache keys.
 */
function simpleHash(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return (hash >>> 0).toString(36);
}

// ============================================================================
// Cache Implementation
// ============================================================================

export class HookCache {
  private sessionCache: Map<string, CacheEntry> = new Map();
  private globalCache: Map<string, CacheEntry> = new Map();

  constructor(private globalTtlMs: number = 300000) {}

  /**
   * Build a cache key from hook name, body hash, and context hash.
   */
  buildKey(hookName: string, bodyHash: string, contextHash: string): string {
    return `${hookName}:${bodyHash}:${contextHash}`;
  }

  /**
   * Compute a hash for the hook body text.
   */
  hashBody(body: string): string {
    return simpleHash(body);
  }

  /**
   * Compute a hash for the evaluation context.
   */
  hashContext(context: Record<string, unknown>): string {
    return simpleHash(JSON.stringify(context));
  }

  /**
   * Get a cached evaluation result.
   * Returns undefined on miss, expired, or "none" scope.
   */
  get(scope: CacheScope, key: string): LlmHookEvaluation | undefined {
    if (scope === "none") return undefined;

    const cache = scope === "session" ? this.sessionCache : this.globalCache;
    const entry = cache.get(key);
    if (!entry) return undefined;

    // Check expiry for global cache
    if (scope === "global" && Date.now() > entry.expiresAt) {
      cache.delete(key);
      return undefined;
    }

    return entry.result;
  }

  /**
   * Store an evaluation result in the cache.
   * No-op for "none" scope.
   */
  set(scope: CacheScope, key: string, result: LlmHookEvaluation): void {
    if (scope === "none") return;

    const entry: CacheEntry = {
      result,
      expiresAt: scope === "global" ? Date.now() + this.globalTtlMs : Infinity,
      key,
    };

    if (scope === "session") {
      this.sessionCache.set(key, entry);
    } else {
      this.globalCache.set(key, entry);
    }
  }

  /**
   * Clear all session-scoped cache entries.
   */
  clearSession(): void {
    this.sessionCache.clear();
  }

  /**
   * Clear all cache entries (both session and global).
   */
  clearAll(): void {
    this.sessionCache.clear();
    this.globalCache.clear();
  }

  /**
   * Return cache size statistics.
   */
  stats(): { sessionSize: number; globalSize: number } {
    // Prune expired global entries before reporting
    const now = Date.now();
    for (const [key, entry] of this.globalCache) {
      if (now > entry.expiresAt) {
        this.globalCache.delete(key);
      }
    }

    return {
      sessionSize: this.sessionCache.size,
      globalSize: this.globalCache.size,
    };
  }
}

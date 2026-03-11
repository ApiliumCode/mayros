/**
 * Response Cache (Oboeru)
 *
 * Observational LRU cache that tracks when identical LLM requests
 * produce identical responses. Does NOT skip LLM calls — the hook
 * system doesn't support that. Instead, tracks estimated savings
 * for reporting purposes.
 */

import { createHash } from "node:crypto";

export type ResponseCacheEntry = {
  costUsd: number;
  storedAt: number;
  hitCount: number;
};

export type ResponseCacheStats = {
  hits: number;
  misses: number;
  entries: number;
  savingsUsd: number;
};

export class ResponseCache {
  private entries = new Map<string, ResponseCacheEntry>();
  private hits = 0;
  private misses = 0;
  private savingsUsd = 0;

  constructor(
    private maxEntries: number = 128,
    private ttlMs: number = 600_000,
  ) {}

  /**
   * Compute an exact cache key from all request parameters.
   */
  static computeExactKey(
    provider: string,
    model: string,
    systemPrompt: string,
    prompt: string,
    historyDigest: string,
  ): string {
    const hash = createHash("sha256");
    hash.update(provider);
    hash.update("\0");
    hash.update(model);
    hash.update("\0");
    hash.update(systemPrompt);
    hash.update("\0");
    hash.update(prompt);
    hash.update("\0");
    hash.update(historyDigest);
    return `rc:${hash.digest("hex")}`;
  }

  /**
   * Look up a cached response entry. Returns undefined on miss.
   */
  lookup(key: string): ResponseCacheEntry | undefined {
    const entry = this.entries.get(key);
    if (!entry) {
      this.misses++;
      return undefined;
    }

    if (Date.now() - entry.storedAt > this.ttlMs) {
      this.entries.delete(key);
      this.misses++;
      return undefined;
    }

    this.hits++;
    entry.hitCount++;
    this.savingsUsd += entry.costUsd;

    // Move to end (most recently used)
    this.entries.delete(key);
    this.entries.set(key, entry);

    return entry;
  }

  /**
   * Store a response entry.
   */
  store(key: string, entry: ResponseCacheEntry): void {
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }

    // Evict LRU if at capacity
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }

    this.entries.set(key, entry);
  }

  /**
   * Get cache statistics.
   */
  getStats(): ResponseCacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      savingsUsd: this.savingsUsd,
    };
  }

  /**
   * Clear all entries and reset stats.
   */
  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.savingsUsd = 0;
  }
}

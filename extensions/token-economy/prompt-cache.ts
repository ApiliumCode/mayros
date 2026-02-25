import { createHash } from "node:crypto";
import type { NormalizedUsage } from "../../src/agents/usage.js";

export type CacheEntry = {
  usage: NormalizedUsage;
  costUsd: number;
  storedAt: number;
  hitCount: number;
};

export type CacheStats = {
  hits: number;
  misses: number;
  entries: number;
  estimatedSavingsUsd: number;
};

export class PromptCache {
  private entries = new Map<string, CacheEntry>();
  private hits = 0;
  private misses = 0;
  private estimatedSavingsUsd = 0;

  constructor(
    private maxEntries: number,
    private ttlMs: number,
  ) {}

  lookup(key: string): CacheEntry | undefined {
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
    this.estimatedSavingsUsd += entry.costUsd;
    // Move to end (most recently used)
    this.entries.delete(key);
    this.entries.set(key, entry);
    return entry;
  }

  store(key: string, entry: CacheEntry): void {
    // If key already exists, just update it
    if (this.entries.has(key)) {
      this.entries.delete(key);
    }
    // Evict LRU entry if at capacity
    if (this.entries.size >= this.maxEntries) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(key, entry);
  }

  static computeKey(provider: string, model: string, systemPrompt: string, prompt: string): string {
    const hash = createHash("sha256");
    hash.update(provider);
    hash.update("\0");
    hash.update(model);
    hash.update("\0");
    hash.update(systemPrompt);
    hash.update("\0");
    hash.update(prompt);
    return hash.digest("hex");
  }

  getStats(): CacheStats {
    return {
      hits: this.hits,
      misses: this.misses,
      entries: this.entries.size,
      estimatedSavingsUsd: this.estimatedSavingsUsd,
    };
  }

  clear(): void {
    this.entries.clear();
    this.hits = 0;
    this.misses = 0;
    this.estimatedSavingsUsd = 0;
  }
}

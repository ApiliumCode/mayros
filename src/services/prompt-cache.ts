/**
 * Prompt caching — identifies stable portions of the system prompt that
 * can be cached across turns to reduce token costs and latency.
 *
 * Cache key: hash of the prompt prefix content.
 * Cache hit: when the same prefix appears in consecutive turns.
 */

import { createHash } from "node:crypto";

export type CacheEntry = {
  hash: string;
  prefix: string;
  length: number;
  hitCount: number;
  createdAt: number;
  lastHitAt: number;
};

export type CacheStats = {
  entries: number;
  totalHits: number;
  totalMisses: number;
  hitRate: number;
  savedTokensEstimate: number;
};

export type CachableSegment = {
  text: string;
  cacheable: boolean;
};

const DEFAULT_MAX_ENTRIES = 50;
const MIN_PREFIX_LENGTH = 100; // Don't cache very short prefixes

export class PromptCache {
  private cache = new Map<string, CacheEntry>();
  private totalHits = 0;
  private totalMisses = 0;
  private maxEntries: number;

  constructor(maxEntries = DEFAULT_MAX_ENTRIES) {
    this.maxEntries = maxEntries;
  }

  /**
   * Compute a hash for a text segment.
   */
  hash(text: string): string {
    return createHash("sha256").update(text).digest("hex").slice(0, 16);
  }

  /**
   * Identify cacheable segments in a system prompt by finding the longest
   * stable prefix (content before any dynamic/per-turn variables).
   */
  identifyCacheable(systemPrompt: string): CachableSegment[] {
    if (systemPrompt.length < MIN_PREFIX_LENGTH) {
      return [{ text: systemPrompt, cacheable: false }];
    }

    // Find the boundary between static and dynamic content.
    // Dynamic markers: {{variable}}, ${variable}, timestamps, session IDs
    const dynamicPatterns = [
      /\{\{[^}]+\}\}/, // {{variable}}
      /\$\{[^}]+\}/, // ${variable}
      /\d{4}-\d{2}-\d{2}T/, // ISO timestamps
      /session[_-]?id:\s*\S+/i, // session IDs
      /Current date:/i, // date headers
    ];

    let splitIndex = systemPrompt.length;
    for (const pattern of dynamicPatterns) {
      const match = pattern.exec(systemPrompt);
      if (match && match.index < splitIndex) {
        splitIndex = match.index;
      }
    }

    // If no dynamic content found, cache the whole thing
    if (splitIndex === systemPrompt.length) {
      return [{ text: systemPrompt, cacheable: true }];
    }

    // If split point is too early, don't cache
    if (splitIndex < MIN_PREFIX_LENGTH) {
      return [{ text: systemPrompt, cacheable: false }];
    }

    const segments: CachableSegment[] = [
      { text: systemPrompt.slice(0, splitIndex), cacheable: true },
    ];
    const remainder = systemPrompt.slice(splitIndex);
    if (remainder.length > 0) {
      segments.push({ text: remainder, cacheable: false });
    }
    return segments;
  }

  /**
   * Record a cache lookup. Returns true if the prefix was already cached (hit).
   */
  lookup(prefix: string): boolean {
    const key = this.hash(prefix);
    const entry = this.cache.get(key);

    if (entry) {
      entry.hitCount++;
      entry.lastHitAt = Date.now();
      this.totalHits++;
      return true;
    }

    this.totalMisses++;

    // Evict if at capacity (LRU)
    if (this.cache.size >= this.maxEntries) {
      this.evictOldest();
    }

    this.cache.set(key, {
      hash: key,
      prefix: prefix.slice(0, 200), // Store truncated for debugging
      length: prefix.length,
      hitCount: 0,
      createdAt: Date.now(),
      lastHitAt: Date.now(),
    });

    return false;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats {
    const total = this.totalHits + this.totalMisses;
    // Rough estimate: ~4 chars per token, cached prefixes save their full token count
    const savedTokensEstimate = Array.from(this.cache.values()).reduce(
      (sum, e) => sum + Math.floor((e.length / 4) * e.hitCount),
      0,
    );

    return {
      entries: this.cache.size,
      totalHits: this.totalHits,
      totalMisses: this.totalMisses,
      hitRate: total > 0 ? this.totalHits / total : 0,
      savedTokensEstimate,
    };
  }

  /**
   * Clear all cached entries.
   */
  clear(): void {
    this.cache.clear();
    this.totalHits = 0;
    this.totalMisses = 0;
  }

  private evictOldest(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.cache) {
      if (entry.lastHitAt < oldestTime) {
        oldestTime = entry.lastHitAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.cache.delete(oldestKey);
    }
  }
}

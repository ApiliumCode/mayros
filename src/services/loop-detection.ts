/**
 * Loop Detection Service
 *
 * Detects when an agent conversation enters a loop by tracking
 * repeated tool calls or responses within a sliding window.
 */

// ============================================================================
// Types
// ============================================================================

export type LoopDetectionConfig = {
  maxRepeats: number;
  windowSize: number;
  similarityThreshold: number;
};

export type LoopDetectionEntry = {
  type: "tool-call" | "response";
  content: string;
  timestamp: number;
};

export type LoopDetectionResult = {
  detected: boolean;
  pattern?: string;
  repeatCount: number;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Normalize content for comparison: lowercase, collapse whitespace, trim.
 */
export function normalizeContent(s: string): string {
  return s.toLowerCase().replace(/\s+/g, " ").trim();
}

/**
 * Compute a simple similarity ratio between two strings.
 *
 * Returns 1.0 for exact normalized match, otherwise computes overlap ratio
 * based on shared character bigrams (Dice coefficient).
 */
export function similarity(a: string, b: string): number {
  const na = normalizeContent(a);
  const nb = normalizeContent(b);

  if (na === nb) return 1.0;
  if (na.length === 0 && nb.length === 0) return 1.0;
  if (na.length === 0 || nb.length === 0) return 0.0;

  // For very short strings where bigrams are not meaningful, fall back to
  // a simple character-level comparison.
  if (na.length < 2 || nb.length < 2) {
    // Single-character strings that differ are not similar.
    return na === nb ? 1.0 : 0.0;
  }

  // Use bigram-based Dice coefficient for a simple overlap ratio.
  const bigramsA = new Map<string, number>();
  for (let i = 0; i < na.length - 1; i++) {
    const bg = na.slice(i, i + 2);
    bigramsA.set(bg, (bigramsA.get(bg) ?? 0) + 1);
  }

  const bigramsB = new Map<string, number>();
  for (let i = 0; i < nb.length - 1; i++) {
    const bg = nb.slice(i, i + 2);
    bigramsB.set(bg, (bigramsB.get(bg) ?? 0) + 1);
  }

  let intersection = 0;
  for (const [bg, countA] of bigramsA) {
    const countB = bigramsB.get(bg) ?? 0;
    intersection += Math.min(countA, countB);
  }

  const totalBigrams = na.length - 1 + (nb.length - 1);
  if (totalBigrams === 0) return 1.0;

  return (2 * intersection) / totalBigrams;
}

// ============================================================================
// LoopDetector
// ============================================================================

export class LoopDetector {
  private entries: LoopDetectionEntry[] = [];
  private readonly config: LoopDetectionConfig;

  constructor(config?: Partial<LoopDetectionConfig>) {
    this.config = {
      maxRepeats: config?.maxRepeats ?? 3,
      windowSize: config?.windowSize ?? 10,
      similarityThreshold: config?.similarityThreshold ?? 0.8,
    };
  }

  /**
   * Add an entry to the detection window, trim to windowSize, then check.
   */
  addEntry(entry: LoopDetectionEntry): LoopDetectionResult {
    this.entries.push(entry);
    if (this.entries.length > this.config.windowSize) {
      this.entries = this.entries.slice(-this.config.windowSize);
    }
    return this.check();
  }

  /**
   * Check the current window for repeated patterns.
   *
   * Groups entries by normalized content (using similarity threshold),
   * and returns detected=true if any group meets maxRepeats.
   */
  check(): LoopDetectionResult {
    if (this.entries.length === 0) {
      return { detected: false, repeatCount: 0 };
    }

    // Build groups of similar entries.
    const groups: Array<{ representative: string; count: number }> = [];

    for (const entry of this.entries) {
      const normalized = normalizeContent(entry.content);
      let matched = false;

      for (const group of groups) {
        if (similarity(normalized, group.representative) >= this.config.similarityThreshold) {
          group.count++;
          matched = true;
          break;
        }
      }

      if (!matched) {
        groups.push({ representative: normalized, count: 1 });
      }
    }

    // Find the group with the highest count.
    let maxGroup = groups[0];
    for (const group of groups) {
      if (group.count > maxGroup.count) {
        maxGroup = group;
      }
    }

    if (maxGroup.count >= this.config.maxRepeats) {
      return {
        detected: true,
        pattern: maxGroup.representative,
        repeatCount: maxGroup.count,
      };
    }

    return { detected: false, repeatCount: maxGroup.count };
  }

  /**
   * Clear all tracked entries.
   */
  reset(): void {
    this.entries = [];
  }
}

/**
 * Compaction trigger evaluation logic.
 *
 * Extracted from the before_prompt_build hook to enable unit testing
 * of the compaction decision independently of the full plugin lifecycle.
 */

export type CompactionInput = {
  usedTokens: number;
  contextWindow: number;
  threshold?: number; // default 0.95
};

export type CompactionDecision = {
  shouldCompact: boolean;
  usageRatio: number;
  usagePercent: number;
};

export function evaluateCompaction(input: CompactionInput): CompactionDecision {
  const threshold = input.threshold ?? 0.95;
  if (input.contextWindow <= 0) {
    return { shouldCompact: false, usageRatio: 0, usagePercent: 0 };
  }
  const usageRatio = input.usedTokens / input.contextWindow;
  const usagePercent = Math.round(usageRatio * 100);
  return {
    shouldCompact: usageRatio > threshold,
    usageRatio,
    usagePercent,
  };
}

import type { GroundResponse, GroundedPassage, GroundingSummary } from "./types.js";

/** Renders the canonical inline citation for a vault passage: `[source:lines]`. */
export function formatCitation(passage: Pick<GroundedPassage, "source" | "lines">): string {
  return passage.lines ? `[${passage.source}:${passage.lines}]` : `[${passage.source}]`;
}

/**
 * Distills an `aingle_ground` response into what the agent needs to compose
 * an honest answer: whether it may answer from the vault at all, the verdict
 * it must surface, and the deduplicated citation list.
 */
export function summarizeGrounding(response: GroundResponse): GroundingSummary {
  const citations = [...new Set(response.answer_context.map(formatCitation))];
  return {
    canAnswer: response.answerable && response.groundedness !== "ungrounded",
    groundedness: response.groundedness,
    citations,
    staleWarning: response.index_stale === true,
  };
}

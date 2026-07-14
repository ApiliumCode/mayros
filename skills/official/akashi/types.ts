/** Verdict Akashi attaches to every grounded retrieval. */
export type Groundedness = "grounded" | "weak" | "ungrounded";

/** One cited passage returned by `aingle_ground`. */
export interface GroundedPassage {
  source: string;
  lines: string;
  text: string;
  /** Ed25519-anchored content hash proving the passage's origin. */
  provenance_anchor: string;
  relevance?: number;
  ingested_at?: string;
}

/** Shape of an `aingle_ground` response. */
export interface GroundResponse {
  answer_context: GroundedPassage[];
  answerable: boolean;
  groundedness: Groundedness;
  gaps?: string[];
  index_stale?: boolean;
  /** Behavioral instruction the agent must follow verbatim. */
  instruction?: string;
}

/** Distilled view of a ground response for answer composition. */
export interface GroundingSummary {
  canAnswer: boolean;
  groundedness: Groundedness;
  citations: string[];
  staleWarning: boolean;
}

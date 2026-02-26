export interface ModelScore {
  model: string;
  score: number;
  matchedKeywords: string[];
}

export interface Recommendation {
  recommended: ModelScore;
  alternatives: ModelScore[];
  rationale: string;
}

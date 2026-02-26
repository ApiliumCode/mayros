export interface AntiPattern {
  name: string;
  weight: number;
  evidence: string[];
}

export type HealthRating = "healthy" | "needs attention" | "degraded" | "critical";

export interface WorkflowHealth {
  score: number;
  rating: HealthRating;
  patterns: AntiPattern[];
}

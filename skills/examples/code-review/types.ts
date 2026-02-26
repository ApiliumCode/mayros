export type Severity = "info" | "warning" | "critical";

export interface ReviewFinding {
  subject: string;
  severity: Severity;
  original: unknown;
}

export interface ReviewResult {
  findings: ReviewFinding[];
  totalClassified: number;
}

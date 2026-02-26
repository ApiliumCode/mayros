export type Severity = "critical" | "high" | "medium" | "low";

export interface Finding {
  rule: string;
  cwe: string;
  owasp: string;
  severity: Severity;
  evidence: string;
}

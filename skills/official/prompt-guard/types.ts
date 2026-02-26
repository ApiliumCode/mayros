export type RiskLevel = "dangerous" | "suspicious" | "safe";

export interface InjectionFinding {
  rule: string;
  tier: "dangerous" | "suspicious";
  evidence: string;
}

export interface ScanResult {
  risk: RiskLevel;
  findings: InjectionFinding[];
}

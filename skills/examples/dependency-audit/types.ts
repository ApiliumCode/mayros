export type DependencyFlag = "outdated" | "vulnerable";

export interface FlaggedDependency {
  subject: string;
  value: unknown;
  flag?: DependencyFlag;
}

export interface AuditResult {
  flagged: FlaggedDependency[];
  totalFlagged: number;
}

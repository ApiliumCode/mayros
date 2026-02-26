export type Priority = "P0" | "P1" | "P2" | "P3";

export interface IncidentFinding {
  type: string;
  priority: Priority;
  remediation: string;
  evidence: string;
}

/**
 * CI/CD Provider Types.
 *
 * Shared types for all CI provider implementations (GitHub, GitLab).
 */

// ============================================================================
// Pipeline run
// ============================================================================

export type CiPipelineStatus = "queued" | "running" | "success" | "failure" | "cancelled";

export type CiPipelineRun = {
  id: string;
  provider: "github" | "gitlab";
  repo: string;
  branch: string;
  status: CiPipelineStatus;
  url: string;
  startedAt?: string;
  completedAt?: string;
  conclusion?: string;
};

// ============================================================================
// Provider interface
// ============================================================================

export type CiListRunsOptions = {
  branch?: string;
  limit?: number;
};

export type CiTriggerOptions = {
  branch: string;
  workflow?: string;
};

export type CiProvider = {
  readonly type: "github" | "gitlab";
  listRuns(repo: string, opts?: CiListRunsOptions): Promise<CiPipelineRun[]>;
  getRun(repo: string, runId: string): Promise<CiPipelineRun | null>;
  triggerRun(repo: string, opts: CiTriggerOptions): Promise<CiPipelineRun>;
  cancelRun(repo: string, runId: string): Promise<boolean>;
  getRunLogs(repo: string, runId: string): Promise<string>;
};

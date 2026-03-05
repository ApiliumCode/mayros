/**
 * GitLab CI/CD Provider.
 *
 * Uses the GitLab REST API to list, inspect, trigger, cancel pipelines,
 * and retrieve job logs.
 */

import type {
  CiPipelineRun,
  CiPipelineStatus,
  CiProvider,
  CiListRunsOptions,
  CiTriggerOptions,
} from "./types.js";

// ============================================================================
// GitLab API types (subset)
// ============================================================================

type GitLabPipeline = {
  id: number;
  iid?: number;
  ref: string;
  status: string;
  web_url: string;
  created_at: string;
  updated_at: string;
  started_at?: string | null;
  finished_at?: string | null;
};

type GitLabJob = {
  id: number;
  name: string;
  status: string;
};

// ============================================================================
// Status mapping
// ============================================================================

function mapGitLabStatus(status: string): CiPipelineStatus {
  switch (status) {
    case "created":
    case "waiting_for_resource":
    case "preparing":
    case "pending":
      return "queued";
    case "running":
      return "running";
    case "success":
      return "success";
    case "failed":
      return "failure";
    case "canceled":
    case "cancelled":
    case "skipped":
      return "cancelled";
    default:
      return "queued";
  }
}

// ============================================================================
// Provider
// ============================================================================

export class GitLabProvider implements CiProvider {
  readonly type = "gitlab" as const;

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly defaultOrg?: string;

  constructor(token: string, baseUrl?: string, defaultOrg?: string) {
    this.baseUrl = baseUrl ?? "https://gitlab.com/api/v4";
    this.headers = {
      "PRIVATE-TOKEN": token,
      "Content-Type": "application/json",
    };
    this.defaultOrg = defaultOrg;
  }

  private encodeProject(repo: string): string {
    const resolved = repo.includes("/")
      ? repo
      : this.defaultOrg
        ? `${this.defaultOrg}/${repo}`
        : repo;
    return encodeURIComponent(resolved);
  }

  private resolveRepo(repo: string): string {
    if (repo.includes("/")) return repo;
    if (this.defaultOrg) return `${this.defaultOrg}/${repo}`;
    return repo;
  }

  private toRun(pipeline: GitLabPipeline, repo: string): CiPipelineRun {
    return {
      id: String(pipeline.id),
      provider: "gitlab",
      repo,
      branch: pipeline.ref,
      status: mapGitLabStatus(pipeline.status),
      url: pipeline.web_url,
      startedAt: pipeline.started_at ?? pipeline.created_at,
      completedAt: pipeline.finished_at ?? undefined,
      conclusion: pipeline.status,
    };
  }

  async listRuns(repo: string, opts?: CiListRunsOptions): Promise<CiPipelineRun[]> {
    const projectId = this.encodeProject(repo);
    const resolved = this.resolveRepo(repo);
    const params = new URLSearchParams();
    if (opts?.branch) params.set("ref", opts.branch);
    params.set("per_page", String(opts?.limit ?? 20));

    const qs = params.toString();
    const url = `${this.baseUrl}/projects/${projectId}/pipelines${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GitLabPipeline[];
    return data.map((p) => this.toRun(p, resolved));
  }

  async getRun(repo: string, runId: string): Promise<CiPipelineRun | null> {
    const projectId = this.encodeProject(repo);
    const resolved = this.resolveRepo(repo);
    const url = `${this.baseUrl}/projects/${projectId}/pipelines/${runId}`;

    const res = await fetch(url, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
    }

    const pipeline = (await res.json()) as GitLabPipeline;
    return this.toRun(pipeline, resolved);
  }

  async triggerRun(repo: string, opts: CiTriggerOptions): Promise<CiPipelineRun> {
    const projectId = this.encodeProject(repo);
    const resolved = this.resolveRepo(repo);
    const url = `${this.baseUrl}/projects/${projectId}/pipeline`;

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ ref: opts.branch }),
    });

    if (!res.ok) {
      throw new Error(`GitLab API error: ${res.status} ${res.statusText}`);
    }

    const pipeline = (await res.json()) as GitLabPipeline;
    return this.toRun(pipeline, resolved);
  }

  async cancelRun(repo: string, runId: string): Promise<boolean> {
    const projectId = this.encodeProject(repo);
    const url = `${this.baseUrl}/projects/${projectId}/pipelines/${runId}/cancel`;

    const res = await fetch(url, { method: "POST", headers: this.headers });
    return res.ok;
  }

  async getRunLogs(repo: string, runId: string): Promise<string> {
    const projectId = this.encodeProject(repo);

    // First get jobs for the pipeline
    const jobsUrl = `${this.baseUrl}/projects/${projectId}/pipelines/${runId}/jobs`;
    const jobsRes = await fetch(jobsUrl, { headers: this.headers });
    if (!jobsRes.ok) {
      throw new Error(`GitLab API error: ${jobsRes.status} ${jobsRes.statusText}`);
    }

    const jobs = (await jobsRes.json()) as GitLabJob[];
    const logParts: string[] = [];

    for (const job of jobs) {
      const traceUrl = `${this.baseUrl}/projects/${projectId}/jobs/${job.id}/trace`;
      const traceRes = await fetch(traceUrl, { headers: this.headers });
      if (traceRes.ok) {
        const text = await traceRes.text();
        logParts.push(`=== Job: ${job.name} (${job.status}) ===\n${text}`);
      }
    }

    return logParts.join("\n\n");
  }
}

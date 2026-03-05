/**
 * GitHub Actions CI/CD Provider.
 *
 * Uses the GitHub REST API to list, inspect, trigger, cancel runs,
 * and retrieve run logs.
 */

import type {
  CiPipelineRun,
  CiPipelineStatus,
  CiProvider,
  CiListRunsOptions,
  CiTriggerOptions,
} from "./types.js";

// ============================================================================
// GitHub API types (subset)
// ============================================================================

type GitHubWorkflowRun = {
  id: number;
  name?: string;
  head_branch: string;
  status: string;
  conclusion: string | null;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
};

type GitHubWorkflowRunsResponse = {
  total_count: number;
  workflow_runs: GitHubWorkflowRun[];
};

// ============================================================================
// Status mapping
// ============================================================================

function mapGitHubStatus(status: string, conclusion: string | null): CiPipelineStatus {
  if (status === "queued" || status === "waiting" || status === "pending") return "queued";
  if (status === "in_progress") return "running";
  if (status === "completed") {
    if (conclusion === "success") return "success";
    if (conclusion === "cancelled") return "cancelled";
    return "failure";
  }
  return "queued";
}

// ============================================================================
// Provider
// ============================================================================

export class GitHubProvider implements CiProvider {
  readonly type = "github" as const;

  private readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  private readonly defaultOrg?: string;

  constructor(token: string, baseUrl?: string, defaultOrg?: string) {
    this.baseUrl = baseUrl ?? "https://api.github.com";
    this.headers = {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    };
    this.defaultOrg = defaultOrg;
  }

  private resolveRepo(repo: string): string {
    if (repo.includes("/")) return repo;
    if (this.defaultOrg) return `${this.defaultOrg}/${repo}`;
    return repo;
  }

  private toRun(run: GitHubWorkflowRun, repo: string): CiPipelineRun {
    return {
      id: String(run.id),
      provider: "github",
      repo,
      branch: run.head_branch,
      status: mapGitHubStatus(run.status, run.conclusion),
      url: run.html_url,
      startedAt: run.run_started_at ?? run.created_at,
      completedAt: run.status === "completed" ? run.updated_at : undefined,
      conclusion: run.conclusion ?? undefined,
    };
  }

  async listRuns(repo: string, opts?: CiListRunsOptions): Promise<CiPipelineRun[]> {
    const resolved = this.resolveRepo(repo);
    const params = new URLSearchParams();
    if (opts?.branch) params.set("branch", opts.branch);
    params.set("per_page", String(opts?.limit ?? 20));

    const qs = params.toString();
    const url = `${this.baseUrl}/repos/${resolved}/actions/runs${qs ? `?${qs}` : ""}`;

    const res = await fetch(url, { headers: this.headers });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const data = (await res.json()) as GitHubWorkflowRunsResponse;
    return data.workflow_runs.map((run) => this.toRun(run, resolved));
  }

  async getRun(repo: string, runId: string): Promise<CiPipelineRun | null> {
    const resolved = this.resolveRepo(repo);
    const url = `${this.baseUrl}/repos/${resolved}/actions/runs/${runId}`;

    const res = await fetch(url, { headers: this.headers });
    if (res.status === 404) return null;
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    const run = (await res.json()) as GitHubWorkflowRun;
    return this.toRun(run, resolved);
  }

  async triggerRun(repo: string, opts: CiTriggerOptions): Promise<CiPipelineRun> {
    const resolved = this.resolveRepo(repo);
    const workflow = opts.workflow ?? "ci.yml";
    const url = `${this.baseUrl}/repos/${resolved}/actions/workflows/${encodeURIComponent(workflow)}/dispatches`;

    const res = await fetch(url, {
      method: "POST",
      headers: this.headers,
      body: JSON.stringify({ ref: opts.branch }),
    });

    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    // workflow_dispatch returns 204 — return a placeholder run
    return {
      id: "pending",
      provider: "github",
      repo: resolved,
      branch: opts.branch,
      status: "queued",
      url: `https://github.com/${resolved}/actions`,
      startedAt: new Date().toISOString(),
    };
  }

  async cancelRun(repo: string, runId: string): Promise<boolean> {
    const resolved = this.resolveRepo(repo);
    const url = `${this.baseUrl}/repos/${resolved}/actions/runs/${runId}/cancel`;

    const res = await fetch(url, { method: "POST", headers: this.headers });
    return res.ok || res.status === 202;
  }

  async getRunLogs(repo: string, runId: string): Promise<string> {
    const resolved = this.resolveRepo(repo);
    const url = `${this.baseUrl}/repos/${resolved}/actions/runs/${runId}/logs`;

    const res = await fetch(url, { headers: this.headers, redirect: "follow" });
    if (!res.ok) {
      throw new Error(`GitHub API error: ${res.status} ${res.statusText}`);
    }

    return await res.text();
  }
}

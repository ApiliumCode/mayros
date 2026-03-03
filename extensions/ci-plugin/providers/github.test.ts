import { describe, it, expect, vi, beforeEach } from "vitest";
import { GitHubProvider } from "./github.js";

// ============================================================================
// Mock fetch
// ============================================================================

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

// ============================================================================
// Helpers
// ============================================================================

function makeRun(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 12345,
    name: "CI",
    head_branch: "main",
    status: "completed",
    conclusion: "success",
    html_url: "https://github.com/owner/repo/actions/runs/12345",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:05:00Z",
    run_started_at: "2026-01-01T00:00:01Z",
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("GitHubProvider", () => {
  let provider: GitHubProvider;

  beforeEach(() => {
    mockFetch.mockReset();
    provider = new GitHubProvider("test-token", "https://api.github.com", "myorg");
  });

  it("sets auth header correctly", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 0, workflow_runs: [] }));

    await provider.listRuns("owner/repo");

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/repos/owner/repo/actions/runs"),
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: "Bearer test-token" }),
      }),
    );
  });

  it("listRuns parses GitHub API response", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse({
        total_count: 1,
        workflow_runs: [makeRun()],
      }),
    );

    const runs = await provider.listRuns("owner/repo");

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("12345");
    expect(runs[0].provider).toBe("github");
    expect(runs[0].status).toBe("success");
    expect(runs[0].branch).toBe("main");
    expect(runs[0].url).toContain("github.com");
  });

  it("listRuns respects branch filter", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 0, workflow_runs: [] }));

    await provider.listRuns("owner/repo", { branch: "develop" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("branch=develop");
  });

  it("listRuns respects limit", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 0, workflow_runs: [] }));

    await provider.listRuns("owner/repo", { limit: 5 });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("per_page=5");
  });

  it("getRun maps status/conclusion correctly", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(makeRun({ status: "completed", conclusion: "failure" })),
    );

    const run = await provider.getRun("owner/repo", "12345");

    expect(run).not.toBeNull();
    expect(run!.status).toBe("failure");
    expect(run!.conclusion).toBe("failure");
  });

  it("getRun returns null on 404", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 404));

    const run = await provider.getRun("owner/repo", "99999");

    expect(run).toBeNull();
  });

  it("maps queued status", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeRun({ status: "queued", conclusion: null })));

    const run = await provider.getRun("owner/repo", "12345");
    expect(run!.status).toBe("queued");
  });

  it("maps in_progress status", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeRun({ status: "in_progress", conclusion: null })));

    const run = await provider.getRun("owner/repo", "12345");
    expect(run!.status).toBe("running");
  });

  it("maps cancelled conclusion", async () => {
    mockFetch.mockResolvedValue(
      jsonResponse(makeRun({ status: "completed", conclusion: "cancelled" })),
    );

    const run = await provider.getRun("owner/repo", "12345");
    expect(run!.status).toBe("cancelled");
  });

  it("triggerRun sends correct payload", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response);

    const run = await provider.triggerRun("owner/repo", {
      branch: "main",
      workflow: "deploy.yml",
    });

    expect(run.status).toBe("queued");
    expect(run.branch).toBe("main");
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toContain("/workflows/deploy.yml/dispatches");
    expect(JSON.parse(init.body)).toEqual({ ref: "main" });
  });

  it("triggerRun defaults to ci.yml workflow", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 204 } as Response);

    await provider.triggerRun("owner/repo", { branch: "main" });

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/workflows/ci.yml/dispatches");
  });

  it("cancelRun returns true on success", async () => {
    mockFetch.mockResolvedValue({ ok: true, status: 202 } as Response);

    const result = await provider.cancelRun("owner/repo", "12345");
    expect(result).toBe(true);
  });

  it("cancelRun returns false on failure", async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 409 } as Response);

    const result = await provider.cancelRun("owner/repo", "12345");
    expect(result).toBe(false);
  });

  it("getRunLogs returns text", async () => {
    mockFetch.mockResolvedValue(jsonResponse("log output line 1\nlog output line 2"));

    const logs = await provider.getRunLogs("owner/repo", "12345");
    expect(logs).toContain("log output");
  });

  it("uses defaultOrg when repo has no slash", async () => {
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 0, workflow_runs: [] }));

    await provider.listRuns("myrepo");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("/repos/myorg/myrepo/actions/runs");
  });

  it("uses custom baseUrl for GitHub Enterprise", async () => {
    const enterprise = new GitHubProvider("token", "https://ghe.corp.com/api/v3");
    mockFetch.mockResolvedValue(jsonResponse({ total_count: 0, workflow_runs: [] }));

    await enterprise.listRuns("org/repo");

    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).startsWith("https://ghe.corp.com/api/v3");
  });

  it("listRuns throws on API error", async () => {
    mockFetch.mockResolvedValue(jsonResponse({}, 500));

    await expect(provider.listRuns("owner/repo")).rejects.toThrow("GitHub API error");
  });

  it("getRun returns completedAt for completed runs", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeRun()));

    const run = await provider.getRun("owner/repo", "12345");
    expect(run!.completedAt).toBe("2026-01-01T00:05:00Z");
  });

  it("getRun returns no completedAt for in-progress runs", async () => {
    mockFetch.mockResolvedValue(jsonResponse(makeRun({ status: "in_progress", conclusion: null })));

    const run = await provider.getRun("owner/repo", "12345");
    expect(run!.completedAt).toBeUndefined();
  });
});

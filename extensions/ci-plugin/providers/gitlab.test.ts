import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GitLabProvider } from "./gitlab.js";

// ============================================================================
// Helpers
// ============================================================================

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? "OK" : "Error",
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(typeof body === "string" ? body : JSON.stringify(body)),
  } as unknown as Response;
}

function makePipeline(overrides?: Partial<Record<string, unknown>>) {
  return {
    id: 54321,
    iid: 1,
    ref: "main",
    status: "success",
    web_url: "https://gitlab.com/group/repo/-/pipelines/54321",
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:10:00Z",
    started_at: "2026-01-01T00:00:05Z",
    finished_at: "2026-01-01T00:10:00Z",
    ...overrides,
  };
}

function mf(): ReturnType<typeof vi.fn> {
  return fetch as ReturnType<typeof vi.fn>;
}

// ============================================================================
// Tests
// ============================================================================

describe("GitLabProvider", () => {
  let provider: GitLabProvider;

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
    provider = new GitLabProvider("test-token", "https://gitlab.com/api/v4", "mygroup");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("sets auth header correctly", async () => {
    mf().mockResolvedValue(jsonResponse([]));

    await provider.listRuns("group/repo");

    expect(mf()).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        headers: expect.objectContaining({ "PRIVATE-TOKEN": "test-token" }),
      }),
    );
  });

  it("listRuns parses GitLab pipeline response", async () => {
    mf().mockResolvedValue(jsonResponse([makePipeline()]));

    const runs = await provider.listRuns("group/repo");

    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("54321");
    expect(runs[0].provider).toBe("gitlab");
    expect(runs[0].status).toBe("success");
    expect(runs[0].branch).toBe("main");
  });

  it("listRuns respects branch filter as ref", async () => {
    mf().mockResolvedValue(jsonResponse([]));

    await provider.listRuns("group/repo", { branch: "develop" });

    const calledUrl = mf().mock.calls[0][0] as string;
    expect(calledUrl).toContain("ref=develop");
  });

  it("maps created status to queued", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "created" })));

    const run = await provider.getRun("group/repo", "54321");
    expect(run!.status).toBe("queued");
  });

  it("maps pending status to queued", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "pending" })));

    const run = await provider.getRun("group/repo", "54321");
    expect(run!.status).toBe("queued");
  });

  it("maps running status to running", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "running" })));

    const run = await provider.getRun("group/repo", "54321");
    expect(run!.status).toBe("running");
  });

  it("maps failed status to failure", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "failed" })));

    const run = await provider.getRun("group/repo", "54321");
    expect(run!.status).toBe("failure");
  });

  it("maps canceled status to cancelled", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "canceled" })));

    const run = await provider.getRun("group/repo", "54321");
    expect(run!.status).toBe("cancelled");
  });

  it("maps skipped status to cancelled", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "skipped" })));

    const run = await provider.getRun("group/repo", "54321");
    expect(run!.status).toBe("cancelled");
  });

  it("getRun returns null on 404", async () => {
    mf().mockResolvedValue(jsonResponse({}, 404));

    const run = await provider.getRun("group/repo", "99999");
    expect(run).toBeNull();
  });

  it("triggerRun sends correct ref param", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "created" })));

    const run = await provider.triggerRun("group/repo", { branch: "develop" });

    expect(run.status).toBe("queued");
    const [, init] = mf().mock.calls[0];
    expect(JSON.parse(init.body)).toEqual({ ref: "develop" });
  });

  it("cancelRun returns true on success", async () => {
    mf().mockResolvedValue(jsonResponse(makePipeline({ status: "canceled" })));

    const result = await provider.cancelRun("group/repo", "54321");
    expect(result).toBe(true);
  });

  it("cancelRun returns false on failure", async () => {
    mf().mockResolvedValue(jsonResponse({}, 403));

    const result = await provider.cancelRun("group/repo", "54321");
    expect(result).toBe(false);
  });

  it("uses custom baseUrl for self-hosted", async () => {
    const selfHosted = new GitLabProvider("token", "https://git.corp.com/api/v4");
    mf().mockResolvedValue(jsonResponse([]));

    await selfHosted.listRuns("group/repo");

    const calledUrl = mf().mock.calls[0][0] as string;
    expect(calledUrl).toContain("https://git.corp.com/api/v4");
  });

  it("encodes project ID correctly", async () => {
    mf().mockResolvedValue(jsonResponse([]));

    await provider.listRuns("group/sub/repo");

    const calledUrl = mf().mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent("group/sub/repo"));
  });

  it("uses defaultOrg when repo has no slash", async () => {
    mf().mockResolvedValue(jsonResponse([]));

    await provider.listRuns("myrepo");

    const calledUrl = mf().mock.calls[0][0] as string;
    expect(calledUrl).toContain(encodeURIComponent("mygroup/myrepo"));
  });

  it("getRunLogs concatenates job logs", async () => {
    mf()
      .mockResolvedValueOnce(
        jsonResponse([
          { id: 1, name: "build", status: "success" },
          { id: 2, name: "test", status: "success" },
        ]),
      )
      .mockResolvedValueOnce(jsonResponse("build log output"))
      .mockResolvedValueOnce(jsonResponse("test log output"));

    const logs = await provider.getRunLogs("group/repo", "54321");
    expect(logs).toContain("build log output");
    expect(logs).toContain("test log output");
    expect(logs).toContain("Job: build");
    expect(logs).toContain("Job: test");
  });

  it("listRuns throws on API error", async () => {
    mf().mockResolvedValue(jsonResponse({}, 500));

    await expect(provider.listRuns("group/repo")).rejects.toThrow("GitLab API error");
  });
});

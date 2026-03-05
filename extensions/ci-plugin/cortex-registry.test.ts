import { describe, it, expect, vi, beforeEach } from "vitest";
import { CiCortexRegistry } from "./cortex-registry.js";
import type { CiPipelineRun } from "./providers/types.js";
import type { CortexClientLike } from "../shared/cortex-client.js";

// ============================================================================
// Mock CortexClient
// ============================================================================

function createMockClient(): CortexClientLike & {
  _triples: Map<string, Array<{ id: string; subject: string; predicate: string; object: string }>>;
} {
  let nextId = 1;
  const triples = new Map<
    string,
    Array<{ id: string; subject: string; predicate: string; object: string }>
  >();

  return {
    _triples: triples,

    async createTriple(req) {
      const id = String(nextId++);
      const key = `${req.subject}::${req.predicate}`;
      const existing = triples.get(key) ?? [];
      existing.push({
        id,
        subject: req.subject,
        predicate: req.predicate,
        object: String(req.object),
      });
      triples.set(key, existing);
      return { id, ...req, object: String(req.object) };
    },

    async listTriples(query) {
      const results: Array<{ id: string; subject: string; predicate: string; object: string }> = [];
      for (const [, arr] of triples) {
        for (const t of arr) {
          if (query.subject && t.subject !== query.subject) continue;
          if (query.predicate && t.predicate !== query.predicate) continue;
          results.push(t);
        }
      }
      const limit = query.limit ?? 100;
      return { triples: results.slice(0, limit), total: results.length };
    },

    async patternQuery(req) {
      const results: Array<{ id: string; subject: string; predicate: string; object: string }> = [];
      for (const [, arr] of triples) {
        for (const t of arr) {
          if (req.subject && t.subject !== req.subject) continue;
          if (req.predicate && t.predicate !== req.predicate) continue;
          if (req.object !== undefined && String(t.object) !== String(req.object)) continue;
          results.push(t);
        }
      }
      const limit = req.limit ?? 100;
      return { matches: results.slice(0, limit), total: results.length };
    },

    async deleteTriple(id) {
      for (const [key, arr] of triples) {
        const idx = arr.findIndex((t) => t.id === id);
        if (idx >= 0) {
          arr.splice(idx, 1);
          if (arr.length === 0) triples.delete(key);
          return;
        }
      }
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("CiCortexRegistry", () => {
  let client: ReturnType<typeof createMockClient>;
  let registry: CiCortexRegistry;

  beforeEach(() => {
    client = createMockClient();
    registry = new CiCortexRegistry(client, "test");
  });

  const sampleRun: CiPipelineRun = {
    id: "12345",
    provider: "github",
    repo: "owner/repo",
    branch: "main",
    status: "success",
    url: "https://github.com/owner/repo/actions/runs/12345",
    startedAt: "2026-01-01T00:00:00Z",
    completedAt: "2026-01-01T00:05:00Z",
  };

  it("recordRun creates correct triples", async () => {
    await registry.recordRun(sampleRun);

    const statusTriples = await client.listTriples({
      subject: "test:ci:run:github:12345",
      predicate: "test:ci:status",
    });
    expect(statusTriples.triples).toHaveLength(1);
    expect(statusTriples.triples[0].object).toBe("success");

    const repoTriples = await client.listTriples({
      subject: "test:ci:run:github:12345",
      predicate: "test:ci:repo",
    });
    expect(repoTriples.triples).toHaveLength(1);
    expect(repoTriples.triples[0].object).toBe("owner/repo");
  });

  it("recordRun stores provider field", async () => {
    await registry.recordRun(sampleRun);

    const providerTriples = await client.listTriples({
      subject: "test:ci:run:github:12345",
      predicate: "test:ci:provider",
    });
    expect(providerTriples.triples).toHaveLength(1);
    expect(providerTriples.triples[0].object).toBe("github");
  });

  it("recordRun updates existing run (delete-then-create)", async () => {
    await registry.recordRun(sampleRun);
    await registry.recordRun({ ...sampleRun, status: "failure" });

    const statusTriples = await client.listTriples({
      subject: "test:ci:run:github:12345",
      predicate: "test:ci:status",
    });
    expect(statusTriples.triples).toHaveLength(1);
    expect(statusTriples.triples[0].object).toBe("failure");
  });

  it("getRecentRuns returns recorded runs", async () => {
    await registry.recordRun(sampleRun);

    const runs = await registry.getRecentRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].id).toBe("12345");
    expect(runs[0].provider).toBe("github");
    expect(runs[0].repo).toBe("owner/repo");
    expect(runs[0].status).toBe("success");
  });

  it("getRecentRuns returns sorted by startedAt descending", async () => {
    await registry.recordRun(sampleRun);
    await registry.recordRun({
      ...sampleRun,
      id: "12346",
      startedAt: "2026-01-02T00:00:00Z",
    });

    const runs = await registry.getRecentRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].id).toBe("12346");
    expect(runs[1].id).toBe("12345");
  });

  it("getRecentRuns filters by provider", async () => {
    await registry.recordRun(sampleRun);
    await registry.recordRun({
      ...sampleRun,
      id: "99999",
      provider: "gitlab",
    });

    const runs = await registry.getRecentRuns({ provider: "github" });
    expect(runs).toHaveLength(1);
    expect(runs[0].provider).toBe("github");
  });

  it("getRunsByRepo filters correctly", async () => {
    await registry.recordRun(sampleRun);
    await registry.recordRun({
      ...sampleRun,
      id: "99999",
      repo: "other/repo",
    });

    const runs = await registry.getRunsByRepo("owner/repo");
    expect(runs).toHaveLength(1);
    expect(runs[0].repo).toBe("owner/repo");
  });

  it("getRecentRuns respects limit", async () => {
    for (let i = 0; i < 5; i++) {
      await registry.recordRun({
        ...sampleRun,
        id: String(10000 + i),
        startedAt: `2026-01-0${i + 1}T00:00:00Z`,
      });
    }

    const runs = await registry.getRecentRuns({ limit: 3 });
    expect(runs).toHaveLength(3);
  });

  it("recordRun handles run without completedAt", async () => {
    const { completedAt: _, ...runWithoutCompleted } = sampleRun;
    await registry.recordRun({ ...runWithoutCompleted, completedAt: undefined });

    const runs = await registry.getRecentRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].completedAt).toBeUndefined();
  });

  it("getRecentRuns returns empty for no runs", async () => {
    const runs = await registry.getRecentRuns();
    expect(runs).toHaveLength(0);
  });
});

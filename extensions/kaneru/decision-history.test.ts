import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DecisionHistory } from "./decision-history.js";
import type { CortexClient as CortexClientType } from "../shared/cortex-client.js";
import type { ConsensusResultLike } from "./decision-history.js";

// ============================================================================
// Mock HTTP layer — intercept fetch for deterministic tests
// ============================================================================

type TripleDto = {
  id?: string;
  subject: string;
  predicate: string;
  object: string | number | boolean | { node: string };
};

let storedTriples: TripleDto[] = [];
let tripleIdCounter = 0;

function resetStore() {
  storedTriples = [];
  tripleIdCounter = 0;
}

function addTriple(t: Omit<TripleDto, "id">) {
  tripleIdCounter++;
  const id = `triple-${tripleIdCounter}-${Date.now()}`;
  storedTriples.push({ id, ...t });
}

function installFetchMock() {
  globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
    const urlStr = typeof url === "string" ? url : url.toString();
    const method = init?.method ?? "GET";

    // POST /api/v1/query — pattern query
    if (urlStr.includes("/api/v1/query") && method === "POST") {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      const matches = storedTriples.filter((t) => {
        if (body.predicate && t.predicate !== body.predicate) return false;
        if (body.subject && t.subject !== body.subject) return false;
        if (body.object !== undefined) {
          const objVal =
            typeof body.object === "object" &&
            body.object !== null &&
            "node" in (body.object as Record<string, unknown>)
              ? (body.object as Record<string, unknown>).node
              : body.object;
          const tripleObj =
            typeof t.object === "object" && t.object !== null && "node" in t.object
              ? t.object.node
              : t.object;
          if (objVal !== tripleObj) return false;
        }
        return true;
      });

      const limit = (body.limit as number) ?? 500;
      const sliced = matches.slice(0, limit);
      return new Response(JSON.stringify({ matches: sliced, total: sliced.length }), {
        status: 200,
      });
    }

    // GET /api/v1/triples — list triples
    if (urlStr.includes("/api/v1/triples") && method === "GET") {
      const u = new URL(urlStr);
      const subject = u.searchParams.get("subject") ?? undefined;
      const predicate = u.searchParams.get("predicate") ?? undefined;
      const limit = Number(u.searchParams.get("limit") ?? 100);

      const matches = storedTriples.filter((t) => {
        if (subject && t.subject !== subject) return false;
        if (predicate && t.predicate !== predicate) return false;
        return true;
      });

      return new Response(
        JSON.stringify({ triples: matches.slice(0, limit), total: matches.length }),
        { status: 200 },
      );
    }

    // POST /api/v1/triples — create triple
    if (urlStr.includes("/api/v1/triples") && method === "POST") {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      addTriple({
        subject: body.subject as string,
        predicate: body.predicate as string,
        object: body.object as string,
      });
      return new Response(JSON.stringify({ hash: "h-" + tripleIdCounter }), { status: 201 });
    }

    // DELETE /api/v1/triples/:id
    if (urlStr.includes("/api/v1/triples/") && method === "DELETE") {
      const id = decodeURIComponent(urlStr.split("/api/v1/triples/")[1]);
      storedTriples = storedTriples.filter((t) => t.id !== id);
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

// ============================================================================
// Helpers
// ============================================================================

function makeConsensus(overrides?: Partial<ConsensusResultLike>): ConsensusResultLike {
  return {
    id: "consensus-1",
    resolved: true,
    strategy: "majority",
    confidence: 0.85,
    resolutions: [
      {
        subject: "Should we use REST or GraphQL?",
        resolvedValue: "REST",
        votes: { "agent-a": 1, "agent-b": 0.5 },
      },
    ],
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("DecisionHistory", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let history: DecisionHistory;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    history = new DecisionHistory(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- record -----

  describe("record", () => {
    it("stores decision with all fields and extracts question from first resolution", async () => {
      const decision = await history.record(makeConsensus());

      expect(decision.id).toBeTruthy();
      expect(decision.question).toBe("Should we use REST or GraphQL?");
      expect(decision.strategy).toBe("majority");
      expect(decision.resolvedValue).toBe("REST");
      expect(decision.confidence).toBe(0.85);
      expect(decision.participants).toEqual(expect.arrayContaining(["agent-a", "agent-b"]));
      expect(decision.votes).toEqual({ "agent-a": 1, "agent-b": 0.5 });
      expect(decision.decidedAt).toBeTruthy();
      expect(decision.ventureId).toBeNull();
      expect(decision.missionId).toBeNull();
    });

    it("includes ventureId and missionId from context", async () => {
      const decision = await history.record(makeConsensus(), {
        ventureId: "v-123",
        missionId: "m-456",
      });

      expect(decision.ventureId).toBe("v-123");
      expect(decision.missionId).toBe("m-456");
    });
  });

  // ----- get -----

  describe("get", () => {
    it("returns decision by ID", async () => {
      const recorded = await history.record(makeConsensus());
      const found = await history.get(recorded.id);

      expect(found).not.toBeNull();
      expect(found!.id).toBe(recorded.id);
      expect(found!.question).toBe("Should we use REST or GraphQL?");
      expect(found!.strategy).toBe("majority");
    });

    it("returns null for missing ID", async () => {
      const found = await history.get("nonexistent");
      expect(found).toBeNull();
    });
  });

  // ----- query -----

  describe("query", () => {
    it("returns all decisions", async () => {
      await history.record(makeConsensus());
      await history.record(
        makeConsensus({
          id: "consensus-2",
          resolutions: [{ subject: "Question 2", resolvedValue: "Yes", votes: { "agent-c": 1 } }],
        }),
      );

      const results = await history.query();
      expect(results).toHaveLength(2);
    });

    it("filters by ventureId", async () => {
      await history.record(makeConsensus(), { ventureId: "v-1" });
      await history.record(
        makeConsensus({ id: "c-2" }),
        { ventureId: "v-2" },
      );

      const results = await history.query({ ventureId: "v-1" });
      expect(results).toHaveLength(1);
      expect(results[0].ventureId).toBe("v-1");
    });

    it("sorts by decidedAt descending", async () => {
      const first = await history.record(makeConsensus());
      // Small delay to ensure different timestamps
      const second = await history.record(makeConsensus({ id: "c-2" }));

      const results = await history.query();
      expect(results).toHaveLength(2);
      // Most recent first
      expect(new Date(results[0].decidedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(results[1].decidedAt).getTime(),
      );
    });
  });

  // ----- explain -----

  describe("explain", () => {
    it("formats human-readable output with votes", async () => {
      const decision = await history.record(makeConsensus());
      const explanation = await history.explain(decision.id);

      expect(explanation).toContain(`Decision: ${decision.id}`);
      expect(explanation).toContain("Question: Should we use REST or GraphQL?");
      expect(explanation).toContain("Strategy: majority");
      expect(explanation).toContain("Outcome: REST");
      expect(explanation).toContain("Confidence: 85.0%");
      expect(explanation).toContain("Votes:");
      expect(explanation).toContain("agent-a: 1");
      expect(explanation).toContain("agent-b: 0.5");
    });

    it("returns not-found message for missing decision", async () => {
      const explanation = await history.explain("missing-id");
      expect(explanation).toBe("Decision not found: missing-id");
    });
  });
});

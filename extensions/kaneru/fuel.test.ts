import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { FuelController } from "./fuel.js";
import type { CortexClient as CortexClientType } from "../shared/cortex-client.js";

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

    if (urlStr.includes("/api/v1/triples") && method === "POST") {
      const body = JSON.parse(init?.body as string) as Record<string, unknown>;
      addTriple({
        subject: body.subject as string,
        predicate: body.predicate as string,
        object: body.object as string,
      });
      return new Response(JSON.stringify({ hash: "h-" + tripleIdCounter }), { status: 201 });
    }

    if (urlStr.includes("/api/v1/triples/") && method === "DELETE") {
      const id = decodeURIComponent(urlStr.split("/api/v1/triples/")[1]);
      storedTriples = storedTriples.filter((t) => t.id !== id);
      return new Response(null, { status: 204 });
    }

    return new Response("Not Found", { status: 404 });
  }) as unknown as typeof fetch;
}

// ============================================================================
// Tests
// ============================================================================

describe("FuelController", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let fuel: FuelController;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    fuel = new FuelController(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  const baseOpts = {
    ventureId: "v1",
    agentId: "agent-1",
    costCents: 100,
    provider: "openai",
    model: "gpt-4",
  };

  // ----- record -----

  describe("record", () => {
    it("stores event with correct fields", async () => {
      const event = await fuel.record({
        ...baseOpts,
        missionId: "m1",
        inputTokens: 500,
        outputTokens: 200,
      });
      expect(event.ventureId).toBe("v1");
      expect(event.agentId).toBe("agent-1");
      expect(event.costCents).toBe(100);
      expect(event.missionId).toBe("m1");
      expect(event.inputTokens).toBe(500);
      expect(event.outputTokens).toBe(200);
      expect(event.provider).toBe("openai");
      expect(event.model).toBe("gpt-4");
      expect(event.occurredAt).toBeTruthy();
    });

    it("rejects negative cost", async () => {
      await expect(fuel.record({ ...baseOpts, costCents: -1 })).rejects.toThrow(
        "Cost cannot be negative",
      );
    });
  });

  // ----- summary -----

  describe("summary", () => {
    it("aggregates totals", async () => {
      await fuel.record({ ...baseOpts, costCents: 100 });
      await fuel.record({ ...baseOpts, costCents: 200 });
      const s = await fuel.summary("v1", 1000);
      expect(s.totalCents).toBe(300);
      expect(s.fuelLimit).toBe(1000);
      expect(s.remaining).toBe(700);
    });

    it("computes byAgent and byMission", async () => {
      await fuel.record({ ...baseOpts, agentId: "a1", costCents: 50, missionId: "m1" });
      await fuel.record({ ...baseOpts, agentId: "a2", costCents: 75, missionId: "m1" });
      await fuel.record({ ...baseOpts, agentId: "a1", costCents: 25, missionId: "m2" });
      const s = await fuel.summary("v1");
      expect(s.byAgent).toHaveLength(2);
      expect(s.byMission).toHaveLength(2);
      // a1 total = 75, a2 total = 75 — sorted by descending cost
      const a1 = s.byAgent.find((a) => a.agentId === "a1");
      expect(a1!.totalCents).toBe(75);
      const m1 = s.byMission.find((m) => m.missionId === "m1");
      expect(m1!.totalCents).toBe(125);
    });

    it("computes burnRate with multiple events", async () => {
      // We rely on the fact that events are recorded with slightly different timestamps
      await fuel.record({ ...baseOpts, costCents: 100 });
      await fuel.record({ ...baseOpts, costCents: 200 });
      const s = await fuel.summary("v1");
      // burnRate is computed from timestamp spread; with near-zero time between them
      // it will be 0 or very large — just check it's a number
      expect(typeof s.burnRate).toBe("number");
    });
  });

  // ----- agentSpend -----

  describe("agentSpend", () => {
    it("returns total for agent", async () => {
      await fuel.record({ ...baseOpts, agentId: "a1", costCents: 40 });
      await fuel.record({ ...baseOpts, agentId: "a1", costCents: 60 });
      await fuel.record({ ...baseOpts, agentId: "a2", costCents: 999 });
      const spend = await fuel.agentSpend("a1");
      expect(spend).toBe(100);
    });
  });

  // ----- checkLimit -----

  describe("checkLimit", () => {
    it("returns exceeded when over limit", async () => {
      await fuel.record({ ...baseOpts, costCents: 500 });
      await fuel.record({ ...baseOpts, costCents: 600 });
      const check = await fuel.checkLimit("v1", 1000);
      expect(check.exceeded).toBe(true);
      expect(check.totalSpent).toBe(1100);
      expect(check.remaining).toBe(0);
    });

    it("returns not exceeded when under limit", async () => {
      await fuel.record({ ...baseOpts, costCents: 100 });
      const check = await fuel.checkLimit("v1", 1000);
      expect(check.exceeded).toBe(false);
      expect(check.remaining).toBe(900);
    });
  });

  // ----- checkAgentLimit -----

  describe("checkAgentLimit", () => {
    it("returns exceeded when agent over limit", async () => {
      await fuel.record({ ...baseOpts, agentId: "a1", costCents: 500 });
      const check = await fuel.checkAgentLimit("a1", 400);
      expect(check.exceeded).toBe(true);
      expect(check.totalSpent).toBe(500);
    });

    it("returns not exceeded when agent under limit", async () => {
      await fuel.record({ ...baseOpts, agentId: "a1", costCents: 100 });
      const check = await fuel.checkAgentLimit("a1", 500);
      expect(check.exceeded).toBe(false);
      expect(check.remaining).toBe(400);
    });
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { MissionManager } from "./mission.js";
import { VentureManager } from "./venture.js";
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

describe("MissionManager", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let ventureMgr: VentureManager;
  let missionMgr: MissionManager;
  let ventureId: string;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    ventureMgr = new VentureManager(client, "test");
    missionMgr = new MissionManager(client, "test", ventureMgr);

    // Create a venture for missions
    const v = await ventureMgr.create({ name: "TestVenture", directive: "d", prefix: "TST" });
    ventureId = v.id;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- create -----

  describe("create", () => {
    it("creates with auto-identifier from venture", async () => {
      const m = await missionMgr.create({ title: "First task", ventureId });
      expect(m.identifier).toBe("TST-1");
      expect(m.title).toBe("First task");
      expect(m.status).toBe("queued");
      expect(m.ventureId).toBe(ventureId);
      expect(m.depth).toBe(0);
    });

    it("rejects empty title", async () => {
      await expect(missionMgr.create({ title: "", ventureId })).rejects.toThrow(
        "Mission title is required",
      );
    });

    it("sets depth from parent", async () => {
      const parent = await missionMgr.create({ title: "Parent", ventureId });
      const child = await missionMgr.create({ title: "Child", ventureId, parentId: parent.id });
      expect(child.depth).toBe(1);
    });

    it("rejects depth exceeding 10", async () => {
      // Build a chain of nested missions until depth > 10 is rejected
      let currentId: string | undefined;
      for (let i = 0; i < 12; i++) {
        try {
          const m = await missionMgr.create({
            title: `Level-${i}`,
            ventureId,
            parentId: currentId,
          });
          currentId = m.id;
        } catch (err) {
          expect((err as Error).message).toMatch("nesting depth exceeds maximum");
          return;
        }
      }
      // Should have thrown before completing the loop
      expect.unreachable("Should have thrown for depth > 10");
    });
  });

  // ----- get -----

  describe("get", () => {
    it("returns mission by ID", async () => {
      const created = await missionMgr.create({ title: "GetMe", ventureId });
      const found = await missionMgr.get(created.id);
      expect(found).not.toBeNull();
      expect(found!.title).toBe("GetMe");
    });

    it("returns null for missing ID", async () => {
      const found = await missionMgr.get("nonexistent");
      expect(found).toBeNull();
    });
  });

  // ----- list -----

  describe("list", () => {
    it("filters by venture", async () => {
      await missionMgr.create({ title: "A", ventureId });
      await missionMgr.create({ title: "B", ventureId });
      const list = await missionMgr.list(ventureId);
      expect(list).toHaveLength(2);
    });

    it("filters by status", async () => {
      await missionMgr.create({ title: "A", ventureId });
      await missionMgr.create({ title: "B", ventureId });
      // Both are queued
      const queued = await missionMgr.list(ventureId, { status: "queued" });
      expect(queued).toHaveLength(2);
      const active = await missionMgr.list(ventureId, { status: "active" });
      expect(active).toHaveLength(0);
    });
  });

  // ----- claim -----

  describe("claim", () => {
    it("succeeds for ready mission", async () => {
      const m = await missionMgr.create({ title: "Claimable", ventureId });
      // Transition to ready first
      await missionMgr.transition(m.id, "ready", "setup-run");
      const result = await missionMgr.claim(m.id, "agent-1", "run-1");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.mission.claimedBy).toBe("agent-1");
        expect(result.mission.status).toBe("active");
      }
    });

    it("returns wrong_status for non-ready mission", async () => {
      const m = await missionMgr.create({ title: "Queued", ventureId });
      const result = await missionMgr.claim(m.id, "agent-1", "run-1");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("wrong_status");
    });

    it("returns already_claimed for different agent", async () => {
      const m = await missionMgr.create({ title: "Taken", ventureId });
      await missionMgr.transition(m.id, "ready", "setup-run");
      await missionMgr.claim(m.id, "agent-1", "run-1");
      // Now agent-2 tries to claim the active mission
      const result = await missionMgr.claim(m.id, "agent-2", "run-2");
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe("wrong_status");
    });

    it("idempotent for same run", async () => {
      const m = await missionMgr.create({ title: "Idempotent", ventureId });
      await missionMgr.transition(m.id, "ready", "setup-run");
      const first = await missionMgr.claim(m.id, "agent-1", "run-1");
      const second = await missionMgr.claim(m.id, "agent-1", "run-1");
      expect(first.ok).toBe(true);
      expect(second.ok).toBe(true);
    });

    it("stale adoption for same agent different run", async () => {
      const m = await missionMgr.create({ title: "Stale", ventureId });
      await missionMgr.transition(m.id, "ready", "setup-run");
      await missionMgr.claim(m.id, "agent-1", "run-1");
      // Same agent, different run (stale adoption)
      const result = await missionMgr.claim(m.id, "agent-1", "run-2");
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.mission.claimRun).toBe("run-2");
      }
    });
  });

  // ----- release -----

  describe("release", () => {
    it("releases claim and returns to ready", async () => {
      const m = await missionMgr.create({ title: "Release", ventureId });
      await missionMgr.transition(m.id, "ready", "setup-run");
      await missionMgr.claim(m.id, "agent-1", "run-1");
      await missionMgr.release(m.id, "run-1");
      const after = await missionMgr.get(m.id);
      expect(after!.status).toBe("ready");
      expect(after!.claimedBy).toBeNull();
    });

    it("throws for wrong run", async () => {
      const m = await missionMgr.create({ title: "WrongRun", ventureId });
      await missionMgr.transition(m.id, "ready", "setup-run");
      await missionMgr.claim(m.id, "agent-1", "run-1");
      await expect(missionMgr.release(m.id, "wrong-run")).rejects.toThrow(
        "Only the claim-holding run",
      );
    });
  });

  // ----- transition -----

  describe("transition", () => {
    it("allows queued -> ready", async () => {
      const m = await missionMgr.create({ title: "QtoR", ventureId });
      const result = await missionMgr.transition(m.id, "ready", "run-1");
      expect(result.status).toBe("ready");
    });

    it("allows ready -> active", async () => {
      const m = await missionMgr.create({ title: "RtoA", ventureId });
      await missionMgr.transition(m.id, "ready", "run-1");
      const result = await missionMgr.transition(m.id, "active", "run-1");
      expect(result.status).toBe("active");
    });

    it("rejects complete -> active", async () => {
      const m = await missionMgr.create({ title: "CtoA", ventureId });
      await missionMgr.transition(m.id, "ready", "run-1");
      await missionMgr.transition(m.id, "active", "run-1");
      await missionMgr.transition(m.id, "complete", "run-1");
      await expect(missionMgr.transition(m.id, "active", "run-1")).rejects.toThrow(
        "Invalid transition",
      );
    });

    it("sets completedAt on complete", async () => {
      const m = await missionMgr.create({ title: "Complete", ventureId });
      await missionMgr.transition(m.id, "ready", "run-1");
      await missionMgr.transition(m.id, "active", "run-1");
      const result = await missionMgr.transition(m.id, "complete", "run-1");
      expect(result.completedAt).toBeTruthy();
    });

    it("clears claim on abandon", async () => {
      const m = await missionMgr.create({ title: "Abandon", ventureId });
      await missionMgr.transition(m.id, "ready", "run-1");
      await missionMgr.claim(m.id, "agent-1", "run-1");
      const result = await missionMgr.transition(m.id, "abandoned", "run-1");
      expect(result.claimedBy).toBeNull();
      expect(result.claimRun).toBeNull();
      expect(result.completedAt).toBeTruthy();
    });
  });

  // ----- complete / abandon shorthands -----

  describe("complete/abandon", () => {
    it("complete shorthand works", async () => {
      const m = await missionMgr.create({ title: "Shorthand", ventureId });
      await missionMgr.transition(m.id, "ready", "run-1");
      await missionMgr.transition(m.id, "active", "run-1");
      const result = await missionMgr.complete(m.id, "run-1");
      expect(result.status).toBe("complete");
    });

    it("abandon shorthand works", async () => {
      const m = await missionMgr.create({ title: "AbandonShort", ventureId });
      await missionMgr.transition(m.id, "ready", "run-1");
      await missionMgr.transition(m.id, "active", "run-1");
      const result = await missionMgr.abandon(m.id, "run-1", "no longer needed");
      expect(result.status).toBe("abandoned");
    });
  });
});

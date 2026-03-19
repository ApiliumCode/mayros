import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { KaneruFacade } from "./kaneru-facade.js";

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
// Tests
// ============================================================================

describe("KaneruFacade", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    resetStore();
    installFetchMock();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function createFacade(opts?: { namespace?: string }) {
    return new KaneruFacade({
      host: "127.0.0.1",
      port: 19090,
      namespace: opts?.namespace ?? "test",
    });
  }

  // ----- constructor -----

  describe("constructor", () => {
    it("creates instance without errors", () => {
      const facade = createFacade();
      expect(facade).toBeDefined();
      expect(facade).toBeInstanceOf(KaneruFacade);
    });

    it("accepts string port", () => {
      const facade = new KaneruFacade({ host: "127.0.0.1", port: "19090" });
      expect(facade).toBeDefined();
    });

    it("uses default host, port, and namespace when omitted", () => {
      const facade = new KaneruFacade({});
      expect(facade).toBeDefined();
    });
  });

  // ----- squadCreate -----

  describe("squadCreate", () => {
    it("calls TeamManager.createTeam with correct params", async () => {
      const facade = createFacade();
      const result = await facade.squadCreate({
        name: "alpha-squad",
        agents: [
          { agentId: "agent-1", role: "leader", task: "coordinate" },
          { agentId: "agent-2", role: "worker" },
        ],
      });

      expect(result).toBeDefined();
      expect(result.name).toBe("alpha-squad");
      expect(result.members).toHaveLength(2);
      expect(result.members[0].agentId).toBe("agent-1");
      expect(result.members[0].role).toBe("leader");
      expect(result.members[1].agentId).toBe("agent-2");
      expect(result.members[1].role).toBe("worker");
      expect(result.status).toBe("pending");
      expect(result.strategy).toBe("additive");
    });

    it("uses custom strategy when provided", async () => {
      const facade = createFacade();
      const result = await facade.squadCreate({
        name: "beta-squad",
        agents: [{ agentId: "agent-1", role: "solo" }],
        strategy: "newest-wins",
      });

      expect(result.strategy).toBe("newest-wins");
    });
  });

  // ----- squadStatus -----

  describe("squadStatus", () => {
    it("returns team info for existing squad", async () => {
      const facade = createFacade();
      const created = await facade.squadCreate({
        name: "status-squad",
        agents: [{ agentId: "agent-1", role: "worker" }],
      });

      const status = await facade.squadStatus(created.id);
      expect(status).not.toBeNull();
      expect(status?.name).toBe("status-squad");
      expect(status?.id).toBe(created.id);
    });

    it("returns null for non-existent squad", async () => {
      const facade = createFacade();
      const status = await facade.squadStatus("nonexistent-id");
      expect(status).toBeNull();
    });
  });

  // ----- squadList -----

  describe("squadList", () => {
    it("returns empty array when no squads exist", async () => {
      const facade = createFacade();
      const list = await facade.squadList();
      expect(Array.isArray(list)).toBe(true);
      expect(list).toHaveLength(0);
    });

    it("returns array of created squads", async () => {
      const facade = createFacade();
      await facade.squadCreate({
        name: "squad-1",
        agents: [{ agentId: "a1", role: "worker" }],
      });
      await facade.squadCreate({
        name: "squad-2",
        agents: [{ agentId: "a2", role: "worker" }],
      });

      const list = await facade.squadList();
      expect(list).toHaveLength(2);
      expect(list.map((s) => s.name).sort()).toEqual(["squad-1", "squad-2"]);
    });
  });

  // ----- squadRun -----

  describe("squadRun", () => {
    it("calls orchestrator.startWorkflow with squadId in config", async () => {
      const facade = createFacade();

      // startWorkflow looks up a workflow by name — since no workflows are
      // registered in tests, it should throw a "not found" error
      await expect(
        facade.squadRun("squad-123", "unknown-mission"),
      ).rejects.toThrow();
    });
  });

  // ----- delegate -----

  describe("delegate", () => {
    it("calls delegation engine and returns context", async () => {
      const facade = createFacade();
      const ctx = await facade.delegate("parent-agent", "child-agent", "review code");

      expect(ctx).toBeDefined();
      expect(ctx.task).toBe("review code");
      expect(ctx.parentAgentId).toBe("parent-agent");
    });
  });

  // ----- consensusResolve -----

  describe("consensusResolve", () => {
    it("throws when squad not found", async () => {
      const facade = createFacade();
      await expect(
        facade.consensusResolve({
          squadId: "nonexistent",
          question: "Should we deploy?",
        }),
      ).rejects.toThrow("Squad not found: nonexistent");
    });

    it("resolves consensus for existing squad", async () => {
      const facade = createFacade();
      const squad = await facade.squadCreate({
        name: "consensus-squad",
        agents: [
          { agentId: "agent-a", role: "voter" },
          { agentId: "agent-b", role: "voter" },
        ],
      });

      const result = await facade.consensusResolve({
        squadId: squad.id,
        question: "Should we deploy?",
        strategy: "weighted",
      });

      expect(result).toBeDefined();
    });
  });

  // ----- route -----

  describe("route", () => {
    it("delegates to taskRouter.selectAgent and parses stateKey", async () => {
      const facade = createFacade();
      const result = await facade.route("implement a new feature", ["agent-1"]);
      expect(result).toBeDefined();
      expect(result.agentId).toBe("agent-1");
      expect(result.confidence).toBeGreaterThanOrEqual(0);
      expect(result.routingId).toBeDefined();
      expect(typeof result.taskType).toBe("string");
      expect(typeof result.complexity).toBe("string");
      expect(typeof result.domain).toBe("string");
    });
  });

  // ----- fuse -----

  describe("fuse", () => {
    it("calls fusion.merge with correct parameters", async () => {
      const facade = createFacade();

      // Add some triples in the source namespace
      addTriple({
        subject: "mem-src",
        predicate: "test:memory:ownedBy",
        object: { node: "ns-source" },
      });
      addTriple({ subject: "mem-src", predicate: "test:memory:text", object: "source data" });

      const report = await facade.fuse("ns-source", "ns-target", "additive");
      expect(report).toBeDefined();
      expect(report.strategy).toBe("additive");
    });

    it("defaults to additive strategy", async () => {
      const facade = createFacade();
      const report = await facade.fuse("ns-a", "ns-b");
      expect(report.strategy).toBe("additive");
    });
  });

  // ----- mailboxSend -----

  describe("mailboxSend", () => {
    it("delegates to mailbox.send", async () => {
      const facade = createFacade();
      const result = await facade.mailboxSend("agent-a", "agent-b", "hello world");

      expect(result).toBeDefined();
      expect(result.from).toBe("agent-a");
      expect(result.to).toBe("agent-b");
      expect(result.content).toBe("hello world");
      expect(result.type).toBe("info");
    });

    it("accepts custom message type", async () => {
      const facade = createFacade();
      const result = await facade.mailboxSend("agent-a", "agent-b", "task output", "result");
      expect(result.type).toBe("result");
    });
  });

  // ----- mailboxCheck -----

  describe("mailboxCheck", () => {
    it("delegates to mailbox.inbox", async () => {
      const facade = createFacade();
      const messages = await facade.mailboxCheck("agent-a");
      expect(Array.isArray(messages)).toBe(true);
    });
  });

  // ----- mailboxStats -----

  describe("mailboxStats", () => {
    it("delegates to mailbox.stats", async () => {
      const facade = createFacade();
      const stats = await facade.mailboxStats("agent-a");
      expect(stats).toBeDefined();
    });
  });

  // ----- getDashboard -----

  describe("getDashboard", () => {
    it("returns dashboard with expected shape", async () => {
      const facade = createFacade();
      const dashboard = await facade.getDashboard();

      expect(dashboard).toBeDefined();
      expect(Array.isArray(dashboard.squads)).toBe(true);
      expect(Array.isArray(dashboard.routeTable)).toBe(true);
      expect(dashboard.stats).toBeDefined();
      expect(typeof dashboard.stats.activeSquads).toBe("number");
      expect(typeof dashboard.stats.qTableSize).toBe("number");
      expect(typeof dashboard.stats.epsilon).toBe("number");
    });

    it("returns bounded routeTable with max 100 entries", async () => {
      const facade = createFacade();
      const dashboard = await facade.getDashboard();

      // With no routing activity, table should be empty
      expect(dashboard.routeTable.length).toBeLessThanOrEqual(100);
    });

    it("includes squads in dashboard after creation", async () => {
      const facade = createFacade();
      await facade.squadCreate({
        name: "dashboard-squad",
        agents: [{ agentId: "agent-1", role: "worker" }],
      });

      const dashboard = await facade.getDashboard();
      expect(dashboard.squads).toHaveLength(1);
      expect(dashboard.squads[0]).toBeDefined();
      expect(typeof dashboard.squads[0].id).toBe("string");
      expect(typeof dashboard.squads[0].name).toBe("string");
      expect(dashboard.stats.activeSquads).toBeGreaterThanOrEqual(0);
    });
  });

  // ----- destroy -----

  describe("destroy", () => {
    it("cleans up client without throwing", () => {
      const facade = createFacade();
      expect(() => facade.destroy()).not.toThrow();
    });

    it("can be called multiple times safely", () => {
      const facade = createFacade();
      facade.destroy();
      expect(() => facade.destroy()).not.toThrow();
    });
  });
});

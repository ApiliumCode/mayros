import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { KnowledgeTransferService } from "./knowledge-transfer.js";
import type { CortexClient as CortexClientType } from "../shared/cortex-client.js";
import type { KnowledgeFusion } from "../agent-mesh/knowledge-fusion.js";
import type { NamespaceManager } from "../agent-mesh/namespace-manager.js";
import type { FusionReport } from "../agent-mesh/mesh-protocol.js";

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
// Mock dependencies
// ============================================================================

function makeFusionReport(overrides?: Partial<FusionReport>): FusionReport {
  return {
    added: 15,
    skipped: 2,
    conflicts: 0,
    details: [],
    strategy: "additive",
    sourceNs: "private:agent-1",
    targetNs: "test:shared:venture",
    ...overrides,
  };
}

function createMockFusion(report?: FusionReport): KnowledgeFusion {
  return {
    merge: vi.fn().mockResolvedValue(report ?? makeFusionReport()),
  } as unknown as KnowledgeFusion;
}

function createFailingFusion(): KnowledgeFusion {
  return {
    merge: vi.fn().mockRejectedValue(new Error("Namespace empty")),
  } as unknown as KnowledgeFusion;
}

function createMockNamespaceManager(): NamespaceManager {
  return {
    getPrivateNs: vi.fn((agentId: string) => `private:${agentId}`),
    getSharedNs: vi.fn((scope: string) => `shared:${scope}`),
  } as unknown as NamespaceManager;
}

// ============================================================================
// Tests
// ============================================================================

describe("KnowledgeTransferService", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- transferOnComplete -----

  describe("transferOnComplete", () => {
    it("calls fusion merge and records transfer", async () => {
      const fusion = createMockFusion();
      const nsMgr = createMockNamespaceManager();
      const svc = new KnowledgeTransferService(client, "test", fusion, nsMgr);

      const result = await svc.transferOnComplete("agent-1", "m-1");

      expect(fusion.merge).toHaveBeenCalledWith(
        "private:agent-1",
        "test:shared:venture",
        "additive",
      );
      expect(result.sourceAgent).toBe("agent-1");
      expect(result.missionId).toBe("m-1");
      expect(result.triplesTransferred).toBe(15);
      expect(result.strategy).toBe("additive");
      expect(result.targetNamespace).toBe("test:shared:venture");
      expect(result.id).toBeTruthy();
      expect(result.timestamp).toBeTruthy();
    });

    it("handles fusion failure gracefully and returns 0 transferred", async () => {
      const fusion = createFailingFusion();
      const nsMgr = createMockNamespaceManager();
      const svc = new KnowledgeTransferService(client, "test", fusion, nsMgr);

      const result = await svc.transferOnComplete("agent-1", "m-1");

      expect(result.triplesTransferred).toBe(0);
      expect(result.sourceAgent).toBe("agent-1");
      expect(result.missionId).toBe("m-1");
    });

    it("uses squad namespace when squadId provided", async () => {
      const fusion = createMockFusion();
      const nsMgr = createMockNamespaceManager();
      const svc = new KnowledgeTransferService(client, "test", fusion, nsMgr);

      const result = await svc.transferOnComplete("agent-1", "m-1", "squad-alpha");

      expect(nsMgr.getSharedNs).toHaveBeenCalledWith("team-squad-alpha");
      expect(result.targetNamespace).toBe("shared:team-squad-alpha");
    });
  });

  // ----- getTransferHistory -----

  describe("getTransferHistory", () => {
    it("returns history sorted by timestamp descending", async () => {
      const fusion = createMockFusion();
      const nsMgr = createMockNamespaceManager();
      const svc = new KnowledgeTransferService(client, "test", fusion, nsMgr);

      await svc.transferOnComplete("agent-1", "m-1");
      await svc.transferOnComplete("agent-1", "m-2");

      const history = await svc.getTransferHistory("agent-1");
      expect(history).toHaveLength(2);
      expect(new Date(history[0].timestamp).getTime()).toBeGreaterThanOrEqual(
        new Date(history[1].timestamp).getTime(),
      );
    });
  });

  // ----- default config -----

  describe("default config", () => {
    it("uses additive strategy and caps at 100 max triples", async () => {
      const report = makeFusionReport({ added: 200 });
      const fusion = createMockFusion(report);
      const nsMgr = createMockNamespaceManager();
      const svc = new KnowledgeTransferService(client, "test", fusion, nsMgr);

      const result = await svc.transferOnComplete("agent-1", "m-1");

      // Default maxTriples is 100, so 200 should be capped
      expect(result.triplesTransferred).toBe(100);
      expect(fusion.merge).toHaveBeenCalledWith(expect.any(String), expect.any(String), "additive");
    });
  });
});

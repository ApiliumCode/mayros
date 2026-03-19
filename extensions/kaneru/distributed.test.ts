import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { DistributedVentureManager } from "./distributed.js";
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

    // GET /api/v1/dag/tips
    if (urlStr.includes("/api/v1/dag/tips") && method === "GET") {
      return new Response(JSON.stringify({ tips: ["tip-abc", "tip-def"], total: 2 }), {
        status: 200,
      });
    }

    // POST /api/v1/dag/sync
    if (urlStr.includes("/api/v1/dag/sync") && !urlStr.includes("/pull") && method === "POST") {
      return new Response(JSON.stringify({ actions_sent: 3 }), { status: 200 });
    }

    // POST /api/v1/dag/sync/pull
    if (urlStr.includes("/api/v1/dag/sync/pull") && method === "POST") {
      return new Response(
        JSON.stringify({ triples_added: 5, conflicts: 1 }),
        { status: 200 },
      );
    }

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

describe("DistributedVentureManager", () => {
  const originalFetch = globalThis.fetch;
  let client: CortexClientType;
  let mgr: DistributedVentureManager;

  beforeEach(async () => {
    resetStore();
    installFetchMock();
    const { CortexClient } = await import("../shared/cortex-client.js");
    client = new CortexClient({ host: "127.0.0.1", port: 19090 });
    mgr = new DistributedVentureManager(client, "test");
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  // ----- registerPeer -----

  describe("registerPeer", () => {
    it("adds peer triple", async () => {
      await mgr.registerPeer("v-1", "node-alpha");
      const peers = await mgr.listPeers("v-1");
      expect(peers).toContain("node-alpha");
    });

    it("is idempotent for duplicate registration", async () => {
      await mgr.registerPeer("v-1", "node-alpha");
      await mgr.registerPeer("v-1", "node-alpha");
      const peers = await mgr.listPeers("v-1");
      // Should only have one entry, not two
      expect(peers.filter((p) => p === "node-alpha")).toHaveLength(1);
    });
  });

  // ----- removePeer -----

  describe("removePeer", () => {
    it("removes peer triple", async () => {
      await mgr.registerPeer("v-1", "node-alpha");
      await mgr.registerPeer("v-1", "node-beta");
      await mgr.removePeer("v-1", "node-alpha");
      const peers = await mgr.listPeers("v-1");
      expect(peers).not.toContain("node-alpha");
      expect(peers).toContain("node-beta");
    });
  });

  // ----- listPeers -----

  describe("listPeers", () => {
    it("returns registered peers", async () => {
      await mgr.registerPeer("v-1", "node-a");
      await mgr.registerPeer("v-1", "node-b");
      const peers = await mgr.listPeers("v-1");
      expect(peers).toHaveLength(2);
      expect(peers).toContain("node-a");
      expect(peers).toContain("node-b");
    });

    it("returns empty array for venture with no peers", async () => {
      const peers = await mgr.listPeers("v-unknown");
      expect(peers).toEqual([]);
    });
  });

  // ----- syncVenture -----

  describe("syncVenture", () => {
    it("returns empty result when no peers", async () => {
      const result = await mgr.syncVenture("v-1");
      expect(result.actionsSynced).toBe(0);
      expect(result.triplesAdded).toBe(0);
      expect(result.conflicts).toBe(0);
      expect(result.syncedAt).toBeTruthy();
    });

    it("records lastSyncAt after sync with peers", async () => {
      await mgr.registerPeer("v-1", "node-alpha");
      const result = await mgr.syncVenture("v-1");
      expect(result.actionsSynced).toBe(3);
      expect(result.triplesAdded).toBe(5);
      expect(result.conflicts).toBe(1);

      const status = await mgr.getSyncStatus("v-1");
      expect(status.lastSyncAt).toBeTruthy();
    });
  });

  // ----- getSyncStatus -----

  describe("getSyncStatus", () => {
    it("returns peers and lastSyncAt", async () => {
      await mgr.registerPeer("v-1", "node-a");
      await mgr.registerPeer("v-1", "node-b");
      await mgr.syncVenture("v-1");

      const status = await mgr.getSyncStatus("v-1");
      expect(status.ventureId).toBe("v-1");
      expect(status.peerNodeIds).toHaveLength(2);
      expect(status.syncStrategy).toBe("full");
      expect(status.lastSyncAt).not.toBeNull();
    });

    it("returns null lastSyncAt when never synced", async () => {
      await mgr.registerPeer("v-1", "node-a");
      const status = await mgr.getSyncStatus("v-1");
      expect(status.lastSyncAt).toBeNull();
    });
  });
});

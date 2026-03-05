import { describe, it, expect, vi, beforeEach } from "vitest";
import { PeerManager, type PeerInfo } from "./peer-manager.js";
import type {
  CortexClient,
  CreateTripleRequest,
  TripleDto,
  ListTriplesResponse,
  PatternQueryResponse,
} from "../shared/cortex-client.js";

// ============================================================================
// Mock Cortex client
// ============================================================================

function createMockClient() {
  const triples = new Map<string, TripleDto[]>();

  const client = {
    createTriple: vi.fn(async (req: CreateTripleRequest) => {
      const existing = triples.get(req.subject) ?? [];
      // Replace if same predicate exists (emulate upsert)
      const idx = existing.findIndex((t) => t.predicate === req.predicate);
      const triple: TripleDto = {
        id: `id-${Math.random().toString(36).slice(2)}`,
        subject: req.subject,
        predicate: req.predicate,
        object: req.object,
        created_at: new Date().toISOString(),
      };
      if (idx >= 0) {
        existing[idx] = triple;
      } else {
        existing.push(triple);
      }
      triples.set(req.subject, existing);
      return triple;
    }),
    listTriples: vi.fn(
      async (query: { subject?: string; limit?: number }): Promise<ListTriplesResponse> => {
        if (!query.subject) return { triples: [], total: 0 };
        const matching = triples.get(query.subject) ?? [];
        return { triples: matching, total: matching.length };
      },
    ),
    patternQuery: vi.fn(
      async (query: { predicate?: string; limit?: number }): Promise<PatternQueryResponse> => {
        const matches: TripleDto[] = [];
        for (const [, ts] of triples) {
          for (const t of ts) {
            if (query.predicate && t.predicate === query.predicate) {
              matches.push(t);
            }
          }
        }
        return { matches, total: matches.length };
      },
    ),
    isHealthy: vi.fn(async () => true),
  } as unknown as CortexClient;

  return { client, triples };
}

// ============================================================================
// PeerManager tests
// ============================================================================

describe("PeerManager", () => {
  let mockClient: ReturnType<typeof createMockClient>;
  let pm: PeerManager;

  beforeEach(() => {
    mockClient = createMockClient();
    pm = new PeerManager(mockClient.client, "test");
  });

  describe("addPeer", () => {
    it("adds a peer and returns PeerInfo", async () => {
      const peer = await pm.addPeer({
        nodeId: "node-1",
        endpoint: "http://192.168.1.5:8080",
        namespaces: ["mayros"],
        enabled: true,
      });

      expect(peer.nodeId).toBe("node-1");
      expect(peer.endpoint).toBe("http://192.168.1.5:8080");
      expect(peer.namespaces).toEqual(["mayros"]);
      expect(peer.status).toBe("active");
      expect(peer.totalSyncs).toBe(0);
    });

    it("sets paused status when enabled=false", async () => {
      const peer = await pm.addPeer({
        nodeId: "node-2",
        endpoint: "http://10.0.0.1:8080",
        namespaces: ["mayros"],
        enabled: false,
      });

      expect(peer.status).toBe("paused");
    });
  });

  describe("getPeer", () => {
    it("returns null for unknown peer", async () => {
      const peer = await pm.getPeer("nonexistent");
      expect(peer).toBeNull();
    });

    it("returns peer after adding", async () => {
      await pm.addPeer({
        nodeId: "node-3",
        endpoint: "http://host:8080",
        namespaces: ["ns1", "ns2"],
        enabled: true,
      });

      const peer = await pm.getPeer("node-3");
      expect(peer).not.toBeNull();
      expect(peer!.nodeId).toBe("node-3");
      expect(peer!.namespaces).toEqual(["ns1", "ns2"]);
    });
  });

  describe("removePeer", () => {
    it("returns false for unknown peer", async () => {
      const result = await pm.removePeer("unknown");
      expect(result).toBe(false);
    });

    it("marks peer as removed", async () => {
      await pm.addPeer({
        nodeId: "node-4",
        endpoint: "http://host:8080",
        namespaces: ["mayros"],
        enabled: true,
      });

      const result = await pm.removePeer("node-4");
      expect(result).toBe(true);

      const peer = await pm.getPeer("node-4");
      expect(peer!.status).toBe("removed");
    });
  });

  describe("listPeers", () => {
    it("returns empty array when no peers", async () => {
      const peers = await pm.listPeers();
      expect(peers).toHaveLength(0);
    });

    it("excludes removed peers by default", async () => {
      await pm.addPeer({
        nodeId: "a",
        endpoint: "http://a:8080",
        namespaces: ["m"],
        enabled: true,
      });
      await pm.addPeer({
        nodeId: "b",
        endpoint: "http://b:8080",
        namespaces: ["m"],
        enabled: true,
      });
      await pm.removePeer("b");

      const peers = await pm.listPeers();
      expect(peers).toHaveLength(1);
      expect(peers[0].nodeId).toBe("a");
    });

    it("includes removed when requested", async () => {
      await pm.addPeer({
        nodeId: "c",
        endpoint: "http://c:8080",
        namespaces: ["m"],
        enabled: true,
      });
      await pm.removePeer("c");

      const peers = await pm.listPeers({ includeRemoved: true });
      expect(peers).toHaveLength(1);
    });
  });

  describe("recordSyncResult", () => {
    it("updates sync stats", async () => {
      await pm.addPeer({
        nodeId: "sync-1",
        endpoint: "http://host:8080",
        namespaces: ["m"],
        enabled: true,
      });

      await pm.recordSyncResult("sync-1", {
        peerId: "sync-1",
        triplesReceived: 10,
        triplesApplied: 5,
        conflicts: [],
        syncedAt: "2024-06-01T00:00:00Z",
        durationMs: 100,
      });

      const peer = await pm.getPeer("sync-1");
      expect(peer!.lastSyncAt).toBe("2024-06-01T00:00:00Z");
      expect(peer!.totalSyncs).toBe(1);
      expect(peer!.totalTriplesSynced).toBe(5);
      expect(peer!.status).toBe("active");
    });
  });

  describe("markUnreachable", () => {
    it("sets status to unreachable", async () => {
      await pm.addPeer({
        nodeId: "dead-1",
        endpoint: "http://host:8080",
        namespaces: ["m"],
        enabled: true,
      });
      await pm.markUnreachable("dead-1");

      const peer = await pm.getPeer("dead-1");
      expect(peer!.status).toBe("unreachable");
    });
  });

  describe("initFromConfig", () => {
    it("adds new peers from config", async () => {
      const added = await pm.initFromConfig([
        { nodeId: "cfg-1", endpoint: "http://a:8080", namespaces: ["m"], enabled: true },
        { nodeId: "cfg-2", endpoint: "http://b:8080", namespaces: ["m"], enabled: true },
      ]);

      expect(added).toBe(2);
    });

    it("skips existing peers", async () => {
      await pm.addPeer({
        nodeId: "cfg-3",
        endpoint: "http://old:8080",
        namespaces: ["m"],
        enabled: true,
      });

      const added = await pm.initFromConfig([
        { nodeId: "cfg-3", endpoint: "http://new:8080", namespaces: ["m"], enabled: true },
      ]);

      expect(added).toBe(0);
    });

    it("skips entries without nodeId or endpoint", async () => {
      const added = await pm.initFromConfig([
        { nodeId: "", endpoint: "http://a:8080", namespaces: ["m"], enabled: true },
        { nodeId: "ok", endpoint: "", namespaces: ["m"], enabled: true },
      ]);

      expect(added).toBe(0);
    });
  });

  describe("status", () => {
    it("returns aggregate statistics", async () => {
      await pm.addPeer({
        nodeId: "s1",
        endpoint: "http://a:8080",
        namespaces: ["m"],
        enabled: true,
      });
      await pm.addPeer({
        nodeId: "s2",
        endpoint: "http://b:8080",
        namespaces: ["m"],
        enabled: true,
      });
      await pm.markUnreachable("s2");

      const status = await pm.status();
      expect(status.totalPeers).toBe(2);
      expect(status.activePeers).toBe(1);
      expect(status.unreachablePeers).toBe(1);
    });
  });

  describe("toSyncPeer", () => {
    it("converts PeerInfo to SyncPeer", () => {
      const info: PeerInfo = {
        nodeId: "n1",
        endpoint: "http://host:8080",
        namespaces: ["ns1", "ns2"],
        status: "active",
        lastSyncAt: "2024-01-01T00:00:00Z",
        addedAt: "2024-01-01T00:00:00Z",
        totalSyncs: 5,
        totalTriplesSynced: 100,
      };

      const syncPeer = pm.toSyncPeer(info);
      expect(syncPeer.nodeId).toBe("n1");
      expect(syncPeer.endpoint).toBe("http://host:8080");
      expect(syncPeer.lastSyncAt).toBe("2024-01-01T00:00:00Z");
      expect(syncPeer.namespaces).toEqual(["ns1", "ns2"]);
    });
  });
});

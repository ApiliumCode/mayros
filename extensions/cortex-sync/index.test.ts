/**
 * Tests for cortex-sync plugin — dual sync mode (native P2P vs polled),
 * tool behavior in each mode, and hook skip logic.
 */

import { describe, expect, it, vi, beforeEach } from "vitest";
import type { P2pStatusResponse } from "../shared/cortex-client.js";

// ---------- Mock state ----------

const mockState = vi.hoisted(() => ({
  healthyFn: vi.fn(async () => true),
  p2pProbeFn: vi.fn(async (): Promise<P2pStatusResponse | null> => null),
  p2pStatusFn: vi.fn(
    async (): Promise<P2pStatusResponse> => ({
      node_id: "abcdef1234567890abcdef1234567890",
      enabled: true,
      port: 19091,
      peer_count: 2,
      connected_peers: [
        { addr: "10.0.0.1:19091", connected: true },
        { addr: "10.0.0.2:19091", connected: false },
      ],
      gossip_stats: {
        round: 42,
        pending_announcements: 0,
        known_ids: 1500,
        bloom_filter_items: 1200,
        bloom_filter_fpr: 0.01,
      },
      sync_stats: {
        peer_count: 2,
        local_ids: 800,
        total_successful_syncs: 15,
        total_failed_syncs: 1,
      },
    }),
  ),
  p2pAddPeerFn: vi.fn(async (addr: string) => ({ status: "connected", addr })),
  listTriplesFn: vi.fn(async () => []),
  createTripleFn: vi.fn(async () => ({})),
  registeredTools: [] as Array<{ name: string; execute: (...args: unknown[]) => Promise<unknown> }>,
  registeredEvents: {} as Record<string, Array<(...args: unknown[]) => Promise<void>>>,
}));

// Mock CortexClient
vi.mock("../shared/cortex-client.js", () => ({
  CortexClient: class MockCortexClient {
    async isHealthy() {
      return mockState.healthyFn();
    }
    async p2pProbe() {
      return mockState.p2pProbeFn();
    }
    async p2pStatus() {
      return mockState.p2pStatusFn();
    }
    async p2pAddPeer(addr: string) {
      return mockState.p2pAddPeerFn(addr);
    }
    async listTriples() {
      return mockState.listTriplesFn();
    }
    async createTriple() {
      return mockState.createTripleFn();
    }
  },
}));

// Mock PeerManager
vi.mock("./peer-manager.js", () => ({
  PeerManager: class MockPeerManager {
    async initFromConfig() {
      return 0;
    }
    async status() {
      return {
        totalPeers: 1,
        activePeers: 1,
        unreachablePeers: 0,
        totalSyncs: 5,
        totalTriplesSynced: 100,
      };
    }
    async listPeers() {
      return [
        {
          nodeId: "peer1",
          endpoint: "http://10.0.0.1:8080",
          namespaces: ["mayros"],
          status: "active",
          lastSyncAt: "2026-01-01T00:00:00Z",
          totalSyncs: 5,
          totalTriplesSynced: 100,
        },
      ];
    }
    async getPeer(nodeId: string) {
      if (nodeId === "peer1") {
        return {
          nodeId: "peer1",
          endpoint: "http://10.0.0.1:8080",
          namespaces: ["mayros"],
          status: "active",
        };
      }
      return null;
    }
    async addPeer(opts: { nodeId: string; endpoint: string; namespaces: string[] }) {
      return { ...opts, status: "active" };
    }
    toSyncPeer(peer: { nodeId: string; endpoint: string; namespaces: string[] }) {
      return peer;
    }
    async recordSyncResult() {}
    async markUnreachable() {}
  },
}));

// Mock sync-protocol
vi.mock("./sync-protocol.js", () => ({
  syncWithPeer: vi.fn(async () => ({
    peerId: "peer1",
    triplesReceived: 10,
    triplesApplied: 8,
    conflicts: [],
    durationMs: 200,
  })),
}));

// Mock config
vi.mock("./config.js", () => ({
  parseCortexSyncConfig: vi.fn((input: Record<string, unknown>) => {
    const nativeP2pPreferred =
      (input as { _nativeP2pPreferred?: boolean })._nativeP2pPreferred ?? true;
    const autoSync = (input as { _autoSync?: boolean })._autoSync ?? false;
    return {
      namespace: "mayros",
      cortex: { host: "127.0.0.1", port: 8080 },
      sync: {
        intervalSeconds: 300,
        autoSync,
        conflictStrategy: "last-writer-wins",
        maxTriplesPerSync: 5000,
        syncTimeoutMs: 30000,
        nativeP2pPreferred,
      },
      discovery: { bonjourEnabled: false, manualPeers: [] },
    };
  }),
}));

// ---------- Fake MayrosPluginApi ----------

function createFakeApi(pluginConfig: Record<string, unknown> = {}) {
  const tools: typeof mockState.registeredTools = [];
  const events: typeof mockState.registeredEvents = {};
  const logs: string[] = [];

  const api = {
    pluginConfig,
    logger: {
      info: vi.fn((msg: string) => logs.push(msg)),
      warn: vi.fn((msg: string) => logs.push(msg)),
      debug: vi.fn((msg: string) => logs.push(msg)),
      error: vi.fn((msg: string) => logs.push(msg)),
    },
    registerTool(def: { name: string; execute: (...args: unknown[]) => Promise<unknown> }) {
      tools.push(def);
    },
    on(event: string, handler: (...args: unknown[]) => Promise<void>) {
      if (!events[event]) events[event] = [];
      events[event].push(handler);
    },
  };

  return { api, tools, events, logs };
}

async function registerPlugin(pluginConfig: Record<string, unknown> = {}) {
  const { api, tools, events, logs } = createFakeApi(pluginConfig);
  const mod = await import("./index.js");
  const plugin = mod.default;
  await plugin.register(api as unknown as Parameters<typeof plugin.register>[0]);
  // Allow the startup IIFE to resolve
  await new Promise((r) => setTimeout(r, 10));
  return { tools, events, logs, api };
}

// ---------- Tests ----------

describe("cortex-sync plugin P2P bridge (B3)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.healthyFn.mockResolvedValue(true);
    mockState.p2pProbeFn.mockResolvedValue(null);
  });

  describe("probeP2p detection", () => {
    it("stays in polled mode when p2pProbe returns null", async () => {
      mockState.p2pProbeFn.mockResolvedValue(null);

      const { tools } = await registerPlugin();
      const statusTool = tools.find((t) => t.name === "cortex_sync_status");
      const result = (await statusTool!.execute("tc1", {})) as {
        content: Array<{ text: string }>;
        details: Record<string, unknown>;
      };

      expect(result.details.syncMode).toBe("polled");
      expect(result.content[0].text).toContain("Mode: polled");
    });

    it("switches to native mode when p2pProbe returns enabled status", async () => {
      mockState.p2pProbeFn.mockResolvedValue({
        node_id: "abcdef1234567890abcdef1234567890",
        enabled: true,
        port: 19091,
        peer_count: 0,
        connected_peers: [],
        gossip_stats: {
          round: 0,
          pending_announcements: 0,
          known_ids: 0,
          bloom_filter_items: 0,
          bloom_filter_fpr: 0,
        },
        sync_stats: {
          peer_count: 0,
          local_ids: 0,
          total_successful_syncs: 0,
          total_failed_syncs: 0,
        },
      });

      const { tools, logs } = await registerPlugin();
      const statusTool = tools.find((t) => t.name === "cortex_sync_status");
      const result = (await statusTool!.execute("tc1", {})) as {
        content: Array<{ text: string }>;
        details: Record<string, unknown>;
      };

      expect(result.details.syncMode).toBe("native");
      expect(logs.some((l) => l.includes("native P2P detected"))).toBe(true);
    });

    it("respects nativeP2pPreferred=false (does not probe)", async () => {
      // The mock parseCortexSyncConfig reads _nativeP2pPreferred
      const probeSpy = mockState.p2pProbeFn;

      await registerPlugin({ _nativeP2pPreferred: false });

      expect(probeSpy).not.toHaveBeenCalled();
    });
  });

  describe("cortex_sync_status tool", () => {
    it("includes P2P info in native mode", async () => {
      mockState.p2pProbeFn.mockResolvedValue({
        node_id: "abcdef1234567890abcdef1234567890",
        enabled: true,
        port: 19091,
        peer_count: 2,
        connected_peers: [{ addr: "10.0.0.1:19091", connected: true }],
        gossip_stats: {
          round: 42,
          pending_announcements: 0,
          known_ids: 1500,
          bloom_filter_items: 1200,
          bloom_filter_fpr: 0.01,
        },
        sync_stats: {
          peer_count: 2,
          local_ids: 800,
          total_successful_syncs: 15,
          total_failed_syncs: 1,
        },
      });

      const { tools } = await registerPlugin();
      const statusTool = tools.find((t) => t.name === "cortex_sync_status");
      const result = (await statusTool!.execute("tc1", {})) as { content: Array<{ text: string }> };
      const text = result.content[0].text;

      expect(text).toContain("Native P2P:");
      expect(text).toContain("Node ID: abcdef1234567890...");
      expect(text).toContain("Port: 19091");
      expect(text).toContain("native (QUIC gossip)");
      expect(text).toContain("Connected peers: 2");
      expect(text).toContain("10.0.0.1:19091 [connected]");
    });

    it("does not include P2P info in polled mode", async () => {
      mockState.p2pProbeFn.mockResolvedValue(null);

      const { tools } = await registerPlugin();
      const statusTool = tools.find((t) => t.name === "cortex_sync_status");
      const result = (await statusTool!.execute("tc1", {})) as { content: Array<{ text: string }> };
      const text = result.content[0].text;

      expect(text).toContain("Mode: polled");
      expect(text).not.toContain("Native P2P:");
    });
  });

  describe("cortex_sync_pair tool", () => {
    it("routes through P2P API in native mode", async () => {
      mockState.p2pProbeFn.mockResolvedValue({
        node_id: "abcdef1234567890abcdef1234567890",
        enabled: true,
        port: 19091,
        peer_count: 0,
        connected_peers: [],
        gossip_stats: {
          round: 0,
          pending_announcements: 0,
          known_ids: 0,
          bloom_filter_items: 0,
          bloom_filter_fpr: 0,
        },
        sync_stats: {
          peer_count: 0,
          local_ids: 0,
          total_successful_syncs: 0,
          total_failed_syncs: 0,
        },
      });

      const { tools } = await registerPlugin();
      const pairTool = tools.find((t) => t.name === "cortex_sync_pair");
      const result = (await pairTool!.execute("tc1", {
        nodeId: "new-peer",
        endpoint: "http://10.0.0.5:8080",
      })) as { content: Array<{ text: string }>; details: Record<string, unknown> };

      expect(mockState.p2pAddPeerFn).toHaveBeenCalledWith("10.0.0.5:19091");
      expect(result.content[0].text).toContain("P2P: connected");
      expect(result.details.syncMode).toBe("native");
    });

    it("does not call P2P API in polled mode", async () => {
      mockState.p2pProbeFn.mockResolvedValue(null);

      const { tools } = await registerPlugin();
      const pairTool = tools.find((t) => t.name === "cortex_sync_pair");
      await pairTool!.execute("tc1", {
        nodeId: "new-peer",
        endpoint: "http://10.0.0.5:8080",
      });

      expect(mockState.p2pAddPeerFn).not.toHaveBeenCalled();
    });

    it("handles P2P connection failure gracefully", async () => {
      mockState.p2pProbeFn.mockResolvedValue({
        node_id: "abcdef1234567890abcdef1234567890",
        enabled: true,
        port: 19091,
        peer_count: 0,
        connected_peers: [],
        gossip_stats: {
          round: 0,
          pending_announcements: 0,
          known_ids: 0,
          bloom_filter_items: 0,
          bloom_filter_fpr: 0,
        },
        sync_stats: {
          peer_count: 0,
          local_ids: 0,
          total_successful_syncs: 0,
          total_failed_syncs: 0,
        },
      });
      mockState.p2pAddPeerFn.mockRejectedValue(new Error("connection refused"));

      const { tools } = await registerPlugin();
      const pairTool = tools.find((t) => t.name === "cortex_sync_pair");
      const result = (await pairTool!.execute("tc1", {
        nodeId: "new-peer",
        endpoint: "http://10.0.0.5:8080",
      })) as { content: Array<{ text: string }> };

      expect(result.content[0].text).toContain("P2P: connection failed");
    });
  });

  describe("executePeerSync in native mode", () => {
    it("returns null (no-op) for sync in native mode", async () => {
      mockState.p2pProbeFn.mockResolvedValue({
        node_id: "abcdef1234567890abcdef1234567890",
        enabled: true,
        port: 19091,
        peer_count: 0,
        connected_peers: [],
        gossip_stats: {
          round: 0,
          pending_announcements: 0,
          known_ids: 0,
          bloom_filter_items: 0,
          bloom_filter_fpr: 0,
        },
        sync_stats: {
          peer_count: 0,
          local_ids: 0,
          total_successful_syncs: 0,
          total_failed_syncs: 0,
        },
      });

      const { tools } = await registerPlugin();
      const syncNowTool = tools.find((t) => t.name === "cortex_sync_now");
      const result = (await syncNowTool!.execute("tc1", { peerId: "peer1" })) as {
        content: Array<{ text: string }>;
      };

      // In native mode, executePeerSync returns null → "not found or unreachable"
      expect(result.content[0].text).toContain("not found or unreachable");
    });
  });

  describe("plugin structure", () => {
    it("registers all 3 tools", async () => {
      const { tools } = await registerPlugin();
      const toolNames = tools.map((t) => t.name);

      expect(toolNames).toContain("cortex_sync_status");
      expect(toolNames).toContain("cortex_sync_now");
      expect(toolNames).toContain("cortex_sync_pair");
    });

    it("registers hooks when autoSync is enabled", async () => {
      const { events } = await registerPlugin({ _autoSync: true });

      expect(events.agent_end).toBeDefined();
      expect(events.agent_end.length).toBe(1);
      expect(events.config_change).toBeDefined();
      expect(events.config_change.length).toBe(1);
    });

    it("does not register hooks when autoSync is disabled", async () => {
      const { events } = await registerPlugin({ _autoSync: false });

      expect(events.agent_end).toBeUndefined();
      expect(events.config_change).toBeUndefined();
    });
  });
});

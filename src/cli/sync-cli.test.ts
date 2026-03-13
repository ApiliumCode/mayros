/**
 * Tests for sync-cli P2P enhancements (B4).
 *
 * Validates that the CLI commands display P2P info when available
 * and fall back gracefully when not.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { P2pStatusResponse } from "../../extensions/shared/cortex-client.js";

// ---------- Mock state ----------

const mockState = vi.hoisted(() => ({
  healthyFn: vi.fn(async () => true),
  p2pProbeFn: vi.fn(async (): Promise<P2pStatusResponse | null> => null),
  p2pAddPeerFn: vi.fn(async (addr: string) => ({ status: "connected", addr })),
  peerManagerStatusFn: vi.fn(async () => ({
    totalPeers: 1,
    activePeers: 1,
    unreachablePeers: 0,
    totalSyncs: 5,
    totalTriplesSynced: 100,
  })),
  peerManagerListPeersFn: vi.fn(async () => [
    {
      nodeId: "peer1",
      endpoint: "http://10.0.0.1:8080",
      namespaces: ["mayros"],
      status: "active",
      lastSyncAt: "2026-01-01",
      totalSyncs: 5,
      totalTriplesSynced: 100,
    },
  ]),
  peerManagerGetPeerFn: vi.fn(async (nodeId: string) => {
    if (nodeId === "peer1") {
      return {
        nodeId: "peer1",
        endpoint: "http://10.0.0.1:8080",
        namespaces: ["mayros"],
        status: "active",
      };
    }
    return null;
  }),
  peerManagerAddPeerFn: vi.fn(
    async (opts: { nodeId: string; endpoint: string; namespaces: string[] }) => ({
      ...opts,
      status: "active",
    }),
  ),
  consoleLogs: [] as string[],
}));

// Mock CortexClient
vi.mock("../../extensions/shared/cortex-client.js", () => ({
  CortexClient: class MockCortexClient {
    async isHealthy() {
      return mockState.healthyFn();
    }
    async p2pProbe() {
      return mockState.p2pProbeFn();
    }
    async p2pAddPeer(addr: string) {
      return mockState.p2pAddPeerFn(addr);
    }
    destroy() {}
  },
}));

// Mock cortex-config
vi.mock("../../extensions/shared/cortex-config.js", () => ({
  parseCortexConfig: vi.fn((input: Record<string, unknown>) => ({
    host: input?.host ?? "127.0.0.1",
    port: input?.port ?? 8080,
  })),
}));

// Mock PeerManager
vi.mock("../../extensions/cortex-sync/peer-manager.js", () => ({
  PeerManager: class MockPeerManager {
    async status() {
      return mockState.peerManagerStatusFn();
    }
    async listPeers() {
      return mockState.peerManagerListPeersFn();
    }
    async getPeer(nodeId: string) {
      return mockState.peerManagerGetPeerFn(nodeId);
    }
    async addPeer(opts: { nodeId: string; endpoint: string; namespaces: string[] }) {
      return mockState.peerManagerAddPeerFn(opts);
    }
  },
}));

// Mock config
vi.mock("../config/config.js", () => ({
  loadConfig: vi.fn(() => ({
    plugins: { entries: {} },
  })),
}));

import { Command } from "commander";
import { registerSyncCli } from "./sync-cli.js";

// ---------- Helpers ----------

function createProgram(): Command {
  const program = new Command();
  program.exitOverride(); // Prevent process.exit calls
  registerSyncCli(program);
  return program;
}

function captureConsole() {
  mockState.consoleLogs = [];
  const spy = vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
    mockState.consoleLogs.push(args.map(String).join(" "));
  });
  return spy;
}

function makeP2pStatus(overrides: Partial<P2pStatusResponse> = {}): P2pStatusResponse {
  return {
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
    ...overrides,
  };
}

// ---------- Tests ----------

describe("sync-cli P2P enhancements (B4)", () => {
  let consoleSpy: ReturnType<typeof captureConsole>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockState.healthyFn.mockResolvedValue(true);
    mockState.p2pProbeFn.mockResolvedValue(null);
    mockState.consoleLogs = [];
    consoleSpy = captureConsole();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  describe("sync status", () => {
    it("shows Native P2P section when P2P is available", async () => {
      mockState.p2pProbeFn.mockResolvedValue(makeP2pStatus());

      const program = createProgram();
      await program.parseAsync(["node", "test", "sync", "status"]);

      const output = mockState.consoleLogs.join("\n");
      expect(output).toContain("Native P2P:");
      expect(output).toContain("Node ID: abcdef1234567890...");
      expect(output).toContain("Port: 19091");
      expect(output).toContain("native (QUIC gossip)");
      expect(output).toContain("Connected peers: 2");
      expect(output).toContain("10.0.0.1:19091 [connected]");
      expect(output).toContain("10.0.0.2:19091 [disconnected]");
      expect(output).toContain("Gossip: round 42, known 1500");
      expect(output).toContain("Sync: 800 local, 15 successful syncs");
    });

    it("does not show P2P section when P2P probe returns null", async () => {
      mockState.p2pProbeFn.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(["node", "test", "sync", "status"]);

      const output = mockState.consoleLogs.join("\n");
      expect(output).toContain("Cortex Sync Status:");
      expect(output).not.toContain("Native P2P:");
    });

    it("does not show P2P section when enabled=false", async () => {
      mockState.p2pProbeFn.mockResolvedValue(makeP2pStatus({ enabled: false }));

      const program = createProgram();
      await program.parseAsync(["node", "test", "sync", "status"]);

      const output = mockState.consoleLogs.join("\n");
      expect(output).not.toContain("Native P2P:");
    });
  });

  describe("sync pair", () => {
    it("calls p2pAddPeer when native P2P is active", async () => {
      mockState.p2pProbeFn.mockResolvedValue(makeP2pStatus());
      mockState.peerManagerGetPeerFn.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "sync",
        "pair",
        "new-peer",
        "http://10.0.0.5:8080",
      ]);

      expect(mockState.p2pAddPeerFn).toHaveBeenCalledWith("10.0.0.5:19091");
      const output = mockState.consoleLogs.join("\n");
      expect(output).toContain("P2P:");
    });

    it("does not call p2pAddPeer when P2P is not active", async () => {
      mockState.p2pProbeFn.mockResolvedValue(null);
      mockState.peerManagerGetPeerFn.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync([
        "node",
        "test",
        "sync",
        "pair",
        "new-peer",
        "http://10.0.0.5:8080",
      ]);

      expect(mockState.p2pAddPeerFn).not.toHaveBeenCalled();
    });
  });

  describe("sync now", () => {
    it("shows gossip info when native P2P is active", async () => {
      mockState.p2pProbeFn.mockResolvedValue(makeP2pStatus());

      const program = createProgram();
      await program.parseAsync(["node", "test", "sync", "now"]);

      const output = mockState.consoleLogs.join("\n");
      expect(output).toContain("Sync handled by native P2P gossip");
      expect(output).toContain("Gossip: round 42, known 1500");
      expect(output).toContain("Sync: 800 local, 15 successful syncs");
      expect(output).toContain("Connected P2P peers: 2");
    });

    it("falls back to polled sync when P2P is not available", async () => {
      mockState.p2pProbeFn.mockResolvedValue(null);

      const program = createProgram();
      await program.parseAsync(["node", "test", "sync", "now"]);

      const output = mockState.consoleLogs.join("\n");
      expect(output).not.toContain("Sync handled by native P2P gossip");
      expect(output).toContain("active peer");
    });
  });
});

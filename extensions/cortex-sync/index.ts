/**
 * Mayros Cortex Sync Plugin
 *
 * Cross-device knowledge synchronization via delta sync between Cortex instances.
 * Manages peer discovery, trust relationships, and conflict resolution.
 *
 * Tools:
 *   cortex_sync_status — Show peer sync status
 *   cortex_sync_now    — Force immediate sync with a peer
 *   cortex_sync_pair   — Pair with a new Cortex peer
 *
 * Hooks:
 *   agent_end     — Auto-sync on session end (if enabled)
 *   config_change — Auto-sync on config mutation (if enabled)
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { parseCortexSyncConfig, type CortexSyncConfig } from "./config.js";
import { PeerManager } from "./peer-manager.js";
import {
  buildLocalDelta,
  syncWithPeer,
  type SyncPeer,
  type SyncDelta,
  type SyncResult,
} from "./sync-protocol.js";

// ============================================================================
// Remote delta fetcher (HTTP-based)
// ============================================================================

async function fetchRemoteDelta(
  peer: SyncPeer,
  since: string,
  timeoutMs: number,
): Promise<SyncDelta> {
  const url = `${peer.endpoint}/api/v1/sync/delta`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        since,
        namespaces: peer.namespaces,
        nodeId: peer.nodeId,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    }

    const data = (await response.json()) as SyncDelta;
    return data;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Plugin Definition
// ============================================================================

const cortexSyncPlugin = {
  id: "cortex-sync",
  name: "Cortex Sync",
  description: "Cross-device knowledge synchronization via delta sync between Cortex instances",
  kind: "infrastructure" as const,

  async register(api: MayrosPluginApi) {
    const cfg = parseCortexSyncConfig(api.pluginConfig) as CortexSyncConfig;
    const client = new CortexClient(cfg.cortex);
    const ns = cfg.namespace;
    const peerManager = new PeerManager(client, ns);

    let cortexAvailable = false;

    api.logger.info(`cortex-sync: plugin registered (ns: ${ns})`);

    // Initialize peers from config
    void (async () => {
      try {
        const healthy = await client.isHealthy();
        cortexAvailable = healthy;
        if (healthy) {
          const added = await peerManager.initFromConfig(cfg.discovery.manualPeers);
          if (added > 0) {
            api.logger.info(`cortex-sync: initialized ${added} peer(s) from config`);
          }
        }
      } catch {
        api.logger.warn("cortex-sync: Cortex unavailable at startup");
      }
    })();

    // ========================================================================
    // Sync helper
    // ========================================================================

    async function syncPeer(nodeId: string): Promise<SyncResult | null> {
      if (!cortexAvailable) return null;

      const peer = await peerManager.getPeer(nodeId);
      if (!peer || peer.status === "removed") return null;

      const syncPeer = peerManager.toSyncPeer(peer);

      try {
        const result = await syncWithPeer(client, syncPeer, {
          conflictStrategy: cfg.sync.conflictStrategy,
          maxTriples: cfg.sync.maxTriplesPerSync,
          timeoutMs: cfg.sync.syncTimeoutMs,
          fetchRemoteDelta: (p, since) => fetchRemoteDelta(p, since, cfg.sync.syncTimeoutMs),
        });

        await peerManager.recordSyncResult(nodeId, result);
        return result;
      } catch (err) {
        await peerManager.markUnreachable(nodeId);
        api.logger.warn(`cortex-sync: sync failed for peer ${nodeId}: ${String(err)}`);
        return null;
      }
    }

    async function syncAllPeers(): Promise<SyncResult[]> {
      if (!cortexAvailable) return [];

      const peers = await peerManager.listPeers();
      const activePeers = peers.filter((p) => p.status === "active");
      const results: SyncResult[] = [];

      for (const peer of activePeers) {
        const result = await syncPeer(peer.nodeId);
        if (result) results.push(result);
      }

      return results;
    }

    // ========================================================================
    // Tool: cortex_sync_status
    // ========================================================================

    api.registerTool({
      name: "cortex_sync_status",
      description: "Show Cortex sync peer status and statistics",
      parameters: Type.Object({}),
      handler: async () => {
        if (!cortexAvailable) {
          return { content: "Cortex unavailable. Cannot query sync status." };
        }

        const status = await peerManager.status();
        const peers = await peerManager.listPeers();

        const lines = [
          `Cortex Sync Status:`,
          `  Total peers: ${status.totalPeers}`,
          `  Active: ${status.activePeers}`,
          `  Unreachable: ${status.unreachablePeers}`,
          `  Total syncs: ${status.totalSyncs}`,
          `  Total triples synced: ${status.totalTriplesSynced}`,
          "",
        ];

        if (peers.length > 0) {
          lines.push("Peers:");
          for (const peer of peers) {
            const lastSync = peer.lastSyncAt || "never";
            lines.push(
              `  ${peer.nodeId} [${peer.status}] → ${peer.endpoint}`,
              `    last sync: ${lastSync}`,
              `    namespaces: ${peer.namespaces.join(", ")}`,
              `    syncs: ${peer.totalSyncs}, triples: ${peer.totalTriplesSynced}`,
            );
          }
        }

        return { content: lines.join("\n") };
      },
    });

    // ========================================================================
    // Tool: cortex_sync_now
    // ========================================================================

    api.registerTool({
      name: "cortex_sync_now",
      description: "Force immediate sync with a specific peer or all peers",
      parameters: Type.Object({
        peerId: Type.Optional(Type.String({ description: "Peer node ID (omit for all)" })),
      }),
      handler: async (params) => {
        if (!cortexAvailable) {
          return { content: "Cortex unavailable. Cannot sync." };
        }

        if (params.peerId) {
          const result = await syncPeer(params.peerId);
          if (!result) {
            return { content: `Peer ${params.peerId} not found or unreachable.` };
          }
          return {
            content: [
              `Synced with ${params.peerId}:`,
              `  Triples received: ${result.triplesReceived}`,
              `  Triples applied: ${result.triplesApplied}`,
              `  Conflicts: ${result.conflicts.length}`,
              `  Duration: ${result.durationMs}ms`,
            ].join("\n"),
          };
        }

        const results = await syncAllPeers();
        if (results.length === 0) {
          return { content: "No active peers to sync with." };
        }

        const lines = [`Synced with ${results.length} peer(s):`];
        for (const r of results) {
          lines.push(
            `  ${r.peerId}: ${r.triplesApplied} applied, ${r.conflicts.length} conflicts (${r.durationMs}ms)`,
          );
        }

        return { content: lines.join("\n") };
      },
    });

    // ========================================================================
    // Tool: cortex_sync_pair
    // ========================================================================

    api.registerTool({
      name: "cortex_sync_pair",
      description: "Pair with a new Cortex peer for synchronization",
      parameters: Type.Object({
        nodeId: Type.String({ description: "Unique identifier for the peer" }),
        endpoint: Type.String({
          description: "Cortex HTTP endpoint (e.g. http://192.168.1.5:8080)",
        }),
        namespaces: Type.Optional(
          Type.Array(Type.String(), {
            description: "Namespaces to sync (default: current namespace)",
          }),
        ),
      }),
      handler: async (params) => {
        if (!cortexAvailable) {
          return { content: "Cortex unavailable. Cannot pair." };
        }

        const existing = await peerManager.getPeer(params.nodeId);
        if (existing && existing.status !== "removed") {
          return { content: `Peer ${params.nodeId} already exists (status: ${existing.status}).` };
        }

        const peer = await peerManager.addPeer({
          nodeId: params.nodeId,
          endpoint: params.endpoint,
          namespaces: params.namespaces ?? [ns],
          enabled: true,
        });

        return {
          content: [
            `Paired with peer ${peer.nodeId}:`,
            `  Endpoint: ${peer.endpoint}`,
            `  Namespaces: ${peer.namespaces.join(", ")}`,
            `  Status: ${peer.status}`,
            "",
            `Run 'mayros sync now' or use cortex_sync_now to trigger first sync.`,
          ].join("\n"),
        };
      },
    });

    // ========================================================================
    // Hooks: auto-sync on session end and config change
    // ========================================================================

    if (cfg.sync.autoSync) {
      api.registerHook("agent_end", {
        handler: async () => {
          if (!cortexAvailable) return;
          try {
            const results = await syncAllPeers();
            if (results.length > 0) {
              const total = results.reduce((s, r) => s + r.triplesApplied, 0);
              api.logger.info(`cortex-sync: auto-synced ${total} triples on session end`);
            }
          } catch (err) {
            api.logger.warn(`cortex-sync: auto-sync failed: ${String(err)}`);
          }
        },
      });

      api.registerHook("config_change", {
        handler: async () => {
          if (!cortexAvailable) return;
          try {
            await syncAllPeers();
          } catch {
            // Best-effort
          }
        },
      });
    }
  },
};

export default cortexSyncPlugin;

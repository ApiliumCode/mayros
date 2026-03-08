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
import { CortexClient, type P2pStatusResponse } from "../shared/cortex-client.js";
import { parseCortexSyncConfig, type CortexSyncConfig } from "./config.js";
import { PeerManager } from "./peer-manager.js";
import { syncWithPeer, type SyncPeer, type SyncDelta, type SyncResult } from "./sync-protocol.js";

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
    let syncMode: "native" | "polled" = "polled";
    let cachedP2pStatus: P2pStatusResponse | null = null;

    api.logger.info(`cortex-sync: plugin registered (ns: ${ns})`);

    async function checkCortex(): Promise<boolean> {
      try {
        cortexAvailable = await client.isHealthy();
      } catch {
        cortexAvailable = false;
      }
      return cortexAvailable;
    }

    /** B3: Probe native P2P availability. */
    async function probeP2p(): Promise<void> {
      if (!cfg.sync.nativeP2pPreferred) return;
      try {
        const status = await client.p2pProbe();
        if (status?.enabled) {
          syncMode = "native";
          cachedP2pStatus = status;
          api.logger.info(
            `cortex-sync: native P2P detected (node: ${status.node_id.slice(0, 16)}...)`,
          );
        }
      } catch {
        // P2P not available — stay in polled mode
      }
    }

    // Initialize peers from config + probe P2P
    void (async () => {
      try {
        const healthy = await checkCortex();
        if (healthy) {
          const added = await peerManager.initFromConfig(cfg.discovery.manualPeers);
          if (added > 0) {
            api.logger.info(`cortex-sync: initialized ${added} peer(s) from config`);
          }
          await probeP2p();
        }
      } catch {
        api.logger.warn("cortex-sync: Cortex unavailable at startup");
      }
    })();

    // ========================================================================
    // Sync helper
    // ========================================================================

    async function executePeerSync(nodeId: string): Promise<SyncResult | null> {
      if (!cortexAvailable && !(await checkCortex())) return null;

      // B3: Native P2P handles sync internally — skip REST polling
      if (syncMode === "native") {
        api.logger.info(`cortex-sync: sync handled by native P2P gossip (peer ${nodeId})`);
        return null;
      }

      const peer = await peerManager.getPeer(nodeId);
      if (!peer || peer.status === "removed") return null;

      const peerTarget = peerManager.toSyncPeer(peer);

      try {
        const result = await syncWithPeer(client, peerTarget, {
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
      if (!cortexAvailable && !(await checkCortex())) return [];

      const peers = await peerManager.listPeers();
      const activePeers = peers.filter((p) => p.status === "active");
      const results: SyncResult[] = [];

      for (const peer of activePeers) {
        const result = await executePeerSync(peer.nodeId);
        if (result) results.push(result);
      }

      return results;
    }

    // ========================================================================
    // Tool: cortex_sync_status
    // ========================================================================

    api.registerTool(
      {
        name: "cortex_sync_status",
        label: "Cortex Sync Status",
        description: "Show Cortex sync peer status and statistics",
        parameters: Type.Object({}),
        async execute() {
          if (!cortexAvailable && !(await checkCortex())) {
            return {
              content: [
                { type: "text" as const, text: "Cortex unavailable. Cannot query sync status." },
              ],
              details: {},
            };
          }

          const status = await peerManager.status();
          const peers = await peerManager.listPeers();

          const lines = [
            `Cortex Sync Status:`,
            `  Mode: ${syncMode}`,
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

          // B3: Include P2P native info when available
          if (syncMode === "native") {
            try {
              const p2p = await client.p2pStatus();
              cachedP2pStatus = p2p;
              lines.push(
                "Native P2P:",
                `  Node ID: ${p2p.node_id.slice(0, 16)}...`,
                `  Port: ${p2p.port}`,
                `  Mode: native (QUIC gossip)`,
                `  Connected peers: ${p2p.peer_count}`,
              );
              if (p2p.connected_peers.length > 0) {
                lines.push("  P2P Peers:");
                for (const pp of p2p.connected_peers) {
                  lines.push(`    ${pp.addr} [${pp.connected ? "connected" : "disconnected"}]`);
                }
              }
              lines.push(
                `  Gossip: round ${p2p.gossip_stats.round}, known ${p2p.gossip_stats.known_ids}`,
                `  Sync: ${p2p.sync_stats.local_ids} local, ${p2p.sync_stats.total_successful_syncs} successful syncs`,
              );
            } catch {
              lines.push("Native P2P: status unavailable");
            }
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: { totalPeers: status.totalPeers, syncMode },
          };
        },
      },
      { name: "cortex_sync_status" },
    );

    // ========================================================================
    // Tool: cortex_sync_now
    // ========================================================================

    api.registerTool(
      {
        name: "cortex_sync_now",
        label: "Cortex Sync Now",
        description: "Force immediate sync with a specific peer or all peers",
        parameters: Type.Object({
          peerId: Type.Optional(Type.String({ description: "Peer node ID (omit for all)" })),
        }),
        async execute(_toolCallId, params) {
          const { peerId } = params as { peerId?: string };

          if (!cortexAvailable && !(await checkCortex())) {
            return {
              content: [{ type: "text" as const, text: "Cortex unavailable. Cannot sync." }],
              details: {},
            };
          }

          if (peerId) {
            const result = await executePeerSync(peerId);
            if (!result) {
              return {
                content: [
                  { type: "text" as const, text: `Peer ${peerId} not found or unreachable.` },
                ],
                details: {},
              };
            }
            return {
              content: [
                {
                  type: "text" as const,
                  text: [
                    `Synced with ${peerId}:`,
                    `  Triples received: ${result.triplesReceived}`,
                    `  Triples applied: ${result.triplesApplied}`,
                    `  Conflicts: ${result.conflicts.length}`,
                    `  Duration: ${result.durationMs}ms`,
                  ].join("\n"),
                },
              ],
              details: { peerId, triplesApplied: result.triplesApplied },
            };
          }

          const results = await syncAllPeers();
          if (results.length === 0) {
            return {
              content: [{ type: "text" as const, text: "No active peers to sync with." }],
              details: {},
            };
          }

          const lines = [`Synced with ${results.length} peer(s):`];
          for (const r of results) {
            lines.push(
              `  ${r.peerId}: ${r.triplesApplied} applied, ${r.conflicts.length} conflicts (${r.durationMs}ms)`,
            );
          }

          return {
            content: [{ type: "text" as const, text: lines.join("\n") }],
            details: { peerCount: results.length },
          };
        },
      },
      { name: "cortex_sync_now" },
    );

    // ========================================================================
    // Tool: cortex_sync_pair
    // ========================================================================

    api.registerTool(
      {
        name: "cortex_sync_pair",
        label: "Cortex Sync Pair",
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
        async execute(_toolCallId, params) {
          const { nodeId, endpoint, namespaces } = params as {
            nodeId: string;
            endpoint: string;
            namespaces?: string[];
          };

          if (!nodeId || typeof nodeId !== "string" || !nodeId.trim()) {
            return {
              content: [{ type: "text" as const, text: "Error: nodeId is required." }],
              details: { error: "missing_nodeId" },
            };
          }

          if (!endpoint || typeof endpoint !== "string" || !/^https?:\/\/.+/.test(endpoint)) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Error: endpoint must be a valid http:// or https:// URL.",
                },
              ],
              details: { error: "invalid_endpoint" },
            };
          }

          if (!cortexAvailable && !(await checkCortex())) {
            return {
              content: [{ type: "text" as const, text: "Cortex unavailable. Cannot pair." }],
              details: {},
            };
          }

          const existing = await peerManager.getPeer(nodeId);
          if (existing && existing.status !== "removed") {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Peer ${nodeId} already exists (status: ${existing.status}).`,
                },
              ],
              details: { action: "skipped", reason: "already_exists" },
            };
          }

          const peer = await peerManager.addPeer({
            nodeId,
            endpoint,
            namespaces: namespaces ?? [ns],
            enabled: true,
          });

          // B3: Also add via P2P API when native mode is active
          let p2pResult: string | undefined;
          if (syncMode === "native") {
            try {
              // Extract host:port from endpoint URL for P2P connection
              const url = new URL(endpoint);
              const p2pAddr = `${url.hostname}:${cachedP2pStatus?.port ?? 19091}`;
              const res = await client.p2pAddPeer(p2pAddr);
              p2pResult = `P2P: ${res.status} (${res.addr})`;
            } catch {
              p2pResult = "P2P: connection failed (will retry via gossip)";
            }
          }

          const resultLines = [
            `Paired with peer ${peer.nodeId}:`,
            `  Endpoint: ${peer.endpoint}`,
            `  Namespaces: ${peer.namespaces.join(", ")}`,
            `  Status: ${peer.status}`,
          ];
          if (p2pResult) resultLines.push(`  ${p2pResult}`);
          resultLines.push(
            "",
            `Run 'mayros sync now' or use cortex_sync_now to trigger first sync.`,
          );

          return {
            content: [{ type: "text" as const, text: resultLines.join("\n") }],
            details: { action: "paired", nodeId: peer.nodeId, syncMode },
          };
        },
      },
      { name: "cortex_sync_pair" },
    );

    // ========================================================================
    // Hooks: auto-sync on session end and config change
    // ========================================================================

    if (cfg.sync.autoSync) {
      api.on("agent_end", async () => {
        if (!cortexAvailable) return;
        // B3: Skip polled sync in native mode — gossip handles it
        if (syncMode === "native") return;
        try {
          const results = await syncAllPeers();
          if (results.length > 0) {
            const total = results.reduce((s, r) => s + r.triplesApplied, 0);
            api.logger.info(`cortex-sync: auto-synced ${total} triples on session end`);
          }
        } catch (err) {
          api.logger.warn(`cortex-sync: auto-sync failed: ${String(err)}`);
        }
      });

      api.on("config_change", async () => {
        if (!cortexAvailable) return;
        // B3: Skip polled sync in native mode — gossip handles it
        if (syncMode === "native") return;
        try {
          await syncAllPeers();
        } catch {
          // Best-effort
        }
      });
    }
  },
};

export default cortexSyncPlugin;

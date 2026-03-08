/**
 * `mayros sync` — Cortex Sync CLI.
 *
 * Manage peer connections and cross-device synchronization.
 *
 * Subcommands:
 *   status                     — Show sync peers and statistics
 *   pair <nodeId> <endpoint>   — Add a new sync peer
 *   remove <nodeId>            — Remove a sync peer
 *   now [--peer <nodeId>]      — Force immediate sync
 */

import type { Command } from "commander";
import { parseCortexConfig } from "../../extensions/shared/cortex-config.js";
import { CortexClient, type P2pStatusResponse } from "../../extensions/shared/cortex-client.js";
import { PeerManager } from "../../extensions/cortex-sync/peer-manager.js";
import { loadConfig } from "../config/config.js";

// ============================================================================
// Cortex resolution
// ============================================================================

function resolveCortexClient(opts: { host?: string; port?: string; token?: string }): CortexClient {
  const host = opts.host ?? process.env.CORTEX_HOST ?? "127.0.0.1";
  const port = opts.port
    ? Number.parseInt(opts.port, 10)
    : process.env.CORTEX_PORT
      ? Number.parseInt(process.env.CORTEX_PORT, 10)
      : 8080;
  const authToken = opts.token ?? process.env.CORTEX_AUTH_TOKEN ?? undefined;

  if (!opts.host && !opts.port && !process.env.CORTEX_HOST && !process.env.CORTEX_PORT) {
    try {
      const cfg = loadConfig();
      const pluginCfg = cfg.plugins?.entries?.["cortex-sync"]?.config as
        | { cortex?: { host?: string; port?: number; authToken?: string } }
        | undefined;
      if (pluginCfg?.cortex) {
        const cortex = parseCortexConfig(pluginCfg.cortex);
        return new CortexClient(cortex);
      }
    } catch {
      // Config not available
    }
  }

  try {
    return new CortexClient(parseCortexConfig({ host, port, authToken }));
  } catch {
    return new CortexClient(parseCortexConfig({}));
  }
}

function resolveNamespace(): string {
  try {
    const cfg = loadConfig();
    const pluginCfg = cfg.plugins?.entries?.["cortex-sync"]?.config as
      | { namespace?: string }
      | undefined;
    return pluginCfg?.namespace ?? "mayros";
  } catch {
    return "mayros";
  }
}

async function probeP2pStatus(client: CortexClient): Promise<P2pStatusResponse | null> {
  try {
    return await client.p2pProbe();
  } catch {
    return null;
  }
}

// ============================================================================
// Registration
// ============================================================================

export function registerSyncCli(program: Command) {
  const sync = program
    .command("sync")
    .description("Cortex sync — peer management and cross-device synchronization")
    .option("--cortex-host <host>", "Cortex host")
    .option("--cortex-port <port>", "Cortex port")
    .option("--cortex-token <token>", "Cortex auth token");

  // ---- status ----

  sync
    .command("status")
    .description("Show sync peers and statistics")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot query sync status.");
        return;
      }

      const pm = new PeerManager(client, ns);
      const status = await pm.status();
      const peers = await pm.listPeers();

      if (opts.format === "json") {
        console.log(JSON.stringify({ status, peers }, null, 2));
        return;
      }

      console.log("Cortex Sync Status:");
      console.log(`  Total peers: ${status.totalPeers}`);
      console.log(`  Active: ${status.activePeers}`);
      console.log(`  Unreachable: ${status.unreachablePeers}`);
      console.log(`  Total syncs: ${status.totalSyncs}`);
      console.log(`  Total triples synced: ${status.totalTriplesSynced}`);

      if (peers.length > 0) {
        console.log("\nPeers:");
        for (const peer of peers) {
          const lastSync = peer.lastSyncAt || "never";
          console.log(`  ${peer.nodeId} [${peer.status}]`);
          console.log(`    endpoint: ${peer.endpoint}`);
          console.log(`    namespaces: ${peer.namespaces.join(", ")}`);
          console.log(`    last sync: ${lastSync}`);
          console.log(`    syncs: ${peer.totalSyncs}, triples: ${peer.totalTriplesSynced}`);
        }
      }

      // B4: Show native P2P info if available
      const p2p = await probeP2pStatus(client);
      if (p2p?.enabled) {
        console.log("\nNative P2P:");
        console.log(`  Node ID: ${p2p.node_id.slice(0, 16)}...`);
        console.log(`  Port: ${p2p.port}`);
        console.log(`  Mode: native (QUIC gossip)`);
        console.log(`  Connected peers: ${p2p.peer_count}`);
        if (p2p.connected_peers.length > 0) {
          console.log("  P2P Peers:");
          for (const pp of p2p.connected_peers) {
            console.log(`    ${pp.addr} [${pp.connected ? "connected" : "disconnected"}]`);
          }
        }
        console.log(
          `  Gossip: round ${p2p.gossip_stats.round}, known ${p2p.gossip_stats.known_ids}`,
        );
        console.log(
          `  Sync: ${p2p.sync_stats.local_ids} local, ${p2p.sync_stats.total_successful_syncs} successful syncs`,
        );
      }
    });

  // ---- pair ----

  sync
    .command("pair")
    .description("Add a new sync peer")
    .argument("<nodeId>", "Unique peer identifier")
    .argument("<endpoint>", "Cortex HTTP endpoint (e.g. http://192.168.1.5:8080)")
    .option("--namespaces <ns...>", "Namespaces to sync")
    .action(async (nodeId, endpoint, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot pair.");
        return;
      }

      const pm = new PeerManager(client, ns);
      const existing = await pm.getPeer(nodeId);
      if (existing && existing.status !== "removed") {
        console.log(`Peer ${nodeId} already exists (status: ${existing.status}).`);
        return;
      }

      const peer = await pm.addPeer({
        nodeId,
        endpoint,
        namespaces: opts.namespaces ?? [ns],
        enabled: true,
      });

      console.log(`Paired with peer ${peer.nodeId}:`);
      console.log(`  Endpoint: ${peer.endpoint}`);
      console.log(`  Namespaces: ${peer.namespaces.join(", ")}`);
      console.log(`  Status: ${peer.status}`);

      // B4: Also connect via P2P API when native is active
      const p2p = await probeP2pStatus(client);
      if (p2p?.enabled) {
        try {
          const url = new URL(endpoint);
          const p2pAddr = `${url.hostname}:${p2p.port}`;
          const res = await client.p2pAddPeer(p2pAddr);
          console.log(`  P2P: ${res.status} (${res.addr})`);
        } catch {
          console.log("  P2P: connection failed (will retry via gossip)");
        }
      }
    });

  // ---- remove ----

  sync
    .command("remove")
    .description("Remove a sync peer")
    .argument("<nodeId>", "Peer node ID")
    .action(async (nodeId, _opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot remove peer.");
        return;
      }

      const pm = new PeerManager(client, ns);
      const ok = await pm.removePeer(nodeId);

      if (!ok) {
        console.log(`Peer ${nodeId} not found.`);
        return;
      }

      console.log(`Peer ${nodeId} removed.`);
    });

  // ---- now ----

  sync
    .command("now")
    .description("Force immediate sync")
    .option("--peer <nodeId>", "Sync with a specific peer (omit for all)")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot sync.");
        return;
      }

      const pm = new PeerManager(client, ns);

      // B4: Check for native P2P mode
      const p2p = await probeP2pStatus(client);

      if (p2p?.enabled) {
        console.log("Sync handled by native P2P gossip.");
        console.log(
          `  Gossip: round ${p2p.gossip_stats.round}, known ${p2p.gossip_stats.known_ids}`,
        );
        console.log(
          `  Sync: ${p2p.sync_stats.local_ids} local, ${p2p.sync_stats.total_successful_syncs} successful syncs`,
        );
        console.log(`  Connected P2P peers: ${p2p.peer_count}`);
        return;
      }

      if (opts.peer) {
        const peer = await pm.getPeer(opts.peer);
        if (!peer) {
          console.log(`Peer ${opts.peer} not found.`);
          return;
        }
        console.log(`Triggering sync with ${opts.peer}...`);
        console.log("Note: Full sync requires the cortex-sync plugin running in the gateway.");
        console.log(`Peer status: ${peer.status}`);
      } else {
        const peers = await pm.listPeers();
        const active = peers.filter((p) => p.status === "active");
        console.log(`Found ${active.length} active peer(s).`);
        console.log("Note: Full sync requires the cortex-sync plugin running in the gateway.");
        for (const p of active) {
          console.log(`  ${p.nodeId} → ${p.endpoint}`);
        }
      }
    });
}

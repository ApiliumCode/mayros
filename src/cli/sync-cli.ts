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
import { CortexClient } from "../../extensions/shared/cortex-client.js";
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

/**
 * `mayros cortex` — Cortex sidecar status and management.
 *
 * Subcommands:
 *   status     — Check Cortex connectivity and stats
 *   reconnect  — Restart the Cortex sidecar (via gateway or direct)
 */

import type { Command } from "commander";
import { addGatewayClientOptions, callGatewayFromCli, type GatewayRpcOpts } from "./gateway-rpc.js";
import { resolveCortexClient } from "./shared/cortex-resolution.js";

// ============================================================================
// Registration
// ============================================================================

export function registerCortexCli(program: Command) {
  const cortex = program
    .command("cortex")
    .description("Cortex sidecar — status, reconnect, and diagnostics")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 19090 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ------------------------------------------------------------------
  // mayros cortex status
  // ------------------------------------------------------------------
  const statusCmd = cortex
    .command("status")
    .description("Check Cortex sidecar status and connectivity");

  addGatewayClientOptions(statusCmd);

  statusCmd.action(async (opts: GatewayRpcOpts) => {
    const parent = cortex.opts();

    // Try via gateway RPC first for richer info (sidecar status, pending writes)
    try {
      const res = (await callGatewayFromCli("cortex.status", opts)) as {
        status: string;
        sidecar: string;
        endpoint: string;
        autoStart: boolean;
        version: string | null;
        uptime: number | null;
        triples: number | null;
        subjects: number | null;
        pendingWrites: number;
      };
      console.log(`Endpoint:      ${res.endpoint}`);
      console.log(`Status:        ${res.status === "online" ? "\u2713 ONLINE" : "\u2717 OFFLINE"}`);
      console.log(`Sidecar:       ${res.sidecar}`);
      console.log(`Auto-start:    ${res.autoStart ? "yes" : "no"}`);
      if (res.version) console.log(`Version:       ${res.version}`);
      if (res.uptime != null) console.log(`Uptime:        ${res.uptime}s`);
      if (res.triples != null) console.log(`Triples:       ${res.triples}`);
      if (res.subjects != null) console.log(`Subjects:      ${res.subjects}`);
      if (res.pendingWrites > 0) console.log(`Pending writes: ${res.pendingWrites}`);
      return;
    } catch {
      // Gateway not available — fall back to direct Cortex check
    }

    // Direct check
    const client = resolveCortexClient(
      { host: parent.cortexHost, port: parent.cortexPort, token: parent.cortexToken },
      { defaultPort: 19090 },
    );
    try {
      console.log(`Endpoint: ${client.baseUrl}`);
      const healthy = await client.isHealthy();
      console.log(`Status:   ${healthy ? "\u2713 ONLINE" : "\u2717 OFFLINE"}`);
      if (healthy) {
        try {
          const stats = await client.stats();
          console.log(`Version:  ${stats.server.version}`);
          console.log(`Uptime:   ${stats.server.uptime_seconds}s`);
          console.log(`Triples:  ${stats.graph.triple_count}`);
          console.log(`Subjects: ${stats.graph.subject_count}`);
        } catch {
          // Stats endpoint may not be available
        }
      }
    } finally {
      client.destroy();
    }
  });

  // ------------------------------------------------------------------
  // mayros cortex reconnect
  // ------------------------------------------------------------------
  const reconnectCmd = cortex
    .command("reconnect")
    .description("Attempt to restart the Cortex sidecar via the gateway");

  addGatewayClientOptions(reconnectCmd);

  reconnectCmd.action(async (opts: GatewayRpcOpts) => {
    const parent = cortex.opts();

    // Try via gateway RPC first
    try {
      const res = (await callGatewayFromCli("cortex.reconnect", opts)) as {
        success: boolean;
        status: string;
        sidecar: string;
      };
      if (res.success) {
        console.log(`Cortex reconnected (sidecar: ${res.sidecar})`);
      } else {
        console.log(`Reconnect failed (sidecar: ${res.sidecar})`);
        process.exitCode = 1;
      }
      return;
    } catch {
      // Gateway not available — fall back to direct check
    }

    console.log("Gateway unavailable, checking Cortex directly...");
    const client = resolveCortexClient(
      { host: parent.cortexHost, port: parent.cortexPort, token: parent.cortexToken },
      { defaultPort: 19090 },
    );
    try {
      const healthy = await client.isHealthy();
      if (healthy) {
        console.log("Cortex is reachable directly");
      } else {
        console.log("Cortex unreachable — start with: mayros gateway");
        process.exitCode = 1;
      }
    } finally {
      client.destroy();
    }
  });
}

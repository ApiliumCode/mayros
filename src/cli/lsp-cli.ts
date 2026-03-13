/**
 * `mayros lsp` — LSP Bridge CLI (standalone).
 *
 * Provides basic LSP server management without the full plugin loaded.
 * The plugin's api.registerCli() provides the full feature set;
 * this standalone CLI covers start/stop/status for use outside sessions.
 *
 * Subcommands:
 *   start        — Start LSP server(s)
 *   stop         — Stop LSP server(s)
 *   status       — Show running servers
 *   diagnostics  — Show diagnostics from Cortex
 */

import type { Command } from "commander";
import { LspCortexBackend } from "../../extensions/lsp-bridge/lsp-cortex-backend.js";
import { severityLabel } from "../../extensions/lsp-bridge/lsp-protocol.js";
import { resolveCortexClient, resolveNamespace } from "./shared/cortex-resolution.js";

// ============================================================================
// Registration
// ============================================================================

export function registerLspCli(program: Command) {
  const lsp = program
    .command("lsp")
    .description("LSP bridge — query Cortex-stored language diagnostics and definitions")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 19090 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ---- diagnostics ----

  lsp
    .command("diagnostics")
    .description("Show diagnostics stored in Cortex")
    .option("--file <f>", "Filter by file path or URI")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "lsp-bridge" },
      );
      const ns = resolveNamespace("lsp-bridge");

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot retrieve diagnostics.");
        client.destroy();
        return;
      }

      const backend = new LspCortexBackend(client, ns);
      const uri = opts.file?.startsWith("file://")
        ? opts.file
        : opts.file
          ? `file://${opts.file}`
          : undefined;

      try {
        const diagnostics = await backend.getDiagnostics(uri);

        if (opts.format === "json") {
          console.log(JSON.stringify(diagnostics, null, 2));
          client.destroy();
          return;
        }

        if (diagnostics.length === 0) {
          console.log("No diagnostics found.");
          client.destroy();
          return;
        }

        console.log(`Diagnostics (${diagnostics.length}):`);
        for (const d of diagnostics) {
          const sev = severityLabel(d.diagnostic.severity);
          console.log(
            `  ${d.uri}:${d.diagnostic.range.start.line}  [${sev}]  ${d.diagnostic.message}`,
          );
        }
      } catch (err) {
        console.log(`Error: ${String(err)}`);
      }

      client.destroy();
    });

  // ---- status ----

  lsp
    .command("status")
    .description("Show LSP bridge status (Cortex connectivity)")
    .action(async (_opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "lsp-bridge" },
      );

      const healthy = await client.isHealthy();
      console.log(`Cortex: ${healthy ? "connected" : "offline"}`);
      console.log("Note: LSP servers are managed by the lsp-bridge plugin during sessions.");

      client.destroy();
    });

  // ---- start / stop ----

  lsp
    .command("start")
    .description("Start LSP servers (requires active session with lsp-bridge plugin)")
    .action(() => {
      console.log(
        "LSP servers are managed by the lsp-bridge plugin during sessions.\n" +
          "Configure servers in the lsp-bridge plugin config and start a session.",
      );
    });

  lsp
    .command("stop")
    .description("Stop LSP servers (requires active session with lsp-bridge plugin)")
    .action(() => {
      console.log(
        "LSP servers are managed by the lsp-bridge plugin during sessions.\n" +
          "They are automatically stopped when the session ends.",
      );
    });
}

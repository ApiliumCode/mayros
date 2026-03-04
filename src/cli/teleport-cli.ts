/**
 * `mayros teleport` — Session teleport CLI.
 *
 * Export and import complete sessions between devices.
 *
 * Subcommands:
 *   export [--session <key>] [--output <file>] [--project-memory]
 *   import <file> [--remap <newKey>]
 *   inspect <file>
 */

import type { Command } from "commander";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import process from "node:process";
import { parseCortexConfig } from "../../extensions/shared/cortex-config.js";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import { loadConfig } from "../config/config.js";
import {
  exportSession,
  importSession,
  validateBundle,
  type TeleportBundle,
} from "../commands/teleport.js";

// ============================================================================
// Cortex resolution
// ============================================================================

function resolveCortexClient(opts: {
  host?: string;
  port?: string;
  token?: string;
}): CortexClient | undefined {
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
      const pluginCfg = cfg.plugins?.entries?.["memory-semantic"]?.config as
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
    return undefined;
  }
}

function resolveNamespace(): string {
  try {
    const cfg = loadConfig();
    const pluginCfg = cfg.plugins?.entries?.["memory-semantic"]?.config as
      | { namespace?: string }
      | undefined;
    return pluginCfg?.namespace ?? "mayros";
  } catch {
    return "mayros";
  }
}

function resolveSessionPaths(sessionKey: string): {
  transcriptPath: string;
  storePath: string;
  sessionsDir: string;
} {
  const stateDir = process.env.MAYROS_STATE_DIR ?? resolve(process.env.HOME ?? "~", ".mayros");
  const agentId = process.env.MAYROS_AGENT_ID ?? "default";
  const sessionsDir = resolve(stateDir, "agents", agentId, "sessions");
  return {
    transcriptPath: resolve(sessionsDir, `${sessionKey}.jsonl`),
    storePath: resolve(sessionsDir, "sessions.json"),
    sessionsDir,
  };
}

// ============================================================================
// Registration
// ============================================================================

export function registerTeleportCli(program: Command) {
  const teleport = program
    .command("teleport")
    .description("Session teleport — export/import sessions between devices")
    .option("--cortex-host <host>", "Cortex host")
    .option("--cortex-port <port>", "Cortex port")
    .option("--cortex-token <token>", "Cortex auth token");

  // ---- export ----

  teleport
    .command("export")
    .description("Export a session as a portable bundle")
    .option("-s, --session <key>", "Session key to export")
    .option("-o, --output <file>", "Output file (default: teleport-<session>.json)")
    .option("--project-memory", "Include project memory triples", false)
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();

      const sessionKey = opts.session;
      if (!sessionKey) {
        console.error("Error: --session <key> is required.");
        console.error("Hint: use 'mayros sessions list' to find session keys.");
        process.exitCode = 1;
        return;
      }

      const paths = resolveSessionPaths(sessionKey);
      const cortexClient = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      console.log(`Exporting session: ${sessionKey}`);

      const result = await exportSession({
        sessionKey,
        transcriptPath: paths.transcriptPath,
        storePath: paths.storePath,
        cortexClient,
        namespace: ns,
        includeProjectMemory: opts.projectMemory,
      });

      const outputFile = opts.output ?? `teleport-${sessionKey}.json`;
      writeFileSync(outputFile, JSON.stringify(result.bundle, null, 2), "utf-8");

      console.log(`Exported to: ${outputFile}`);
      console.log(`  transcript: ${result.transcriptSize} bytes`);
      console.log(`  cortex triples: ${result.tripleCount}`);
      console.log(`  device: ${result.bundle.sourceDeviceId}`);
    });

  // ---- import ----

  teleport
    .command("import")
    .description("Import a session from a teleport bundle")
    .argument("<file>", "Teleport bundle file to import")
    .option("--remap <key>", "Remap to a different session key")
    .action(async (file, opts, cmd) => {
      const parentOpts = cmd.parent.opts();

      if (!existsSync(file)) {
        console.error(`Error: file not found: ${file}`);
        process.exitCode = 1;
        return;
      }

      let data: unknown;
      try {
        data = JSON.parse(readFileSync(file, "utf-8"));
      } catch {
        console.error("Error: invalid JSON file.");
        process.exitCode = 1;
        return;
      }

      if (!validateBundle(data)) {
        console.error("Error: invalid teleport bundle structure.");
        process.exitCode = 1;
        return;
      }

      const bundle = data as TeleportBundle;
      const paths = resolveSessionPaths(opts.remap ?? bundle.sessionKey);
      const cortexClient = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      console.log(`Importing session from: ${file}`);
      console.log(`  source device: ${bundle.sourceDeviceId}`);
      console.log(`  exported at: ${bundle.exportedAt}`);

      const result = await importSession({
        bundle,
        targetTranscriptDir: paths.sessionsDir,
        targetStorePath: paths.storePath,
        cortexClient,
        namespace: ns,
        remapSessionKey: opts.remap,
      });

      console.log(`\nImported successfully:`);
      console.log(`  session key: ${result.sessionKey}`);
      console.log(`  transcript: ${result.transcriptPath}`);
      console.log(`  cortex triples: ${result.triplesImported}`);
      if (result.remapped) {
        console.log(`  remapped from: ${bundle.sessionKey}`);
      }
    });

  // ---- inspect ----

  teleport
    .command("inspect")
    .description("Inspect a teleport bundle without importing")
    .argument("<file>", "Teleport bundle file")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action((file, opts) => {
      if (!existsSync(file)) {
        console.error(`Error: file not found: ${file}`);
        process.exitCode = 1;
        return;
      }

      let data: unknown;
      try {
        data = JSON.parse(readFileSync(file, "utf-8"));
      } catch {
        console.error("Error: invalid JSON file.");
        process.exitCode = 1;
        return;
      }

      if (!validateBundle(data)) {
        console.error("Error: invalid teleport bundle.");
        process.exitCode = 1;
        return;
      }

      const bundle = data as TeleportBundle;

      if (opts.format === "json") {
        console.log(
          JSON.stringify(
            {
              version: bundle.version,
              exportedAt: bundle.exportedAt,
              sourceDeviceId: bundle.sourceDeviceId,
              sessionKey: bundle.sessionKey,
              transcriptBytes: bundle.transcript
                ? Buffer.from(bundle.transcript, "base64").length
                : 0,
              sessionStoreKeys: Object.keys(bundle.sessionStore),
              cortexTripleCount: bundle.cortexTriples.length,
              projectMemoryTripleCount: bundle.projectMemory?.length ?? 0,
            },
            null,
            2,
          ),
        );
        return;
      }

      const transcriptBytes = bundle.transcript
        ? Buffer.from(bundle.transcript, "base64").length
        : 0;

      console.log(`Teleport bundle: ${file}`);
      console.log(`  version: ${bundle.version}`);
      console.log(`  exported at: ${bundle.exportedAt}`);
      console.log(`  source device: ${bundle.sourceDeviceId}`);
      console.log(`  session key: ${bundle.sessionKey}`);
      console.log(`  transcript: ${transcriptBytes} bytes`);
      console.log(`  store fields: ${Object.keys(bundle.sessionStore).length}`);
      console.log(`  cortex triples: ${bundle.cortexTriples.length}`);
      if (bundle.projectMemory) {
        console.log(`  project memory: ${bundle.projectMemory.length} triples`);
      }
    });
}

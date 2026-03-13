/**
 * `mayros session` — Session Fork/Rewind CLI.
 *
 * Session state management backed by AIngle Cortex.
 *
 * Subcommands:
 *   checkpoint [--session <key>]                — Create checkpoint
 *   fork [--session <key>] [--name <newKey>]    — Fork current session
 *   rewind --to <timestamp> [--session <key>]   — Rewind to timestamp
 *   forks [--session <key>]                     — List fork history
 */

import type { Command } from "commander";
import { TraceEmitter } from "../../extensions/semantic-observability/trace-emitter.js";
import { SessionForkManager } from "../../extensions/semantic-observability/session-fork.js";
import { resolveCortexClient, resolveNamespace } from "./shared/cortex-resolution.js";

// ============================================================================
// Registration
// ============================================================================

export function registerSessionCli(program: Command) {
  const session = program
    .command("session")
    .description("Session fork/rewind — checkpoint, fork, and rewind agent sessions")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ---- checkpoint ----

  session
    .command("checkpoint")
    .description("Create a checkpoint of the current session state")
    .option("--session <key>", "Session key (defaults to current session)", "default")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot create checkpoint.");
          return;
        }

        const emitter = new TraceEmitter(client, ns, 5000);
        const mgr = new SessionForkManager(client, emitter, ns);

        const cp = await mgr.checkpoint(opts.session);

        if (opts.format === "json") {
          console.log(JSON.stringify(cp, null, 2));
          return;
        }

        console.log(`Checkpoint created:`);
        console.log(`  session: ${cp.sessionKey}`);
        console.log(`  timestamp: ${cp.timestamp}`);
        console.log(`  events: ${cp.eventCount}`);
        if (cp.lastEventId) {
          console.log(`  lastEvent: ${cp.lastEventId}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- fork ----

  session
    .command("fork")
    .description("Fork the current session into a new session")
    .option("--session <key>", "Source session key", "default")
    .option("--name <newKey>", "Name for the forked session")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot fork session.");
          return;
        }

        const emitter = new TraceEmitter(client, ns, 5000);
        const mgr = new SessionForkManager(client, emitter, ns);

        const result = await mgr.fork(opts.session, opts.name);

        if (opts.format === "json") {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Session forked:`);
        console.log(`  original: ${result.originalSession}`);
        console.log(`  forked: ${result.forkedSession}`);
        console.log(`  forkedAt: ${result.forkedAt}`);
        console.log(`  events copied: ${result.eventsCopied}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- rewind ----

  session
    .command("rewind")
    .description("Rewind a session to a specific timestamp")
    .requiredOption("--to <timestamp>", "ISO 8601 timestamp to rewind to")
    .option("--session <key>", "Session key", "default")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot rewind session.");
          return;
        }

        const emitter = new TraceEmitter(client, ns, 5000);
        const mgr = new SessionForkManager(client, emitter, ns);

        const result = await mgr.rewind(opts.session, opts.to);

        if (opts.format === "json") {
          console.log(JSON.stringify(result, null, 2));
          return;
        }

        console.log(`Session rewound:`);
        console.log(`  session: ${result.sessionKey}`);
        console.log(`  rewindPoint: ${result.rewindPoint}`);
        console.log(`  events removed: ${result.eventsRemoved}`);
        console.log(`  events retained: ${result.eventsRetained}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- forks ----

  session
    .command("forks")
    .description("List fork/rewind history")
    .option("--session <key>", "Filter by session key")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot list forks.");
          return;
        }

        const emitter = new TraceEmitter(client, ns, 5000);
        const mgr = new SessionForkManager(client, emitter, ns);

        const forks = await mgr.listForks(opts.session);

        if (opts.format === "json") {
          console.log(JSON.stringify(forks, null, 2));
          return;
        }

        if (forks.length === 0) {
          console.log("No fork/rewind history found.");
          return;
        }

        console.log(`Session history (${forks.length} entries):`);
        for (const f of forks) {
          const parent = f.parentSession ? ` (parent: ${f.parentSession})` : "";
          const forkTime = f.forkedAt ? ` forked: ${f.forkedAt}` : "";
          const cpCount = f.checkpoints.length > 0 ? ` checkpoints: ${f.checkpoints.length}` : "";
          console.log(`  ${f.sessionKey} [${f.status}]${parent}${forkTime}${cpCount}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });
}

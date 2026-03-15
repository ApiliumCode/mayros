/**
 * `mayros dag` — Semantic DAG CLI.
 *
 * Provides access to the DAG audit trail, time-travel, history,
 * diff, export, stats, verification, and pruning.
 *
 * Subcommands:
 *   tips     — Show current DAG tips
 *   history  — Action history for a subject
 *   stats    — DAG statistics
 *   export   — Export DAG as DOT, Mermaid, or JSON
 *   diff     — Diff between two action hashes
 *   at       — Time-travel to a specific action
 *   verify   — Verify Ed25519 signature of an action
 *   prune    — Prune old DAG actions
 */

import { createInterface } from "node:readline";
import type { Command } from "commander";
import { resolveCortexClient, CortexError } from "./shared/cortex-resolution.js";

/** Prompt the user for confirmation on destructive operations. */
async function confirmAction(message: string): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(`${message} [y/N] `, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase() === "y");
    });
  });
}

/** Print a user-friendly error and set exit code. */
function handleError(err: unknown): void {
  if (err instanceof CortexError) {
    if (err.code === "CONNECTION_ERROR") {
      console.error(
        "Cortex is not running. Start it with `mayros cortex start` or check --cortex-host/--cortex-port.",
      );
    } else {
      console.error(`Cortex error (${err.status}): ${err.message}`);
    }
  } else {
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
  }
  process.exitCode = 1;
}

// ============================================================================
// Registration
// ============================================================================

export function registerDagCli(program: Command) {
  const dag = program
    .command("dag")
    .description("Semantic DAG — audit, time-travel, and history")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 19090 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ------------------------------------------------------------------
  // mayros dag tips
  // ------------------------------------------------------------------
  dag
    .command("tips")
    .description("Show current DAG tip hashes (frontier of the DAG)")
    .action(async () => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const data = await client.dagTips();
        console.log(`DAG Tips (${data.count}):\n`);
        for (const tip of data.tips) {
          console.log(`  ${tip}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag action <hash>
  // ------------------------------------------------------------------
  dag
    .command("action")
    .description("Show details of a specific DAG action by hash")
    .argument("<hash>", "DAG action hash")
    .action(async (hash: string) => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const a = await client.dagAction(hash);
        console.log(`Action ${a.hash}:`);
        console.log(`  author: ${a.author}`);
        console.log(`  seq: ${a.seq}`);
        console.log(`  timestamp: ${a.timestamp}`);
        console.log(`  type: ${a.payload_type}`);
        console.log(`  summary: ${a.payload_summary}`);
        console.log(`  parents: ${a.parents.length === 0 ? "(genesis)" : a.parents.join(", ")}`);
        console.log(`  signed: ${a.signed}${a.signature ? ` (${a.signature.slice(0, 16)}…)` : ""}`);
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag history <subject>
  // ------------------------------------------------------------------
  dag
    .command("history")
    .description("Show DAG action history for a subject")
    .argument("<subject>", "Subject to query history for")
    .option("--limit <n>", "Max actions to return", "20")
    .action(async (subject: string, opts: { limit?: string }) => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const limit = parseInt(opts.limit ?? "20", 10);
        const data = await client.dagHistory({ subject, limit });

        if (!data.actions || data.actions.length === 0) {
          console.log(`No DAG history for subject "${subject}".`);
          return;
        }

        console.log(`History for "${subject}" (${data.actions.length} actions):\n`);
        for (const a of data.actions) {
          console.log(`  #${a.seq} [${a.payload_type}] ${a.payload_summary}`);
          console.log(`    hash: ${a.hash}  author: ${a.author}  time: ${a.timestamp}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag chain <author>
  // ------------------------------------------------------------------
  dag
    .command("chain")
    .description("Show the DAG action chain for a specific author/node")
    .argument("<author>", "Author node ID")
    .option("--limit <n>", "Max actions to return", "20")
    .action(async (author: string, opts: { limit?: string }) => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const limit = parseInt(opts.limit ?? "20", 10);
        const data = await client.dagChain(author, limit);

        if (!data.actions || data.actions.length === 0) {
          console.log(`No DAG actions for author "${author}".`);
          return;
        }

        console.log(`Chain for "${author}" (${data.actions.length} actions):\n`);
        for (const a of data.actions) {
          console.log(`  #${a.seq} [${a.payload_type}] ${a.payload_summary}`);
          console.log(`    hash: ${a.hash}  time: ${a.timestamp}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag stats
  // ------------------------------------------------------------------
  dag
    .command("stats")
    .description("Show DAG statistics")
    .action(async () => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const data = await client.dagStats();
        console.log("DAG Statistics:");
        console.log(`  Actions: ${data.action_count}`);
        console.log(`  Tips: ${data.tip_count}`);
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag export [--format dot|mermaid|json]
  // ------------------------------------------------------------------
  dag
    .command("export")
    .description("Export the DAG as a visual graph")
    .option("--format <format>", "Export format: dot, mermaid, or json", "mermaid")
    .action(async (opts: { format?: string }) => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const text = await client.dagExport(opts.format ?? "mermaid");
        console.log(text);
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag diff <from> <to>
  // ------------------------------------------------------------------
  dag
    .command("diff")
    .description("Show diff between two DAG action hashes")
    .argument("<from>", "Starting action hash")
    .argument("<to>", "Ending action hash")
    .action(async (from: string, to: string) => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const data = await client.dagDiff(from, to);
        console.log(`Diff: ${data.from} → ${data.to}`);
        console.log(`${data.action_count} action(s):\n`);
        for (const a of data.actions) {
          console.log(`  [${a.payload_type}] ${a.payload_summary} (${a.hash.slice(0, 12)}…)`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag at <hash>
  // ------------------------------------------------------------------
  dag
    .command("at")
    .description("Time-travel to a specific DAG action hash")
    .argument("<hash>", "DAG action hash to travel to")
    .action(async (hash: string) => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const data = await client.dagAt(hash);
        console.log(`Time-travel to ${data.target_hash}`);
        console.log(`  Timestamp: ${data.target_timestamp}`);
        console.log(`  Actions replayed: ${data.actions_replayed}`);
        console.log(`  Triples at that point: ${data.triple_count}`);

        if (data.triples && data.triples.length > 0) {
          console.log(`\nTriples (${data.triples.length}):`);
          for (const t of data.triples.slice(0, 20)) {
            console.log(`  ${t.subject} -> ${t.predicate} -> ${JSON.stringify(t.object)}`);
          }
          if (data.triples.length > 20) {
            console.log(`  ... and ${data.triples.length - 20} more`);
          }
        }
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag verify <hash> --public-key <key>
  // ------------------------------------------------------------------
  dag
    .command("verify")
    .description("Verify Ed25519 signature of a DAG action")
    .argument("<hash>", "DAG action hash to verify")
    .requiredOption("--public-key <key>", "Ed25519 public key (hex or base64)")
    .action(async (hash: string, opts: { publicKey: string }) => {
      const parent = dag.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });

      try {
        const data = await client.dagVerify(hash, opts.publicKey);
        console.log(`Verification: ${data.valid ? "VALID ✓" : "INVALID ✗"}`);
        console.log(`  Hash: ${data.action_hash}`);
        console.log(`  Public key: ${data.public_key}`);
        console.log(`  Detail: ${data.detail}`);
      } catch (err) {
        handleError(err);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros dag prune --policy <policy> [--value N] [--checkpoint]
  // ------------------------------------------------------------------
  dag
    .command("prune")
    .description("Prune old DAG actions")
    .requiredOption(
      "--policy <policy>",
      "Prune policy: keep_all, keep_since, keep_last, or keep_depth",
    )
    .option("--value <n>", "Policy value (timestamp, count, or depth)", (v: string) =>
      parseInt(v, 10),
    )
    .option("--checkpoint", "Create checkpoint before pruning")
    .option("--yes", "Skip confirmation prompt")
    .action(
      async (opts: { policy: string; value?: number; checkpoint?: boolean; yes?: boolean }) => {
        const validPolicies = ["keep_all", "keep_since", "keep_last", "keep_depth"] as const;
        if (!validPolicies.includes(opts.policy as (typeof validPolicies)[number])) {
          console.error(
            `Invalid policy "${opts.policy}". Must be one of: ${validPolicies.join(", ")}`,
          );
          process.exitCode = 1;
          return;
        }

        if (!opts.yes) {
          const confirmed = await confirmAction(
            `This will permanently prune DAG history (policy: ${opts.policy}). Continue?`,
          );
          if (!confirmed) {
            console.log("Prune cancelled.");
            return;
          }
        }

        const parent = dag.opts();
        const client = resolveCortexClient({
          host: parent.cortexHost,
          port: parent.cortexPort,
          token: parent.cortexToken,
        });

        try {
          const data = await client.dagPrune({
            policy: opts.policy as "keep_all" | "keep_since" | "keep_last" | "keep_depth",
            value: opts.value,
            create_checkpoint: opts.checkpoint,
          });

          console.log("Prune complete:");
          console.log(`  Pruned: ${data.pruned_count}`);
          console.log(`  Retained: ${data.retained_count}`);
          if (data.checkpoint_hash) {
            console.log(`  Checkpoint: ${data.checkpoint_hash}`);
          }
        } catch (err) {
          handleError(err);
        } finally {
          client.destroy();
        }
      },
    );
}

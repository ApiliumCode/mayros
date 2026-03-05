/**
 * `mayros tasks` — Background Tasks CLI.
 *
 * List, inspect, and manage background agent tasks.
 *
 * Subcommands:
 *   list [--status <status>] [--agent <id>] [--limit <n>]
 *   status <taskId>
 *   cancel <taskId>
 *   summary
 */

import type { Command } from "commander";
import { parseCortexConfig } from "../../extensions/shared/cortex-config.js";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import {
  BackgroundTracker,
  isValidBackgroundTaskStatus,
} from "../../extensions/agent-mesh/background-tracker.js";
import { loadConfig } from "../config/config.js";

// ============================================================================
// Cortex resolution (reads from agent-mesh plugin config)
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
      const pluginCfg = cfg.plugins?.entries?.["agent-mesh"]?.config as
        | { cortex?: { host?: string; port?: number; authToken?: string } }
        | undefined;
      if (pluginCfg?.cortex) {
        const cortex = parseCortexConfig(pluginCfg.cortex);
        return new CortexClient(cortex);
      }
    } catch {
      // Config not available — use defaults
    }
  }

  return new CortexClient(parseCortexConfig({ host, port, authToken }));
}

function resolveNamespace(): string {
  try {
    const cfg = loadConfig();
    const pluginCfg = cfg.plugins?.entries?.["agent-mesh"]?.config as
      | { agentNamespace?: string }
      | undefined;
    return pluginCfg?.agentNamespace ?? "mayros";
  } catch {
    return "mayros";
  }
}

// ============================================================================
// Registration
// ============================================================================

export function registerTasksCli(program: Command) {
  const tasks = program
    .command("tasks")
    .description("Background tasks — list, inspect, and manage background agent tasks")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ---- list ----

  tasks
    .command("list")
    .description("List background tasks")
    .option("--status <status>", "Filter by status (pending|running|completed|failed|cancelled)")
    .option("--agent <id>", "Filter by agent ID")
    .option("--limit <n>", "Max tasks to show", "20")
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
        console.log("Cortex offline. Cannot list tasks.");
        return;
      }

      const tracker = new BackgroundTracker(client, ns);
      const taskList = await tracker.listTasks({
        status: opts.status && isValidBackgroundTaskStatus(opts.status) ? opts.status : undefined,
        agentId: opts.agent,
        limit: Number.parseInt(opts.limit, 10) || 20,
      });

      if (opts.format === "json") {
        console.log(JSON.stringify(taskList, null, 2));
        return;
      }

      if (taskList.length === 0) {
        console.log("No background tasks found.");
        return;
      }

      console.log(`Background tasks (${taskList.length}):`);
      for (const t of taskList) {
        const progress = t.progress !== undefined ? ` ${t.progress}%` : "";
        const desc = t.description.length > 50 ? t.description.slice(0, 50) + "…" : t.description;
        console.log(`  ${t.id}  [${t.status}]${progress}  ${t.agentId}  ${desc}`);
      }
    });

  // ---- status ----

  tasks
    .command("status")
    .description("Show details for a specific background task")
    .argument("<taskId>", "Task ID")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (taskId, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot get task status.");
        return;
      }

      const tracker = new BackgroundTracker(client, ns);
      const task = await tracker.getTask(taskId);

      if (!task) {
        console.log(`Task ${taskId} not found.`);
        return;
      }

      if (opts.format === "json") {
        console.log(JSON.stringify(task, null, 2));
        return;
      }

      console.log(`Task ${task.id}:`);
      console.log(`  agent: ${task.agentId}`);
      console.log(`  description: ${task.description}`);
      console.log(`  status: ${task.status}`);
      console.log(`  started: ${task.startedAt}`);
      if (task.completedAt) {
        console.log(`  completed: ${task.completedAt}`);
      }
      if (task.progress !== undefined) {
        console.log(`  progress: ${task.progress}%`);
      }
      if (task.result) {
        console.log(`  result: ${task.result}`);
      }
      if (task.error) {
        console.log(`  error: ${task.error}`);
      }
    });

  // ---- cancel ----

  tasks
    .command("cancel")
    .description("Cancel a background task")
    .argument("<taskId>", "Task ID")
    .action(async (taskId, _opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot cancel task.");
        return;
      }

      const tracker = new BackgroundTracker(client, ns);
      const ok = await tracker.cancel(taskId);

      if (!ok) {
        console.log(`Task ${taskId} not found.`);
        return;
      }

      console.log(`Task ${taskId} cancelled.`);
    });

  // ---- summary ----

  tasks
    .command("summary")
    .description("Show aggregate background task statistics")
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
        console.log("Cortex offline. Cannot get task summary.");
        return;
      }

      const tracker = new BackgroundTracker(client, ns);
      const s = await tracker.summary();

      if (opts.format === "json") {
        console.log(JSON.stringify(s, null, 2));
        return;
      }

      console.log(`Background task summary:`);
      console.log(`  total: ${s.total}`);
      console.log(`  running: ${s.running}`);
      console.log(`  completed: ${s.completed}`);
      console.log(`  failed: ${s.failed}`);
      console.log(`  cancelled: ${s.cancelled}`);
      console.log(`  pending: ${s.pending}`);
    });
}

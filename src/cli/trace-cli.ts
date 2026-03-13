/**
 * `mayros trace` — Built-in CLI for inspecting agent trace events.
 *
 * Connects directly to AIngle Cortex to query, explain, and aggregate
 * trace events. Works independently of the semantic-observability plugin.
 *
 * Subcommands:
 *   events   — List trace events (filter by agent, type, time range)
 *   explain  — Show the causal chain leading to an event
 *   stats    — Aggregated statistics for an agent
 *   session  — Build a decision tree from all events in a session
 *   status   — Check Cortex connectivity
 */

import type { Command } from "commander";
import { DecisionGraph } from "../../extensions/semantic-observability/decision-graph.js";
import { ObservabilityQueryEngine } from "../../extensions/semantic-observability/query-engine.js";
import { ObservabilityFormatter } from "../../extensions/semantic-observability/formatters.js";
import { resolveCortexClient, resolveNamespace } from "./shared/cortex-resolution.js";

// ============================================================================
// Registration
// ============================================================================

export function registerTraceCli(program: Command) {
  const trace = program
    .command("trace")
    .description("Inspect agent trace events — query, explain, stats, session trees")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ------------------------------------------------------------------
  // mayros trace events
  // ------------------------------------------------------------------
  trace
    .command("events")
    .description("List recent trace events")
    .option("--agent <id>", "Agent ID to query")
    .option(
      "--type <type>",
      "Filter by event type (tool_call, llm_call, decision, delegation, error)",
    )
    .option("--from <iso>", "Start time (ISO 8601)")
    .option("--to <iso>", "End time (ISO 8601)")
    .option("--format <fmt>", "Output format: terminal, json, markdown", "terminal")
    .action(async (opts) => {
      const parent = trace.opts();
      const client = resolveCortexClient(
        { host: parent.cortexHost, port: parent.cortexPort, token: parent.cortexToken },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");
      const graph = new DecisionGraph(client, ns);

      try {
        const types = opts.type ? [opts.type] : undefined;
        const fromDate = opts.from ? new Date(opts.from) : undefined;
        const toDate = opts.to ? new Date(opts.to) : undefined;
        const agentId = opts.agent ?? "default";

        const events = await graph.queryEvents(agentId, fromDate, toDate, types);

        if (opts.format === "json") {
          console.log(JSON.stringify(events, null, 2));
        } else if (opts.format === "markdown") {
          console.log(ObservabilityFormatter.formatEventsMarkdown(events));
        } else {
          console.log(ObservabilityFormatter.formatEventsTerminal(events));
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros trace explain <eventId>
  // ------------------------------------------------------------------
  trace
    .command("explain")
    .description("Explain why an event occurred (causal chain)")
    .argument("<eventId>", "Event ID to explain")
    .action(async (eventId: string) => {
      const parent = trace.opts();
      const client = resolveCortexClient(
        { host: parent.cortexHost, port: parent.cortexPort, token: parent.cortexToken },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");
      const graph = new DecisionGraph(client, ns);

      try {
        const chain = await graph.explainAction(eventId);
        console.log(ObservabilityFormatter.formatCausalChainTerminal(chain));
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros trace stats
  // ------------------------------------------------------------------
  trace
    .command("stats")
    .description("Show aggregated observability statistics")
    .option("--agent <id>", "Agent ID", "default")
    .option("--from <iso>", "Start time (ISO 8601)")
    .option("--to <iso>", "End time (ISO 8601)")
    .option("--format <fmt>", "Output format: terminal, json", "terminal")
    .action(async (opts) => {
      const parent = trace.opts();
      const client = resolveCortexClient(
        { host: parent.cortexHost, port: parent.cortexPort, token: parent.cortexToken },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");
      const queryEngine = new ObservabilityQueryEngine(client, ns);

      try {
        const timeRange = {
          from: opts.from ? new Date(opts.from) : undefined,
          to: opts.to ? new Date(opts.to) : undefined,
        };

        const stats = await queryEngine.aggregateStats(opts.agent, timeRange);

        if (opts.format === "json") {
          console.log(ObservabilityFormatter.formatStatsJSON(stats));
        } else {
          console.log(ObservabilityFormatter.formatStatsTerminal(stats));
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros trace session <key>
  // ------------------------------------------------------------------
  trace
    .command("session")
    .description("Build a decision tree from all events in a session")
    .argument("<sessionKey>", "Session key to inspect")
    .option("--format <fmt>", "Output format: terminal, json", "terminal")
    .action(async (sessionKey: string, opts: { format?: string }) => {
      const parent = trace.opts();
      const client = resolveCortexClient(
        { host: parent.cortexHost, port: parent.cortexPort, token: parent.cortexToken },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");
      const graph = new DecisionGraph(client, ns);

      try {
        const tree = await graph.buildFromSession(sessionKey);

        if (opts.format === "json") {
          console.log(JSON.stringify(tree, null, 2));
        } else {
          if (tree.events.length === 0) {
            console.log("No events found for session.");
            return;
          }
          console.log(`Session: ${sessionKey}`);
          console.log(`Events: ${tree.events.length} root(s), depth: ${tree.depth}`);
          console.log("");
          printTree(tree.events, 0);
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros trace status
  // ------------------------------------------------------------------
  trace
    .command("status")
    .description("Check Cortex connectivity and configuration")
    .action(async () => {
      const parent = trace.opts();
      const client = resolveCortexClient(
        { host: parent.cortexHost, port: parent.cortexPort, token: parent.cortexToken },
        { pluginName: "semantic-observability" },
      );
      const ns = resolveNamespace("semantic-observability");

      try {
        console.log(`Cortex endpoint: ${client.baseUrl}`);
        console.log(`Namespace: ${ns}`);

        const healthy = await client.isHealthy();
        console.log(`Connection: ${healthy ? "ONLINE" : "OFFLINE"}`);

        if (healthy) {
          try {
            const stats = await client.stats();
            console.log(`Triples: ${stats.graph.triple_count}`);
            console.log(`Subjects: ${stats.graph.subject_count}`);
            console.log(`Uptime: ${stats.server.uptime_seconds}s`);
            console.log(`Version: ${stats.server.version}`);
          } catch {
            // Stats endpoint may not be available
          }
        }
      } finally {
        client.destroy();
      }
    });
}

// ============================================================================
// Tree printer
// ============================================================================

function printTree(
  nodes: Array<{
    id: string;
    type: string;
    agentId: string;
    timestamp: string;
    children: unknown[];
    fields: Record<string, string>;
  }>,
  depth: number,
): void {
  for (const node of nodes) {
    const indent = "  ".repeat(depth);
    const prefix = depth > 0 ? "├─ " : "";
    const ts = node.timestamp.replace("T", " ").replace(/\.\d+Z$/, "Z");
    let detail = "";

    switch (node.type) {
      case "tool_call":
        detail = node.fields.toolName ?? "";
        break;
      case "llm_call":
        detail = `${node.fields.model ?? "?"} ${node.fields.totalTokens ?? "?"}tok`;
        break;
      case "decision":
        detail = `${node.fields.description ?? ""} -> ${node.fields.chosen ?? "?"}`;
        break;
      case "delegation":
        detail = `${node.fields.parentId ?? "?"} -> ${node.fields.childId ?? "?"}`;
        break;
      case "error":
        detail = node.fields.error ?? "";
        break;
    }

    console.log(`${indent}${prefix}[${ts}] ${node.type} ${detail}  (${node.id.slice(0, 8)})`);
    printTree(node.children as typeof nodes, depth + 1);
  }
}

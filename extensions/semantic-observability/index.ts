/**
 * Mayros Semantic Observability Plugin
 *
 * Structured tracing of agent decisions as RDF events via AIngle Cortex.
 * Records tool calls, LLM calls, decisions, delegations, and errors
 * with causal chains and aggregated analytics.
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { HealthMonitor } from "../shared/health-monitor.js";
import { observabilityConfigSchema } from "./config.js";
import { DecisionGraph } from "./decision-graph.js";
import { ObservabilityFormatter } from "./formatters.js";
import { MetricsExporter } from "./metrics-exporter.js";
import { ObservabilityQueryEngine } from "./query-engine.js";
import { TraceEmitter } from "./trace-emitter.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const semanticObservabilityPlugin = {
  id: "semantic-observability",
  name: "Semantic Observability",
  description:
    "Structured tracing of agent decisions as RDF events — tool calls, LLM calls, decisions, delegations, and errors with causal analysis",
  kind: "observability" as const,
  configSchema: observabilityConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = observabilityConfigSchema.parse(api.pluginConfig);
    const ns = cfg.agentNamespace;
    const agentId = api.id;

    // Single CortexClient shared by emitter, graph, and query engine
    const client = new CortexClient(cfg.cortex);

    const emitter = new TraceEmitter(client, ns, cfg.tracing.flushIntervalMs);
    const graph = new DecisionGraph(client, ns);
    const queryEngine = new ObservabilityQueryEngine(client, ns);
    const healthMonitor = new HealthMonitor(client, {
      onHealthy: () => {
        if (cfg.tracing.enabled) {
          emitter.emitDecision(
            agentId,
            "cortex_recovery",
            ["unhealthy", "healthy"],
            "healthy",
            "Cortex connection recovered",
          );
        }
        api.logger.info("semantic-observability: Cortex recovered — now healthy");
      },
      onUnhealthy: () => {
        if (cfg.tracing.enabled) {
          emitter.emitError(
            agentId,
            "cortex_unreachable",
            "Cortex health check failed — connection lost",
          );
        }
        api.logger.warn("semantic-observability: Cortex unreachable — now unhealthy");
      },
    });

    // Metrics exporter
    const metrics = new MetricsExporter();
    if (cfg.metrics.enabled) {
      metrics.registerCounter("mayros_tool_calls_total", "Total tool calls by tool name");
      metrics.registerCounter("mayros_llm_calls_total", "Total LLM calls by model");
      metrics.registerCounter("mayros_llm_tokens_total", "Total LLM tokens by direction");
      metrics.registerCounter("mayros_skill_queries_total", "Total skill graph queries by skill");
      metrics.registerCounter("mayros_cortex_requests_total", "Total Cortex requests by status");
      metrics.registerGauge("mayros_active_skills", "Number of active skills");
    }

    api.logger.info(
      `semantic-observability: plugin registered (ns: ${ns}, agent: ${agentId}, tracing: ${cfg.tracing.enabled}, metrics: ${cfg.metrics.enabled})`,
    );

    // Cortex tool names for metrics tracking
    const CORTEX_TOOLS = new Set([
      "skill_graph_query",
      "skill_assert",
      "skill_verify_assertion",
      "skill_request_zk_proof",
      "skill_verify_zk_proof",
      "skill_memory_context",
      "trace_query",
      "trace_explain",
      "trace_stats",
    ]);

    // Track per-LLM-call timing
    const llmCallTimers = new Map<string, { model: string; startMs: number; session?: string }>();
    // Track subagent runs
    const subagentRuns = new Map<
      string,
      { childId: string; task: string; startMs: number; session?: string }
    >();

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "trace_query",
        label: "Trace Query",
        description: "Query trace events for an agent. Filter by time range and event types.",
        parameters: Type.Object({
          agentId: Type.Optional(Type.String({ description: "Agent ID (default: current agent)" })),
          from: Type.Optional(Type.String({ description: "Start time ISO 8601" })),
          to: Type.Optional(Type.String({ description: "End time ISO 8601" })),
          types: Type.Optional(
            Type.Array(Type.String(), {
              description:
                "Event types to include (tool_call, llm_call, decision, delegation, error)",
            }),
          ),
          format: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["terminal", "json", "markdown"],
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            agentId: queryAgentId,
            from,
            to,
            types,
            format = "terminal",
          } = params as {
            agentId?: string;
            from?: string;
            to?: string;
            types?: string[];
            format?: string;
          };

          const targetAgent = queryAgentId ?? agentId;
          const fromDate = from ? new Date(from) : undefined;
          const toDate = to ? new Date(to) : undefined;

          const events = await graph.queryEvents(targetAgent, fromDate, toDate, types);

          let text: string;
          if (format === "json") {
            text = JSON.stringify(events, null, 2);
          } else if (format === "markdown") {
            text = ObservabilityFormatter.formatEventsMarkdown(events);
          } else {
            text = ObservabilityFormatter.formatEventsTerminal(events);
          }

          return {
            content: [{ type: "text", text }],
            details: { count: events.length, agentId: targetAgent },
          };
        },
      },
      { name: "trace_query" },
    );

    api.registerTool(
      {
        name: "trace_explain",
        label: "Trace Explain",
        description: "Explain why a specific event occurred by tracing its causal chain.",
        parameters: Type.Object({
          eventId: Type.String({ description: "The event ID to explain" }),
        }),
        async execute(_toolCallId, params) {
          const { eventId } = params as { eventId: string };

          const chain = await graph.explainAction(eventId);

          const text = ObservabilityFormatter.formatCausalChainTerminal(chain);

          return {
            content: [{ type: "text", text }],
            details: { eventId, chainLength: chain.chain.length },
          };
        },
      },
      { name: "trace_explain" },
    );

    api.registerTool(
      {
        name: "trace_stats",
        label: "Trace Stats",
        description: "Show aggregated observability statistics for an agent.",
        parameters: Type.Object({
          agentId: Type.Optional(Type.String({ description: "Agent ID (default: current agent)" })),
          from: Type.Optional(Type.String({ description: "Start time ISO 8601" })),
          to: Type.Optional(Type.String({ description: "End time ISO 8601" })),
          format: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["terminal", "json"],
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            agentId: queryAgentId,
            from,
            to,
            format = "terminal",
          } = params as {
            agentId?: string;
            from?: string;
            to?: string;
            format?: string;
          };

          const targetAgent = queryAgentId ?? agentId;
          const timeRange = {
            from: from ? new Date(from) : undefined,
            to: to ? new Date(to) : undefined,
          };

          const stats = await queryEngine.aggregateStats(targetAgent, timeRange);

          const text =
            format === "json"
              ? ObservabilityFormatter.formatStatsJSON(stats)
              : ObservabilityFormatter.formatStatsTerminal(stats);

          return {
            content: [{ type: "text", text }],
            details: stats,
          };
        },
      },
      { name: "trace_stats" },
    );

    // ========================================================================
    // Hooks
    // ========================================================================

    if (cfg.tracing.enabled && cfg.tracing.captureToolCalls) {
      api.on("after_tool_call", async (event, ctx) => {
        const durationMs = event.durationMs ?? 0;
        emitter.emitToolCall(
          agentId,
          event.toolName,
          event.params,
          event.result ?? {},
          durationMs,
          ctx.sessionKey,
        );

        if (cfg.metrics.enabled) {
          metrics.incrementCounter("mayros_tool_calls_total", { tool_name: event.toolName });

          if (event.toolName === "skill_graph_query") {
            metrics.incrementCounter("mayros_skill_queries_total", { tool: "skill_graph_query" });
          }

          if (CORTEX_TOOLS.has(event.toolName)) {
            const status = event.error ? "error" : "success";
            metrics.incrementCounter("mayros_cortex_requests_total", { status });
          }
        }
      });
    }

    if (cfg.tracing.enabled && cfg.tracing.captureLLMCalls) {
      api.on("llm_input", async (event, ctx) => {
        const runId = event.runId;
        const model = event.model;

        llmCallTimers.set(runId, {
          model,
          startMs: Date.now(),
          session: ctx.sessionKey,
        });
      });

      api.on("llm_output", async (event, _ctx) => {
        const runId = event.runId;
        const promptTokens = event.usage?.input ?? 0;
        const completionTokens = event.usage?.output ?? 0;

        const timer = llmCallTimers.get(runId);
        if (timer) {
          llmCallTimers.delete(runId);
          const durationMs = Date.now() - timer.startMs;
          emitter.emitLLMCall(
            agentId,
            timer.model,
            promptTokens,
            completionTokens,
            durationMs,
            timer.session,
          );

          if (cfg.metrics.enabled) {
            metrics.incrementCounter("mayros_llm_calls_total", { model: timer.model });
            metrics.incrementCounter(
              "mayros_llm_tokens_total",
              { direction: "prompt" },
              promptTokens,
            );
            metrics.incrementCounter(
              "mayros_llm_tokens_total",
              { direction: "completion" },
              completionTokens,
            );
          }
        }
      });
    }

    if (cfg.tracing.enabled && cfg.tracing.captureDelegations) {
      api.on("subagent_spawned", async (event, ctx) => {
        const runId = event.runId;
        const childId = event.agentId ?? "unknown";
        const task = event.label ?? "";
        const session = ctx.requesterSessionKey;

        subagentRuns.set(runId, {
          childId,
          task,
          startMs: Date.now(),
          session,
        });

        emitter.emitDelegation(agentId, childId, task, runId, session);
      });

      api.on("subagent_ended", async (event, _ctx) => {
        const runId = event.runId ?? "";
        const success = event.outcome === "ok";

        const run = subagentRuns.get(runId);
        if (run) {
          subagentRuns.delete(runId);
          if (!success) {
            const error = String(event.error ?? "Subagent run failed");
            emitter.emitError(run.childId, error, `delegation run: ${runId}`, run.session);
          }
        }
      });
    }

    if (cfg.tracing.enabled) {
      api.on("agent_end", async (event, ctx) => {
        if (event.success === false) {
          const error = String(event.error ?? "Agent run failed");
          emitter.emitError(agentId, error, "agent_end", ctx.sessionKey);
        }
      });
    }

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const observe = program
          .command("observe")
          .description("Semantic observability commands — trace events, stats, causal analysis");

        observe
          .command("status")
          .description("Show observability status and Cortex connection info")
          .action(async () => {
            console.log(`Observability: ${cfg.tracing.enabled ? "ENABLED" : "DISABLED"}`);
            console.log(`  endpoint: ${client.baseUrl}`);
            console.log(`  namespace: ${ns}`);
            console.log(`  captureToolCalls: ${cfg.tracing.captureToolCalls}`);
            console.log(`  captureLLMCalls: ${cfg.tracing.captureLLMCalls}`);
            console.log(`  captureDelegations: ${cfg.tracing.captureDelegations}`);
            console.log(`  flushInterval: ${cfg.tracing.flushIntervalMs}ms`);
            console.log(`  buffered events: ${emitter.bufferedCount}`);

            // Check Cortex connectivity
            const healthy = await client.isHealthy();
            console.log(`  cortex: ${healthy ? "ONLINE" : "OFFLINE"}`);
          });

        observe
          .command("events")
          .description("List recent trace events")
          .option("--agent <id>", "Agent ID", agentId)
          .option("--type <type>", "Filter by event type")
          .option("--from <iso>", "Start time (ISO 8601)")
          .option("--to <iso>", "End time (ISO 8601)")
          .option("--format <fmt>", "Output format: terminal, json, markdown", "terminal")
          .action(async (opts) => {
            const types = opts.type ? [opts.type] : undefined;
            const fromDate = opts.from ? new Date(opts.from) : undefined;
            const toDate = opts.to ? new Date(opts.to) : undefined;

            const events = await graph.queryEvents(opts.agent, fromDate, toDate, types);

            if (opts.format === "json") {
              console.log(JSON.stringify(events, null, 2));
            } else if (opts.format === "markdown") {
              console.log(ObservabilityFormatter.formatEventsMarkdown(events));
            } else {
              console.log(ObservabilityFormatter.formatEventsTerminal(events));
            }
          });

        observe
          .command("explain")
          .description("Explain why an event occurred (causal chain)")
          .argument("<eventId>", "Event ID to explain")
          .action(async (eventId) => {
            const chain = await graph.explainAction(eventId);
            console.log(ObservabilityFormatter.formatCausalChainTerminal(chain));
          });

        observe
          .command("stats")
          .description("Show aggregated observability statistics")
          .option("--agent <id>", "Agent ID", agentId)
          .option("--from <iso>", "Start time (ISO 8601)")
          .option("--to <iso>", "End time (ISO 8601)")
          .option("--format <fmt>", "Output format: terminal, json", "terminal")
          .action(async (opts) => {
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
          });
      },
      { commands: ["observe"] },
    );

    // ========================================================================
    // Metrics HTTP Route
    // ========================================================================

    if (cfg.metrics.enabled && api.registerHttpRoute) {
      api.registerHttpRoute({
        path: cfg.metrics.path,
        handler: (_req, res) => {
          res.setHeader("Content-Type", "text/plain; version=0.0.4; charset=utf-8");
          res.end(metrics.toPrometheus());
        },
      });
      api.logger.info(`semantic-observability: metrics endpoint registered at ${cfg.metrics.path}`);
    }

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "semantic-observability",
      async start() {
        if (cfg.tracing.enabled) {
          emitter.start();
          api.logger.info(
            `semantic-observability: trace emitter started (flush every ${cfg.tracing.flushIntervalMs}ms, endpoint: ${client.baseUrl})`,
          );
        } else {
          api.logger.info("semantic-observability: tracing disabled, emitter not started");
        }
        healthMonitor.start();
      },
      async stop() {
        healthMonitor.stop();
        await emitter.stop();
        client.destroy();
        api.logger.info("semantic-observability: stopped");
      },
    });
  },
};

export default semanticObservabilityPlugin;

/**
 * Tomeru Guard — Rate Limiting & Loop Breaking Plugin
 *
 * Prevents runaway tool execution with sliding window rate limiting,
 * token bucket burst protection, and intelligent loop detection.
 *
 * Hooks: before_tool_call (priority 200), after_tool_call, session_start, session_end
 * Tools: rate_limit_status, rate_limit_adjust
 * CLI: mayros ratelimit status|adjust|reset
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { parseTomeruConfig } from "./config.js";
import { ToolRateLimiter } from "./rate-limiter.js";
import { LoopBreaker } from "./loop-breaker.js";

const tomeruPlugin = {
  id: "tomeru-guard",
  name: "Tomeru Guard",
  description:
    "Rate limiting and loop breaking for tool calls — prevents runaway execution with sliding windows, burst protection, and loop detection",
  kind: "security" as const,

  async register(api: MayrosPluginApi) {
    const cfg = parseTomeruConfig(api.pluginConfig);

    if (cfg.mode === "off") {
      api.logger.info("tomeru-guard: disabled via config (mode=off)");
      return;
    }

    let rateLimiter: ToolRateLimiter | undefined;
    let loopBreaker: LoopBreaker | undefined;

    api.logger.info(
      `tomeru-guard: registered (mode=${cfg.mode}, window=${cfg.defaultLimit.maxCallsPerWindow}/${cfg.defaultLimit.windowMs}ms, burst=${cfg.burstLimit.maxCallsPerSecond}/s, loop=${cfg.loopBreaker.enabled ? "on" : "off"})`,
    );

    // ========================================================================
    // Hooks
    // ========================================================================

    api.on("session_start", async () => {
      rateLimiter = new ToolRateLimiter(cfg);
      loopBreaker = new LoopBreaker(cfg);
      api.logger.info("tomeru-guard: session started");
    });

    // before_tool_call — rate limit + loop detection
    api.on(
      "before_tool_call",
      async (event) => {
        if (!rateLimiter || !loopBreaker) return;

        const toolName = event.toolName ?? "unknown";
        const params = event.params;

        // 1. Loop breaker check
        const loopCheck = loopBreaker.checkBeforeCall(toolName, params);
        if (loopCheck.action === "block") {
          if (cfg.mode === "enforce") {
            return {
              block: true,
              reason: loopCheck.message,
            };
          }
          api.logger.warn(`tomeru-guard: ${loopCheck.message}`);
        } else if (loopCheck.action === "warn") {
          api.logger.warn(`tomeru-guard: ${loopCheck.message}`);
        }

        // 2. Rate limiter check
        const rateCheck = rateLimiter.check(toolName);
        if (!rateCheck.allowed) {
          if (cfg.mode === "enforce") {
            return {
              block: true,
              reason: rateCheck.reason,
            };
          }
          api.logger.warn(`tomeru-guard: ${rateCheck.reason}`);
        }

        // Record the call
        rateLimiter.record(toolName);
      },
      { priority: 200 },
    );

    // after_tool_call — record for loop detection
    api.on("after_tool_call", async (event) => {
      if (!loopBreaker) return;

      const toolName = event.toolName ?? "unknown";
      loopBreaker.recordAfterCall(toolName, event.params, event.result);

      // Check same-result repetition
      const sameResult = loopBreaker.checkSameResult(toolName);
      if (sameResult.action === "block" || sameResult.action === "warn") {
        api.logger.warn(`tomeru-guard: ${sameResult.message}`);
      }
    });

    api.on("session_end", async () => {
      rateLimiter = undefined;
      loopBreaker = undefined;
      api.logger.info("tomeru-guard: session ended");
    });

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "rate_limit_status",
        label: "Rate Limit Status",
        description: "Show current Tomeru rate limiting and loop detection status.",
        parameters: Type.Object({}),
        async execute() {
          if (!rateLimiter || !loopBreaker) {
            return {
              content: [{ type: "text", text: "Tomeru not initialized (no active session)." }],
              details: { error: "not_initialized" },
            };
          }

          const rateStats = rateLimiter.getStats();
          const loopStats = loopBreaker.getStats();

          const lines = [
            `Mode: ${cfg.mode}`,
            `Rate limiting:`,
            `  Total checks: ${rateStats.totalChecks}`,
            `  Rejected: ${rateStats.totalRejected}`,
            `  Bucket tokens: ${rateStats.bucketTokens.toFixed(1)}`,
            `Loop detection:`,
            `  Buffer: ${loopStats.bufferSize}/50`,
            `  Calls/min: ${loopStats.totalCallsThisMinute}`,
          ];

          const toolEntries = Object.entries(rateStats.perTool);
          if (toolEntries.length > 0) {
            lines.push("", "Per-tool:");
            for (const [tool, stats] of toolEntries
              .sort((a, b) => b[1].calls - a[1].calls)
              .slice(0, 10)) {
              lines.push(`  ${tool}: ${stats.calls} calls, ${stats.rejected} rejected`);
            }
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: { rateStats, loopStats },
          };
        },
      },
      { name: "rate_limit_status" },
    );

    api.registerTool(
      {
        name: "rate_limit_adjust",
        label: "Rate Limit Adjust",
        description: "Adjust rate limit for a specific tool at runtime.",
        parameters: Type.Object({
          toolName: Type.String({ description: "Tool name to adjust" }),
          maxCallsPerWindow: Type.Number({ description: "Max calls per window" }),
          windowMs: Type.Optional(
            Type.Number({ description: "Window duration in ms (default: 60000)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { toolName, maxCallsPerWindow, windowMs } = params as {
            toolName: string;
            maxCallsPerWindow: number;
            windowMs?: number;
          };

          if (maxCallsPerWindow <= 0) {
            return {
              content: [{ type: "text", text: "maxCallsPerWindow must be positive." }],
              details: { error: "invalid_value" },
            };
          }

          cfg.perToolLimits[toolName] = {
            maxCallsPerWindow: Math.floor(maxCallsPerWindow),
            windowMs: windowMs ? Math.floor(windowMs) : cfg.defaultLimit.windowMs,
          };

          return {
            content: [
              {
                type: "text",
                text: `Rate limit for "${toolName}" set to ${maxCallsPerWindow} calls per ${windowMs ?? cfg.defaultLimit.windowMs}ms.`,
              },
            ],
            details: {
              toolName,
              maxCallsPerWindow,
              windowMs: windowMs ?? cfg.defaultLimit.windowMs,
            },
          };
        },
      },
      { name: "rate_limit_adjust" },
    );

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const rl = program.command("ratelimit").description("Tomeru rate limiting commands");

        rl.command("status")
          .description("Show rate limit status")
          .action(async () => {
            if (!rateLimiter || !loopBreaker) {
              console.log("Tomeru not initialized (no active session).");
              return;
            }

            const rateStats = rateLimiter.getStats();
            const loopStats = loopBreaker.getStats();

            console.log("Tomeru Guard Status");
            console.log("───────────────────");
            console.log(`Mode: ${cfg.mode}`);
            console.log(`Checks: ${rateStats.totalChecks}, Rejected: ${rateStats.totalRejected}`);
            console.log(`Bucket: ${rateStats.bucketTokens.toFixed(1)} tokens`);
            console.log(`Loop buffer: ${loopStats.bufferSize}/50`);
            console.log(`Calls/min: ${loopStats.totalCallsThisMinute}`);
          });

        rl.command("adjust")
          .description("Adjust rate limit for a tool")
          .argument("<tool>", "Tool name")
          .argument("<maxCalls>", "Max calls per window")
          .option("-w, --window <ms>", "Window duration in ms")
          .action(async (tool: string, maxCallsStr: string, opts: { window?: string }) => {
            const maxCalls = parseInt(maxCallsStr, 10);
            if (!Number.isFinite(maxCalls) || maxCalls <= 0) {
              console.log("maxCalls must be a positive integer.");
              return;
            }
            const windowMs = opts.window ? parseInt(opts.window, 10) : cfg.defaultLimit.windowMs;
            cfg.perToolLimits[tool] = { maxCallsPerWindow: maxCalls, windowMs };
            console.log(`Rate limit for "${tool}" set to ${maxCalls} calls per ${windowMs}ms.`);
          });

        rl.command("reset")
          .description("Reset all rate limit counters")
          .action(async () => {
            if (rateLimiter) rateLimiter.reset();
            if (loopBreaker) loopBreaker.reset();
            console.log("Rate limit counters reset.");
          });
      },
      { commands: ["ratelimit"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "tomeru-guard",
      async start() {
        api.logger.info("tomeru-guard: service started");
      },
      async stop() {
        rateLimiter = undefined;
        loopBreaker = undefined;
        api.logger.info("tomeru-guard: service stopped");
      },
    });
  },
};

export default tomeruPlugin;

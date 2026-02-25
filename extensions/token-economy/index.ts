import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import type { NormalizedUsage } from "../../src/agents/usage.js";
import {
  resolveModelCostConfig,
  estimateUsageCost,
  formatUsd,
} from "../../src/utils/usage-format.js";
import type { ModelCostConfig } from "../../src/utils/usage-format.js";
import { BudgetPersistence } from "./budget-persistence.js";
import { BudgetTracker } from "./budget-tracker.js";
import type { BudgetSummary } from "./budget-tracker.js";
import { parseTokenBudgetConfig } from "./config.js";
import { PromptCache } from "./prompt-cache.js";

const tokenEconomyPlugin = {
  id: "token-economy",
  name: "Token Economy",
  description:
    "Per-session cost tracking, configurable budgets with soft-stop, and prompt-level memoization",
  kind: "economy" as const,

  async register(api: MayrosPluginApi) {
    const cfg = parseTokenBudgetConfig(api.pluginConfig);
    const persistence = new BudgetPersistence(cfg.persistPath);

    let tracker: BudgetTracker | undefined;
    let cache: PromptCache | undefined;
    let flushInterval: ReturnType<typeof setInterval> | undefined;

    if (cfg.cache.enabled) {
      cache = new PromptCache(cfg.cache.maxEntries, cfg.cache.ttlMs);
    }

    api.logger.info(
      `token-economy: registered (session: ${cfg.sessionLimitUsd ? `$${cfg.sessionLimitUsd}` : "unlimited"}, daily: ${cfg.dailyLimitUsd ? `$${cfg.dailyLimitUsd}` : "unlimited"}, monthly: ${cfg.monthlyLimitUsd ? `$${cfg.monthlyLimitUsd}` : "unlimited"})`,
    );

    // ========================================================================
    // Hooks
    // ========================================================================

    // session_start — load persisted budget, rollover day/month, init tracker
    api.on("session_start", async () => {
      let persisted = await persistence.load();
      persisted = persistence.rolloverIfNeeded(persisted);
      tracker = new BudgetTracker(cfg, persisted);
      api.logger.info(
        `token-economy: session started (daily: $${persisted.dailyCostUsd.toFixed(4)}, monthly: $${persisted.monthlyCostUsd.toFixed(4)})`,
      );

      // Periodic flush every 30s
      flushInterval = setInterval(async () => {
        if (tracker) {
          try {
            await persistence.save(tracker.getPersistedSnapshot());
          } catch {
            // best-effort flush
          }
        }
      }, 30_000);
    });

    // llm_output — accumulate cost, update prompt cache
    api.on("llm_output", async (event) => {
      if (!tracker) return;

      const usage = event.usage as NormalizedUsage | undefined;
      if (!usage) return;

      const costConfig = resolveModelCostConfig({
        provider: event.provider,
        model: event.model,
        config: api.config,
      });

      tracker.recordUsage(usage, costConfig);

      // Update prompt cache (observational: store for future hit detection)
      if (cache) {
        // We can't reconstruct the full prompt from llm_output alone, but
        // the llm_input hook already checked the cache. Here we just note
        // that we could potentially compute savings next time this combination
        // is seen. The cache key was set from llm_input; we skip storing here
        // unless we have a pending key from the llm_input phase.
        if (pendingCacheKey) {
          const cost = estimateUsageCost({ usage, cost: costConfig }) ?? 0;
          cache.store(pendingCacheKey, {
            usage: { ...usage },
            costUsd: cost,
            storedAt: Date.now(),
            hitCount: 0,
          });
          pendingCacheKey = undefined;
        }
      }
    });

    // llm_input — check prompt cache for observational tracking
    let pendingCacheKey: string | undefined;

    api.on("llm_input", async (event) => {
      if (!cache) return;
      const key = PromptCache.computeKey(
        event.provider ?? "",
        event.model ?? "",
        event.systemPrompt ?? "",
        event.prompt ?? "",
      );
      const hit = cache.lookup(key);
      if (hit) {
        // Observational only: we can't skip the LLM call.
        // The cache already updated estimatedSavingsUsd in lookup().
        pendingCacheKey = undefined;
      } else {
        // Miss: store the key so llm_output can populate it.
        pendingCacheKey = key;
      }
    });

    // before_tool_call — hard enforcement: block tool calls after grace period
    api.on("before_tool_call", async () => {
      if (!tracker) return;
      if (cfg.enforcement !== "hard") return;

      tracker.recordToolCall();

      if (tracker.isHardBlocked(cfg.gracePeriodCalls)) {
        return {
          block: true,
          reason: `Token budget exceeded. ${tracker.getToolCallsSinceExceeded()} tool calls since budget exceeded (grace period: ${cfg.gracePeriodCalls}). Stop and summarize.`,
        };
      }
    });

    // before_prompt_build — inject budget warnings/soft-stop messages
    api.on("before_prompt_build", () => {
      if (!tracker) return;

      const status = tracker.getOverallStatus();

      if (status.level === "exceeded") {
        const pct = status.percent ? `${(status.percent * 100).toFixed(0)}%` : ">100%";
        if (cfg.enforcement === "hard") {
          const remaining = Math.max(0, cfg.gracePeriodCalls - tracker.getToolCallsSinceExceeded());
          return {
            prependContext: `[SYSTEM: Budget exceeded (${pct} of ${formatUsd(status.limitUsd) ?? "limit"}). STOP immediately. Do not call tools. Summarize and end. Grace period: ${remaining} call(s) remaining.]`,
          };
        }
        return {
          prependContext: `[Budget limit reached (${pct} of ${formatUsd(status.limitUsd) ?? "limit"} used). Please wrap up current task and avoid new LLM calls.]`,
        };
      }

      if (status.level === "warn") {
        const pct = status.percent ? `${(status.percent * 100).toFixed(0)}%` : "";
        if (cfg.enforcement === "hard") {
          return {
            prependContext: `[Budget warning: ${pct} of ${formatUsd(status.limitUsd) ?? "limit"} used. Hard enforcement active — tool calls will be blocked when budget is exceeded.]`,
          };
        }
        return {
          prependContext: `[Budget warning: ${pct} of ${formatUsd(status.limitUsd) ?? "limit"} used.]`,
        };
      }
    });

    // session_end — flush persisted budget to disk, clear prompt cache
    api.on("session_end", async () => {
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = undefined;
      }
      if (tracker) {
        try {
          await persistence.save(tracker.getPersistedSnapshot());
        } catch (err) {
          api.logger.warn(`token-economy: failed to persist budget on session end: ${String(err)}`);
        }
      }
      cache?.clear();
      api.logger.info("token-economy: session ended, budget flushed");
    });

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "budget_status",
        label: "Budget Status",
        description: "Show current token budget status — session, daily, monthly cost and limits.",
        parameters: Type.Object({}),
        async execute() {
          if (!tracker) {
            return {
              content: [
                { type: "text", text: "Token economy not initialized (no active session)." },
              ],
              details: { error: "not_initialized" },
            };
          }

          const summary = tracker.getSummary();
          const cacheStats = cache?.getStats();
          const full: BudgetSummary = {
            ...summary,
            cacheHits: cacheStats?.hits,
            cacheMisses: cacheStats?.misses,
            estimatedSavingsUsd: cacheStats?.estimatedSavingsUsd,
          };

          const lines = [
            `Session: ${formatStatus(full.session)}`,
            `Daily:   ${formatStatus(full.daily)}`,
            `Monthly: ${formatStatus(full.monthly)}`,
            `Calls:   ${full.callCount}`,
            `Tokens:  in=${full.tokens.input ?? 0} out=${full.tokens.output ?? 0} cacheR=${full.tokens.cacheRead ?? 0} cacheW=${full.tokens.cacheWrite ?? 0}`,
          ];
          if (cacheStats) {
            lines.push(
              `Cache:   ${cacheStats.hits} hits, ${cacheStats.misses} misses, ${cacheStats.entries} entries`,
              `Est. savings: ${formatUsd(cacheStats.estimatedSavingsUsd) ?? "$0.0000"}`,
            );
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: full,
          };
        },
      },
      { name: "budget_status" },
    );

    api.registerTool(
      {
        name: "budget_set_limit",
        label: "Budget Set Limit",
        description: "Set or update a budget limit at runtime. Scope: session, daily, or monthly.",
        parameters: Type.Object({
          scope: Type.Unsafe<string>({
            type: "string",
            enum: ["session", "daily", "monthly"],
            description: "Which budget scope to set",
          }),
          limitUsd: Type.Number({ description: "Limit in USD" }),
        }),
        async execute(_toolCallId, params) {
          const { scope, limitUsd } = params as {
            scope: "session" | "daily" | "monthly";
            limitUsd: number;
          };

          if (!tracker) {
            return {
              content: [{ type: "text", text: "Token economy not initialized." }],
              details: { error: "not_initialized" },
            };
          }

          if (limitUsd <= 0) {
            return {
              content: [{ type: "text", text: "Limit must be a positive number." }],
              details: { error: "invalid_limit" },
            };
          }

          tracker.updateLimit(scope, limitUsd);
          return {
            content: [
              { type: "text", text: `${scope} budget limit set to ${formatUsd(limitUsd)}.` },
            ],
            details: { scope, limitUsd },
          };
        },
      },
      { name: "budget_set_limit" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const budget = program.command("budget").description("Token budget management commands");

        budget
          .command("status")
          .description("Print budget summary table")
          .action(async () => {
            if (!tracker) {
              console.log("Token economy not initialized (no active session).");
              return;
            }

            const summary = tracker.getSummary();
            console.log("Token Budget Status");
            console.log("───────────────────");
            console.log(`Session: ${formatStatus(summary.session)}`);
            console.log(`Daily:   ${formatStatus(summary.daily)}`);
            console.log(`Monthly: ${formatStatus(summary.monthly)}`);
            console.log(`Calls:   ${summary.callCount}`);
            console.log(
              `Tokens:  in=${summary.tokens.input ?? 0} out=${summary.tokens.output ?? 0} cacheR=${summary.tokens.cacheRead ?? 0} cacheW=${summary.tokens.cacheWrite ?? 0}`,
            );
          });

        budget
          .command("set")
          .description("Set a budget limit")
          .argument("<scope>", "Budget scope: session, daily, or monthly")
          .argument("<usd>", "Limit in USD")
          .action(async (scope: string, usdStr: string) => {
            if (!tracker) {
              console.log("Token economy not initialized.");
              return;
            }

            const validScopes = ["session", "daily", "monthly"];
            if (!validScopes.includes(scope)) {
              console.log(`Invalid scope "${scope}". Use: ${validScopes.join(", ")}`);
              return;
            }

            const usd = parseFloat(usdStr);
            if (!Number.isFinite(usd) || usd <= 0) {
              console.log("Limit must be a positive number.");
              return;
            }

            tracker.updateLimit(scope as "session" | "daily" | "monthly", usd);
            console.log(`${scope} budget limit set to ${formatUsd(usd)}.`);
          });

        budget
          .command("reset")
          .description("Reset budget counters")
          .argument("[scope]", "Scope to reset: session, daily, monthly, or all (default: all)")
          .action(async (scope?: string) => {
            if (!tracker) {
              console.log("Token economy not initialized.");
              return;
            }

            const s = scope ?? "all";
            if (s === "session" || s === "all") tracker.resetSession();
            if (s === "daily" || s === "all") tracker.resetDaily();
            if (s === "monthly" || s === "all") tracker.resetMonthly();

            if (s === "all") {
              try {
                await persistence.save(tracker.getPersistedSnapshot());
              } catch {
                // best-effort
              }
            }

            console.log(`Budget counters reset (${s}).`);
          });

        budget
          .command("cache")
          .description("Show prompt cache stats")
          .action(async () => {
            if (!cache) {
              console.log("Prompt cache is disabled.");
              return;
            }

            const stats = cache.getStats();
            console.log("Prompt Cache Stats");
            console.log("──────────────────");
            console.log(`Entries:  ${stats.entries}`);
            console.log(`Hits:     ${stats.hits}`);
            console.log(`Misses:   ${stats.misses}`);
            console.log(
              `Hit rate: ${stats.hits + stats.misses > 0 ? ((stats.hits / (stats.hits + stats.misses)) * 100).toFixed(1) : 0}%`,
            );
            console.log(`Est. savings: ${formatUsd(stats.estimatedSavingsUsd) ?? "$0.0000"}`);
          });
      },
      { commands: ["budget"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "token-economy",
      async start() {
        api.logger.info("token-economy: service started");
      },
      async stop() {
        if (flushInterval) {
          clearInterval(flushInterval);
          flushInterval = undefined;
        }
        if (tracker) {
          try {
            await persistence.save(tracker.getPersistedSnapshot());
          } catch {
            // best-effort
          }
        }
        cache?.clear();
        tracker = undefined;
        api.logger.info("token-economy: service stopped");
      },
    });
  },
};

function formatStatus(s: {
  level: string;
  usedUsd: number;
  limitUsd?: number;
  percent?: number;
}): string {
  const used = formatUsd(s.usedUsd) ?? "$0.0000";
  const limit = s.limitUsd !== undefined ? (formatUsd(s.limitUsd) ?? "?") : "unlimited";
  const pct = s.percent !== undefined ? ` (${(s.percent * 100).toFixed(1)}%)` : "";
  const tag = s.level === "exceeded" ? " [EXCEEDED]" : s.level === "warn" ? " [WARNING]" : "";
  return `${used} / ${limit}${pct}${tag}`;
}

export default tokenEconomyPlugin;

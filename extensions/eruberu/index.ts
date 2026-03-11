/**
 * Eruberu — Intelligent Model Routing Plugin
 *
 * Activates ModelRouter via the before_model_resolve hook and uses
 * Q-Learning to adaptively select the best provider/model for each task.
 *
 * Hooks: before_model_resolve, llm_output, agent_end, session_start, session_end
 * Tools: routing_status, routing_set_strategy
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import type { ModelRoutingStrategy } from "../../src/routing/model-router.js";
import { getBudgetBridge } from "../shared/budget-bridge.js";
import { parseEruberuConfig, type EruberuConfig } from "./config.js";
import {
  saveToCortex,
  loadFromCortex,
  saveToFile,
  loadFromFile,
  type CortexPersistenceClient,
} from "./cortex-persistence.js";
import { QTable, stateKey, computeReward, type QState, type RewardSignal } from "./q-learning.js";
import {
  classifyTask,
  classifyBudgetLevel,
  classifyTimeSlot,
  type BudgetLevel,
} from "./task-classifier.js";

// ============================================================================
// Plugin
// ============================================================================

const eruberuPlugin = {
  id: "eruberu",
  name: "Eruberu",
  description:
    "Intelligent model routing with Q-Learning — adapts provider/model selection based on task type, budget, and performance history",
  kind: "routing" as const,

  async register(api: MayrosPluginApi) {
    const cfg = parseEruberuConfig(api.pluginConfig);

    if (!cfg.enabled) {
      api.logger.info("eruberu: disabled via config");
      return;
    }

    let qTable: QTable | undefined;
    let cortexClient: CortexPersistenceClient | null = null;
    let flushInterval: ReturnType<typeof setInterval> | undefined;

    // Track pending routing decisions for reward computation
    const pendingDecisions = new Map<
      string,
      { state: QState; action: string; startTime: number }
    >();

    // Available routing strategies (actions for Q-learning)
    function buildAvailableActions(): string[] {
      return ["default:", "fallback:", "cost-optimized:", "capability:"];
    }

    // ========================================================================
    // Hooks
    // ========================================================================

    // session_start — load Q-table
    api.on("session_start", async () => {
      qTable = new QTable(cfg.qLearning);

      // Try Cortex first, then file fallback
      try {
        if (cfg.cortexPersist) {
          const { CortexClient } = await import("../shared/cortex-client.js");
          const cortexCfg = (api.pluginConfig as Record<string, unknown> | undefined)?.cortex as
            | Record<string, unknown>
            | undefined;
          const host = (cortexCfg?.host as string | undefined) ?? "127.0.0.1";
          const port = (cortexCfg?.port as number | undefined) ?? 19090;
          cortexClient = new CortexClient(host, port) as unknown as CortexPersistenceClient;
          const data = await loadFromCortex(cortexClient);
          if (Object.keys(data).length > 0) {
            qTable.import(data);
            api.logger.info(`eruberu: loaded ${qTable.size()} Q-values from Cortex`);
          }
        }
      } catch {
        cortexClient = null;
      }

      // Fallback to file
      if (qTable.size() === 0) {
        try {
          const data = await loadFromFile(cfg.persistPath);
          if (Object.keys(data).length > 0) {
            qTable.import(data);
            api.logger.info(`eruberu: loaded ${qTable.size()} Q-values from file`);
          }
        } catch {
          // Start fresh
        }
      }

      api.logger.info(
        `eruberu: session started (strategy=${cfg.strategy}, ε=${qTable.getEpsilon().toFixed(3)}, entries=${qTable.size()})`,
      );

      // Periodic persist every 60s
      flushInterval = setInterval(async () => {
        if (!qTable) return;
        try {
          await persistQTable(qTable, cortexClient, cfg);
        } catch {
          // best-effort
        }
      }, 60_000);
    });

    // before_model_resolve — main routing logic
    api.on(
      "before_model_resolve",
      async (event) => {
        if (!qTable || !cfg.enabled) return;

        // Skip if agent has explicit model override
        if (event.modelOverride) return;

        // Determine task type from prompt
        const prompt = event.prompt ?? event.systemPrompt ?? "";
        const taskType = classifyTask(prompt);

        // Get budget status
        const tracker = getBudgetBridge();
        let budgetLevel: BudgetLevel = "low";
        let budgetFraction: number | undefined;

        if (tracker) {
          const status = tracker.getOverallStatus();
          budgetFraction = status.percent;
          budgetLevel = classifyBudgetLevel(budgetFraction);
        }

        const timeSlot = classifyTimeSlot();
        const state: QState = { taskType, budgetLevel, timeSlot };
        const sk = stateKey(state);

        // Budget-driven override
        if (cfg.budgetDrivenFallback && budgetFraction !== undefined) {
          if (budgetFraction >= cfg.budgetCriticalThreshold) {
            // Force cheapest model
            pendingDecisions.set(event.runId, {
              state,
              action: "cost-optimized:",
              startTime: Date.now(),
            });
            return {
              strategyOverride: "cost-optimized" as ModelRoutingStrategy,
            };
          }
          if (budgetFraction >= cfg.budgetWarnThreshold) {
            pendingDecisions.set(event.runId, {
              state,
              action: "cost-optimized:",
              startTime: Date.now(),
            });
            return {
              strategyOverride: "cost-optimized" as ModelRoutingStrategy,
            };
          }
        }

        // Fixed strategy
        if (cfg.strategy !== "auto") {
          return {
            strategyOverride: cfg.strategy as ModelRoutingStrategy,
          };
        }

        // Q-Learning selection
        const availableActions = buildAvailableActions();
        const chosenAction = qTable.selectAction(sk, availableActions);

        if (!chosenAction) return;

        // Parse action: "strategy:provider?"
        const [strategyPart, providerPart] = chosenAction.split(":");
        const strategy = (strategyPart || "default") as ModelRoutingStrategy;

        pendingDecisions.set(event.runId, {
          state,
          action: chosenAction,
          startTime: Date.now(),
        });

        const result: Record<string, unknown> = {
          strategyOverride: strategy,
        };
        if (providerPart) {
          result.preferredProvider = providerPart;
        }

        return result;
      },
      { priority: 50 },
    );

    // llm_output — collect reward signals
    api.on("llm_output", async (event) => {
      if (!qTable) return;

      const decision = pendingDecisions.get(event.runId);
      if (!decision) return;
      pendingDecisions.delete(event.runId);

      const latencyMs = Date.now() - decision.startTime;
      const usage = event.usage as { input?: number; output?: number; total?: number } | undefined;
      const totalTokens = usage?.total ?? (usage?.input ?? 0) + (usage?.output ?? 0);

      // Compute reward signal
      const signal: RewardSignal = {
        success: event.error ? -1.0 : 1.0,
        costEfficiency: 0,
        qualityProxy: 0,
        latencyPenalty: 0,
        rateLimitPenalty: 0,
      };

      // Cost efficiency: reward cheaper calls
      if (totalTokens > 0) {
        // Normalize: <1k tokens = max efficiency
        const tokenK = totalTokens / 1000;
        signal.costEfficiency = Math.max(0, Math.min(0.5, 0.5 - tokenK * 0.01));
      }

      // Quality proxy: output length relative to input suggests useful response
      if (usage?.output && usage.output > 50) {
        signal.qualityProxy = Math.min(0.3, usage.output / 5000);
      }

      // Latency penalty: penalize slow responses (>30s)
      if (latencyMs > 30_000) {
        signal.latencyPenalty = -0.2;
      }

      // Rate limit penalty
      if (event.rateLimited) {
        signal.rateLimitPenalty = -0.8;
      }

      const reward = computeReward(signal);
      const currentState = stateKey(decision.state);

      // Next state = same task type, possibly updated budget
      const tracker = getBudgetBridge();
      const nextBudgetFraction = tracker?.getOverallStatus().percent;
      const nextState = stateKey({
        taskType: decision.state.taskType,
        budgetLevel: classifyBudgetLevel(nextBudgetFraction),
        timeSlot: classifyTimeSlot(),
      });

      qTable.update(currentState, decision.action, reward, nextState);
    });

    // session_end — persist Q-table
    api.on("session_end", async () => {
      if (flushInterval) {
        clearInterval(flushInterval);
        flushInterval = undefined;
      }

      if (qTable) {
        try {
          await persistQTable(qTable, cortexClient, cfg);
        } catch (err) {
          api.logger.warn(`eruberu: failed to persist Q-table: ${String(err)}`);
        }
      }

      pendingDecisions.clear();
      api.logger.info("eruberu: session ended");
    });

    // ========================================================================
    // Tools
    // ========================================================================

    api.registerTool(
      {
        name: "routing_status",
        label: "Routing Status",
        description:
          "Show current Eruberu intelligent routing status — strategy, Q-table size, epsilon, budget level.",
        parameters: Type.Object({}),
        async execute() {
          if (!qTable) {
            return {
              content: [{ type: "text", text: "Eruberu not initialized (no active session)." }],
              details: { error: "not_initialized" },
            };
          }

          const tracker = getBudgetBridge();
          const budgetStatus = tracker?.getOverallStatus();
          const budgetFraction = budgetStatus?.percent;

          const lines = [
            `Strategy: ${cfg.strategy}`,
            `Q-Table entries: ${qTable.size()}`,
            `Epsilon (ε): ${qTable.getEpsilon().toFixed(4)}`,
            `Budget level: ${classifyBudgetLevel(budgetFraction)}`,
            `Budget-driven fallback: ${cfg.budgetDrivenFallback ? "enabled" : "disabled"}`,
            `Pending decisions: ${pendingDecisions.size}`,
          ];

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {
              strategy: cfg.strategy,
              qTableSize: qTable.size(),
              epsilon: qTable.getEpsilon(),
              budgetLevel: classifyBudgetLevel(budgetFraction),
              budgetFraction,
              pendingDecisions: pendingDecisions.size,
            },
          };
        },
      },
      { name: "routing_status" },
    );

    api.registerTool(
      {
        name: "routing_set_strategy",
        label: "Set Routing Strategy",
        description:
          "Change the Eruberu routing strategy at runtime. Options: auto, default, fallback, cost-optimized, capability.",
        parameters: Type.Object({
          strategy: Type.String({
            description: "Routing strategy: auto, default, fallback, cost-optimized, capability",
          }),
        }),
        async execute(_toolCallId, params) {
          const { strategy } = params as { strategy: string };
          const valid = ["auto", "default", "fallback", "cost-optimized", "capability"];
          if (!valid.includes(strategy)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Invalid strategy "${strategy}". Valid: ${valid.join(", ")}`,
                },
              ],
              details: { error: "invalid_strategy" },
            };
          }

          (cfg as { strategy: string }).strategy = strategy;
          return {
            content: [{ type: "text", text: `Routing strategy set to "${strategy}".` }],
            details: { strategy },
          };
        },
      },
      { name: "routing_set_strategy" },
    );

    // ========================================================================
    // CLI
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const routing = program.command("routing").description("Eruberu intelligent model routing");

        routing
          .command("status")
          .description("Show routing status and Q-table info")
          .action(async () => {
            if (!qTable) {
              console.log("Eruberu not initialized (no active session).");
              return;
            }

            const tracker = getBudgetBridge();
            const budgetFraction = tracker?.getOverallStatus().percent;

            console.log("Eruberu Routing Status");
            console.log("─────────────────────");
            console.log(`Strategy:     ${cfg.strategy}`);
            console.log(`Q-Table:      ${qTable.size()} entries`);
            console.log(`Epsilon (ε):  ${qTable.getEpsilon().toFixed(4)}`);
            console.log(`Budget level: ${classifyBudgetLevel(budgetFraction)}`);
            console.log(`Budget fallback: ${cfg.budgetDrivenFallback ? "enabled" : "disabled"}`);
          });

        routing
          .command("strategy")
          .description("Set routing strategy")
          .argument("<strategy>", "auto, default, fallback, cost-optimized, capability")
          .action(async (strategy: string) => {
            const valid = ["auto", "default", "fallback", "cost-optimized", "capability"];
            if (!valid.includes(strategy)) {
              console.log(`Invalid strategy "${strategy}". Valid: ${valid.join(", ")}`);
              return;
            }
            (cfg as { strategy: string }).strategy = strategy;
            console.log(`Routing strategy set to "${strategy}".`);
          });

        routing
          .command("reset")
          .description("Clear Q-table and start fresh")
          .action(async () => {
            if (!qTable) {
              console.log("Eruberu not initialized.");
              return;
            }
            qTable.clear();
            try {
              await persistQTable(qTable, cortexClient, cfg);
            } catch {
              // best-effort
            }
            console.log("Q-table cleared.");
          });
      },
      { commands: ["routing"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "eruberu",
      async start() {
        api.logger.info("eruberu: service started");
      },
      async stop() {
        if (flushInterval) {
          clearInterval(flushInterval);
          flushInterval = undefined;
        }
        if (qTable) {
          try {
            await persistQTable(qTable, cortexClient, cfg);
          } catch {
            // best-effort
          }
        }
        qTable = undefined;
        cortexClient = null;
        pendingDecisions.clear();
        api.logger.info("eruberu: service stopped");
      },
    });
  },
};

// ============================================================================
// Helpers
// ============================================================================

async function persistQTable(
  qTable: QTable,
  cortexClient: CortexPersistenceClient | null,
  cfg: EruberuConfig,
): Promise<void> {
  const data = qTable.export();

  if (cortexClient && cfg.cortexPersist) {
    try {
      await saveToCortex(cortexClient, data);
      return;
    } catch {
      // Fall through to file
    }
  }

  await saveToFile(cfg.persistPath, data);
}

export default eruberuPlugin;

/**
 * Mayros LLM Hooks Plugin
 *
 * Markdown-defined hooks evaluated by LLM for policy enforcement.
 * Discovers hook files from project and user directories, registers
 * dynamic hook handlers on specified events, evaluates conditions
 * safely (no eval), and calls the LLM for policy decisions.
 *
 * CLI: mayros llm-hooks list|test|cache|reload
 */

import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { HookCache } from "./cache.js";
import { llmHooksConfigSchema } from "./config.js";
import type { LlmHookDefinition } from "./hook-loader.js";
import { loadAllHooks, parseHookMarkdown } from "./hook-loader.js";
import {
  evaluateCondition,
  evaluateHook,
  type EvalContext,
  type LlmCallFn,
  type LlmHookEvaluation,
} from "./llm-evaluator.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const llmHooksPlugin = {
  id: "llm-hooks",
  name: "LLM Hooks",
  description:
    "Markdown-defined hooks evaluated by LLM for policy enforcement — discover .md hook files, evaluate conditions, and enforce approve/deny/warn decisions",
  kind: "security" as const,
  configSchema: llmHooksConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = llmHooksConfigSchema.parse(api.pluginConfig);

    if (!cfg.enabled) {
      api.logger.info("llm-hooks: plugin disabled by config");
      return;
    }

    // State
    let hooks: LlmHookDefinition[] = [];
    const cache = new HookCache(cfg.globalCacheTtlMs);
    let llmCallFn: LlmCallFn | undefined;

    // Concurrency limiter
    let activeEvals = 0;

    // Inject the LLM call function from the host API if available
    const apiExt = api as unknown as Record<string, unknown>;
    if (typeof apiExt.callLlm === "function") {
      llmCallFn = apiExt.callLlm as LlmCallFn;
    }

    // ========================================================================
    // Hook Loading
    // ========================================================================

    async function reloadHooks(): Promise<number> {
      hooks = await loadAllHooks(cfg.projectHooksDir, cfg.userHooksDir);
      const enabledCount = hooks.filter((h) => h.enabled).length;
      api.logger.info(`llm-hooks: loaded ${hooks.length} hook(s), ${enabledCount} enabled`);
      return hooks.length;
    }

    // ========================================================================
    // Hook Evaluation Pipeline
    // ========================================================================

    async function runHook(
      hook: LlmHookDefinition,
      context: EvalContext,
    ): Promise<LlmHookEvaluation | undefined> {
      if (!hook.enabled) return undefined;

      // 1. Evaluate condition (if present) — skip if false
      if (hook.condition) {
        const conditionMet = evaluateCondition(hook.condition, context);
        if (!conditionMet) return undefined;
      }

      // 2. Check cache
      const bodyHash = cache.hashBody(hook.body);
      const contextHash = cache.hashContext(context);
      const cacheKey = cache.buildKey(hook.name, bodyHash, contextHash);

      const cached = cache.get(hook.cache, cacheKey);
      if (cached) {
        return { ...cached, cached: true };
      }

      // 3. Concurrency check
      if (activeEvals >= cfg.maxConcurrentEvals) {
        api.logger.warn(
          `llm-hooks: skipping ${hook.name} — max concurrent evals (${cfg.maxConcurrentEvals}) reached`,
        );
        return undefined;
      }

      // 4. Call LLM evaluator
      activeEvals++;
      try {
        const model = hook.model ?? cfg.defaultModel;
        const timeoutMs = hook.timeoutMs ?? cfg.defaultTimeoutMs;

        const result = await evaluateHook(hook, context, {
          model,
          timeoutMs,
          llmCall: llmCallFn,
        });

        // 5. Cache result
        cache.set(hook.cache, cacheKey, result);

        return result;
      } finally {
        activeEvals--;
      }
    }

    async function runHooksForEvent(
      eventName: string,
      context: EvalContext,
    ): Promise<LlmHookEvaluation[]> {
      const matchingHooks = hooks.filter((h) => h.enabled && h.events.includes(eventName));

      const results: LlmHookEvaluation[] = [];
      for (const hook of matchingHooks) {
        const result = await runHook(hook, context);
        if (result) {
          results.push(result);
          // Short-circuit on deny
          if (result.decision === "deny") break;
        }
      }

      return results;
    }

    // ========================================================================
    // Hook Registration
    // ========================================================================

    function registerEventHandlers(): void {
      // Collect unique event names from all hooks
      const eventNames = new Set<string>();
      for (const hook of hooks) {
        for (const event of hook.events) {
          eventNames.add(event);
        }
      }

      // Register handlers for each event type
      for (const eventName of eventNames) {
        const hooksForEvent = hooks.filter((h) => h.enabled && h.events.includes(eventName));
        if (hooksForEvent.length === 0) continue;

        // Determine the highest priority among hooks for this event
        const maxPriority = Math.max(...hooksForEvent.map((h) => h.priority));

        switch (eventName) {
          case "before_tool_call":
            api.on(
              "before_tool_call",
              async (event, ctx) => {
                const context: EvalContext = {
                  toolName: event.toolName,
                  params: event.params as Record<string, unknown>,
                  sessionKey: ctx.sessionKey,
                  agentId: ctx.agentId,
                };

                const results = await runHooksForEvent("before_tool_call", context);
                const denied = results.find((r) => r.decision === "deny");
                if (denied) {
                  return {
                    block: true,
                    blockReason: `[${denied.hookName}] ${denied.reason}`,
                  };
                }
                return {};
              },
              { priority: maxPriority },
            );
            break;

          case "after_tool_call":
            api.on(
              "after_tool_call",
              async (event, ctx) => {
                const context: EvalContext = {
                  toolName: event.toolName,
                  params: event.params as Record<string, unknown>,
                  sessionKey: ctx.sessionKey,
                  agentId: ctx.agentId,
                };

                await runHooksForEvent("after_tool_call", context);
              },
              { priority: maxPriority },
            );
            break;

          case "message_sending":
            api.on(
              "message_sending",
              async (event, ctx) => {
                const ctxExt = ctx as unknown as Record<string, unknown>;
                const context: EvalContext = {
                  message: event.content,
                  sessionKey: ctxExt.sessionKey as string | undefined,
                  agentId: ctxExt.agentId as string | undefined,
                };

                const results = await runHooksForEvent("message_sending", context);
                const denied = results.find((r) => r.decision === "deny");
                if (denied) {
                  return {
                    cancel: true,
                    cancelReason: `[${denied.hookName}] ${denied.reason}`,
                  };
                }

                const warned = results.find((r) => r.decision === "warn");
                if (warned) {
                  return {
                    modified: true,
                    modifiedReason: `[${warned.hookName}] ${warned.reason}`,
                  };
                }

                return {};
              },
              { priority: maxPriority },
            );
            break;

          case "before_prompt_build":
            api.on(
              "before_prompt_build",
              async (_event, ctx) => {
                const context: EvalContext = {
                  sessionKey: ctx.sessionKey,
                  agentId: ctx.agentId,
                };

                const results = await runHooksForEvent("before_prompt_build", context);
                const warned = results.find((r) => r.decision === "warn");
                if (warned) {
                  return {
                    prependContext: `[${warned.hookName}] ${warned.reason}`,
                  };
                }
                return {};
              },
              { priority: maxPriority },
            );
            break;

          case "before_agent_start":
            api.on(
              "before_agent_start",
              async (_event, ctx) => {
                const context: EvalContext = {
                  agentId: ctx.agentId,
                  sessionKey: ctx.sessionKey,
                };

                const results = await runHooksForEvent("before_agent_start", context);
                const denied = results.find((r) => r.decision === "deny");
                if (denied) {
                  return {
                    prependContext: `[DENIED: ${denied.hookName}] ${denied.reason}`,
                  };
                }
                return {};
              },
              { priority: maxPriority },
            );
            break;

          case "session_start":
            api.on(
              "session_start",
              async (_event, ctx) => {
                cache.clearSession();
                const context: EvalContext = {
                  sessionKey: ctx.sessionId,
                  agentId: ctx.agentId,
                };
                await runHooksForEvent("session_start", context);
              },
              { priority: maxPriority },
            );
            break;

          case "session_end":
            api.on(
              "session_end",
              async (_event, ctx) => {
                const context: EvalContext = {
                  sessionKey: ctx.sessionId,
                  agentId: ctx.agentId,
                };
                await runHooksForEvent("session_end", context);
                cache.clearSession();
              },
              { priority: maxPriority },
            );
            break;
        }
      }
    }

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const llmHooksCmd = program
          .command("llm-hooks")
          .description("LLM-evaluated hook management — list, test, cache, reload");

        llmHooksCmd
          .command("list")
          .description("List discovered hooks with status")
          .action(async () => {
            if (hooks.length === 0) {
              console.log("No hooks discovered.");
              console.log(`  Project dir: ${cfg.projectHooksDir}`);
              console.log(`  User dir: ${cfg.userHooksDir}`);
              return;
            }

            console.log(`Discovered ${hooks.length} hook(s):\n`);
            for (const hook of hooks) {
              const status = hook.enabled ? "ENABLED" : "DISABLED";
              const origin = hook.origin === "project" ? "project" : "user";
              console.log(`  [${status}] ${hook.name} (${origin})`);
              console.log(`    events: ${hook.events.join(", ")}`);
              console.log(`    priority: ${hook.priority}`);
              console.log(`    cache: ${hook.cache}`);
              if (hook.condition) {
                console.log(`    condition: ${hook.condition}`);
              }
              if (hook.model) {
                console.log(`    model: ${hook.model}`);
              }
              console.log(`    source: ${hook.sourcePath}`);
              console.log();
            }
          });

        llmHooksCmd
          .command("test")
          .description("Test a hook file against sample context (dry run)")
          .argument("<file>", "Path to the hook markdown file")
          .option("--tool <name>", "Tool name for context", "exec")
          .option("--params <json>", "JSON params for context", "{}")
          .action(async (file, opts) => {
            const { readFile } = await import("node:fs/promises");
            try {
              const content = await readFile(file, "utf-8");
              const hook = parseHookMarkdown(content, file, "project");

              console.log(`Hook: ${hook.name}`);
              console.log(`Events: ${hook.events.join(", ")}`);
              console.log(`Priority: ${hook.priority}`);
              console.log(`Cache: ${hook.cache}`);
              console.log(`Enabled: ${hook.enabled}`);

              let params: Record<string, unknown> = {};
              try {
                params = JSON.parse(opts.params) as Record<string, unknown>;
              } catch {
                console.error("Invalid JSON for --params");
                return;
              }

              const context: EvalContext = {
                toolName: opts.tool,
                params,
              };

              if (hook.condition) {
                const conditionMet = evaluateCondition(hook.condition, context);
                console.log(`\nCondition: ${hook.condition}`);
                console.log(`Condition result: ${conditionMet}`);

                if (!conditionMet) {
                  console.log("\nHook would be SKIPPED (condition not met).");
                  return;
                }
              }

              if (llmCallFn) {
                console.log("\nEvaluating with LLM...");
                const result = await evaluateHook(hook, context, {
                  llmCall: llmCallFn,
                });
                console.log(`Decision: ${result.decision}`);
                console.log(`Reason: ${result.reason}`);
                console.log(`Duration: ${result.durationMs}ms`);
              } else {
                console.log("\nNo LLM call function available — skipping evaluation.");
                console.log("Hook body preview:");
                console.log(hook.body.slice(0, 500));
              }
            } catch (err) {
              console.error(
                `Failed to test hook: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          });

        llmHooksCmd
          .command("cache")
          .description("Show cache statistics")
          .action(() => {
            const s = cache.stats();
            console.log("LLM Hooks Cache:");
            console.log(`  Session entries: ${s.sessionSize}`);
            console.log(`  Global entries:  ${s.globalSize}`);
            console.log(`  Global TTL:      ${cfg.globalCacheTtlMs}ms`);
          });

        llmHooksCmd
          .command("reload")
          .description("Reload hooks from disk")
          .action(async () => {
            const count = await reloadHooks();
            console.log(`Reloaded ${count} hook(s) from disk.`);
          });
      },
      { commands: ["llm-hooks"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "llm-hooks",
      async start() {
        await reloadHooks();
        registerEventHandlers();
        api.logger.info(
          `llm-hooks: service started (${hooks.length} hooks, ` +
            `project: ${cfg.projectHooksDir}, user: ${cfg.userHooksDir})`,
        );
      },
      async stop() {
        cache.clearAll();
        hooks = [];
        api.logger.info("llm-hooks: service stopped");
      },
    });

    api.logger.info("llm-hooks: plugin registered");
  },
};

export default llmHooksPlugin;

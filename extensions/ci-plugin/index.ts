/**
 * Mayros CI/CD Plugin
 *
 * Multi-provider CI/CD integration with Cortex run registry.
 * Supports GitHub Actions and GitLab CI providers.
 *
 * Tools: ci_list_runs, ci_get_run, ci_trigger_run, ci_get_logs
 *
 * CLI: mayros ci runs|status|trigger|cancel|logs
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { ciPluginConfigSchema } from "./config.js";
import { CiCortexRegistry } from "./cortex-registry.js";
import { GitHubProvider } from "./providers/github.js";
import { GitLabProvider } from "./providers/gitlab.js";
import type { CiProvider, CiPipelineRun } from "./providers/types.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const ciPlugin = {
  id: "ci-plugin",
  name: "CI/CD Plugin",
  description:
    "CI/CD pipeline integration with GitHub Actions and GitLab CI providers, backed by Cortex run registry",
  kind: "integration" as const,
  configSchema: ciPluginConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = ciPluginConfigSchema.parse(api.pluginConfig);
    const ns = cfg.namespace;
    const client = new CortexClient(cfg.cortex);

    let cortexAvailable = false;
    const registry = cfg.registerInCortex ? new CiCortexRegistry(client, ns) : undefined;

    // Build provider instances
    const providers = new Map<string, CiProvider>();
    for (const providerCfg of cfg.providers) {
      if (providerCfg.type === "github") {
        providers.set(
          "github",
          new GitHubProvider(providerCfg.token, providerCfg.baseUrl, providerCfg.defaultOrg),
        );
      } else if (providerCfg.type === "gitlab") {
        providers.set(
          "gitlab",
          new GitLabProvider(providerCfg.token, providerCfg.baseUrl, providerCfg.defaultOrg),
        );
      }
    }

    api.logger.info(
      `ci-plugin: registered (ns: ${ns}, providers: ${[...providers.keys()].join(", ")})`,
    );

    // ========================================================================
    // Helpers
    // ========================================================================

    async function ensureCortex(): Promise<boolean> {
      if (cortexAvailable) return true;
      cortexAvailable = await client.isHealthy();
      return cortexAvailable;
    }

    function resolveProvider(requested?: string): CiProvider | undefined {
      if (requested) return providers.get(requested);
      // Return first available provider
      return providers.values().next().value;
    }

    async function maybeRecord(run: CiPipelineRun): Promise<void> {
      if (registry && (await ensureCortex())) {
        try {
          await registry.recordRun(run);
        } catch {
          // Non-critical
        }
      }
    }

    // ========================================================================
    // Tools
    // ========================================================================

    // 1. ci_list_runs
    api.registerTool(
      {
        name: "ci_list_runs",
        label: "CI List Runs",
        description: "List recent CI/CD pipeline runs for a repository.",
        parameters: Type.Object({
          repo: Type.String({ description: "Repository (e.g., owner/repo)" }),
          branch: Type.Optional(Type.String({ description: "Filter by branch" })),
          limit: Type.Optional(Type.Number({ description: "Max runs to return (default: 20)" })),
          provider: Type.Optional(Type.String({ description: "Provider: github or gitlab" })),
        }),
        async execute(_toolCallId, params) {
          const {
            repo,
            branch,
            limit,
            provider: providerName,
          } = params as {
            repo: string;
            branch?: string;
            limit?: number;
            provider?: string;
          };

          const provider = resolveProvider(providerName);
          if (!provider) {
            return {
              content: [{ type: "text", text: "No CI provider configured." }],
              details: { action: "failed", reason: "no_provider" },
            };
          }

          try {
            const runs = await provider.listRuns(repo, { branch, limit });

            for (const run of runs) {
              await maybeRecord(run);
            }

            const lines = runs.map(
              (r) => `${r.id}  ${r.status.padEnd(10)}  ${r.branch.padEnd(20)}  ${r.url}`,
            );

            return {
              content: [
                {
                  type: "text",
                  text:
                    runs.length > 0
                      ? `${runs.length} run(s) for ${repo}:\n\n${lines.join("\n")}`
                      : `No runs found for ${repo}.`,
                },
              ],
              details: { action: "listed", repo, count: runs.length, provider: provider.type },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to list runs: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "ci_list_runs" },
    );

    // 2. ci_get_run
    api.registerTool(
      {
        name: "ci_get_run",
        label: "CI Get Run",
        description: "Get details of a specific CI/CD pipeline run.",
        parameters: Type.Object({
          repo: Type.String({ description: "Repository (e.g., owner/repo)" }),
          runId: Type.String({ description: "Run/pipeline ID" }),
          provider: Type.Optional(Type.String({ description: "Provider: github or gitlab" })),
        }),
        async execute(_toolCallId, params) {
          const {
            repo,
            runId,
            provider: providerName,
          } = params as {
            repo: string;
            runId: string;
            provider?: string;
          };

          const provider = resolveProvider(providerName);
          if (!provider) {
            return {
              content: [{ type: "text", text: "No CI provider configured." }],
              details: { action: "failed", reason: "no_provider" },
            };
          }

          try {
            const run = await provider.getRun(repo, runId);
            if (!run) {
              return {
                content: [{ type: "text", text: `Run ${runId} not found.` }],
                details: { action: "not_found", runId },
              };
            }

            await maybeRecord(run);

            return {
              content: [
                {
                  type: "text",
                  text: [
                    `Run ${run.id} (${run.provider}):`,
                    `  repo: ${run.repo}`,
                    `  branch: ${run.branch}`,
                    `  status: ${run.status}`,
                    `  url: ${run.url}`,
                    run.startedAt ? `  started: ${run.startedAt}` : "",
                    run.completedAt ? `  completed: ${run.completedAt}` : "",
                  ]
                    .filter(Boolean)
                    .join("\n"),
                },
              ],
              details: { action: "found", run },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get run: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "ci_get_run" },
    );

    // 3. ci_trigger_run
    api.registerTool(
      {
        name: "ci_trigger_run",
        label: "CI Trigger Run",
        description: "Trigger a new CI/CD pipeline run.",
        parameters: Type.Object({
          repo: Type.String({ description: "Repository (e.g., owner/repo)" }),
          branch: Type.String({ description: "Branch to run on" }),
          workflow: Type.Optional(
            Type.String({ description: "Workflow file (GitHub only, default: ci.yml)" }),
          ),
          provider: Type.Optional(Type.String({ description: "Provider: github or gitlab" })),
        }),
        async execute(_toolCallId, params) {
          const {
            repo,
            branch,
            workflow,
            provider: providerName,
          } = params as {
            repo: string;
            branch: string;
            workflow?: string;
            provider?: string;
          };

          const provider = resolveProvider(providerName);
          if (!provider) {
            return {
              content: [{ type: "text", text: "No CI provider configured." }],
              details: { action: "failed", reason: "no_provider" },
            };
          }

          try {
            const run = await provider.triggerRun(repo, { branch, workflow });
            await maybeRecord(run);

            return {
              content: [
                {
                  type: "text",
                  text: `Triggered ${provider.type} run for ${repo} on ${branch}. ID: ${run.id}, URL: ${run.url}`,
                },
              ],
              details: { action: "triggered", run },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to trigger run: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "ci_trigger_run" },
    );

    // 4. ci_get_logs
    api.registerTool(
      {
        name: "ci_get_logs",
        label: "CI Get Logs",
        description: "Get logs from a CI/CD pipeline run.",
        parameters: Type.Object({
          repo: Type.String({ description: "Repository (e.g., owner/repo)" }),
          runId: Type.String({ description: "Run/pipeline ID" }),
          provider: Type.Optional(Type.String({ description: "Provider: github or gitlab" })),
        }),
        async execute(_toolCallId, params) {
          const {
            repo,
            runId,
            provider: providerName,
          } = params as {
            repo: string;
            runId: string;
            provider?: string;
          };

          const provider = resolveProvider(providerName);
          if (!provider) {
            return {
              content: [{ type: "text", text: "No CI provider configured." }],
              details: { action: "failed", reason: "no_provider" },
            };
          }

          try {
            const logs = await provider.getRunLogs(repo, runId);
            return {
              content: [{ type: "text", text: logs || "(empty logs)" }],
              details: { action: "retrieved", repo, runId },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to get logs: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "ci_get_logs" },
    );

    // ========================================================================
    // CLI: mayros ci runs|status|trigger|cancel|logs
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const ci = program
          .command("ci")
          .description("CI/CD pipelines — list, inspect, trigger, and manage pipeline runs");

        ci.command("runs")
          .description("List recent pipeline runs")
          .argument("<repo>", "Repository (e.g., owner/repo)")
          .option("--branch <branch>", "Filter by branch")
          .option("--limit <n>", "Max runs", "20")
          .option("--provider <p>", "Provider (github|gitlab)")
          .action(
            async (repo: string, opts: { branch?: string; limit?: string; provider?: string }) => {
              const provider = resolveProvider(opts.provider);
              if (!provider) {
                console.log("No CI provider configured.");
                return;
              }
              try {
                const runs = await provider.listRuns(repo, {
                  branch: opts.branch,
                  limit: Number.parseInt(opts.limit ?? "20", 10),
                });
                if (runs.length === 0) {
                  console.log(`No runs found for ${repo}.`);
                  return;
                }
                console.log(`Runs for ${repo} (${runs.length}):`);
                for (const r of runs) {
                  console.log(
                    `  ${r.id}  ${r.status.padEnd(10)}  ${r.branch.padEnd(20)}  ${r.url}`,
                  );
                }
              } catch (err) {
                console.log(`Error: ${String(err)}`);
              }
            },
          );

        ci.command("status")
          .description("Get status of a specific run")
          .argument("<repo>", "Repository")
          .argument("<runId>", "Run/pipeline ID")
          .option("--provider <p>", "Provider (github|gitlab)")
          .action(async (repo: string, runId: string, opts: { provider?: string }) => {
            const provider = resolveProvider(opts.provider);
            if (!provider) {
              console.log("No CI provider configured.");
              return;
            }
            try {
              const run = await provider.getRun(repo, runId);
              if (!run) {
                console.log(`Run ${runId} not found.`);
                return;
              }
              console.log(`Run ${run.id} (${run.provider}):`);
              console.log(`  repo: ${run.repo}`);
              console.log(`  branch: ${run.branch}`);
              console.log(`  status: ${run.status}`);
              console.log(`  url: ${run.url}`);
              if (run.startedAt) console.log(`  started: ${run.startedAt}`);
              if (run.completedAt) console.log(`  completed: ${run.completedAt}`);
            } catch (err) {
              console.log(`Error: ${String(err)}`);
            }
          });

        ci.command("trigger")
          .description("Trigger a new pipeline run")
          .argument("<repo>", "Repository")
          .requiredOption("--branch <branch>", "Branch to run on")
          .option("--workflow <w>", "Workflow file (GitHub only)")
          .option("--provider <p>", "Provider (github|gitlab)")
          .action(
            async (
              repo: string,
              opts: { branch: string; workflow?: string; provider?: string },
            ) => {
              const provider = resolveProvider(opts.provider);
              if (!provider) {
                console.log("No CI provider configured.");
                return;
              }
              try {
                const run = await provider.triggerRun(repo, {
                  branch: opts.branch,
                  workflow: opts.workflow,
                });
                console.log(
                  `Triggered ${provider.type} run for ${repo} on ${opts.branch}. ID: ${run.id}`,
                );
                console.log(`  URL: ${run.url}`);
              } catch (err) {
                console.log(`Error: ${String(err)}`);
              }
            },
          );

        ci.command("cancel")
          .description("Cancel a pipeline run")
          .argument("<repo>", "Repository")
          .argument("<runId>", "Run/pipeline ID")
          .option("--provider <p>", "Provider (github|gitlab)")
          .action(async (repo: string, runId: string, opts: { provider?: string }) => {
            const provider = resolveProvider(opts.provider);
            if (!provider) {
              console.log("No CI provider configured.");
              return;
            }
            try {
              const ok = await provider.cancelRun(repo, runId);
              console.log(ok ? `Run ${runId} cancelled.` : `Failed to cancel run ${runId}.`);
            } catch (err) {
              console.log(`Error: ${String(err)}`);
            }
          });

        ci.command("logs")
          .description("Get logs from a pipeline run")
          .argument("<repo>", "Repository")
          .argument("<runId>", "Run/pipeline ID")
          .option("--provider <p>", "Provider (github|gitlab)")
          .action(async (repo: string, runId: string, opts: { provider?: string }) => {
            const provider = resolveProvider(opts.provider);
            if (!provider) {
              console.log("No CI provider configured.");
              return;
            }
            try {
              const logs = await provider.getRunLogs(repo, runId);
              console.log(logs || "(empty logs)");
            } catch (err) {
              console.log(`Error: ${String(err)}`);
            }
          });
      },
      { commands: ["ci"] },
    );

    // ========================================================================
    // Hook: after_tool_call — record completed CI runs to Cortex
    // ========================================================================

    api.on("after_tool_call", async (event) => {
      if (!registry) return;

      const toolName = event.toolName;
      if (
        toolName !== "ci_list_runs" &&
        toolName !== "ci_get_run" &&
        toolName !== "ci_trigger_run"
      ) {
        return;
      }

      // Recording already happens in tool handlers; this hook is a safety net
    });

    // ========================================================================
    // Service lifecycle
    // ========================================================================

    api.registerService({
      id: "ci-plugin-lifecycle",
      async start() {
        // No auto-connect needed; providers are stateless HTTP clients
      },
      async stop() {
        client.destroy();
      },
    });
  },
};

export default ciPlugin;

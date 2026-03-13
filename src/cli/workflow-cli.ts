/**
 * `mayros workflow` — Built-in CLI for multi-agent workflows.
 *
 * Provides access to workflow execution, listing, and status tracking.
 * Connects to AIngle Cortex via the agent-mesh plugin config.
 *
 * Subcommands:
 *   run      — Execute a pre-defined workflow
 *   list     — List available workflow definitions
 *   status   — Show progress of a workflow run
 *   history  — List past workflow runs
 */

import type { Command } from "commander";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import { KnowledgeFusion } from "../../extensions/agent-mesh/knowledge-fusion.js";
import { NamespaceManager } from "../../extensions/agent-mesh/namespace-manager.js";
import { TeamManager } from "../../extensions/agent-mesh/team-manager.js";
import { WorkflowOrchestrator } from "../../extensions/agent-mesh/workflow-orchestrator.js";
import { listWorkflows as listWorkflowDefs } from "../../extensions/agent-mesh/workflows/registry.js";
import { parseTeamsConfig } from "../../extensions/agent-mesh/config.js";
import { loadConfig } from "../config/config.js";
import { resolveCortexClient, resolveNamespace } from "./shared/cortex-resolution.js";

function resolveTeamsConfig(): {
  maxTeamSize: number;
  defaultStrategy: string;
  workflowTimeout: number;
} {
  try {
    const cfg = loadConfig();
    const pluginCfg = cfg.plugins?.entries?.["agent-mesh"]?.config as
      | { teams?: unknown }
      | undefined;
    return parseTeamsConfig(pluginCfg?.teams);
  } catch {
    return parseTeamsConfig(undefined);
  }
}

function createOrchestrator(client: CortexClient, ns: string) {
  const teamsConfig = resolveTeamsConfig();
  const nsMgr = new NamespaceManager(client, ns, 50);
  const fusion = new KnowledgeFusion(client, ns);
  const teamMgr = new TeamManager(client, ns, nsMgr, fusion, {
    maxTeamSize: teamsConfig.maxTeamSize,
    defaultStrategy: teamsConfig.defaultStrategy as "additive",
    workflowTimeout: teamsConfig.workflowTimeout,
  });
  return new WorkflowOrchestrator(client, ns, teamMgr, fusion, nsMgr);
}

// ============================================================================
// Registration
// ============================================================================

export function registerWorkflowCli(program: Command) {
  const workflow = program
    .command("workflow")
    .description("Multi-agent workflows — run, list, and track workflow execution")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ---- run ----

  workflow
    .command("run")
    .description("Execute a pre-defined multi-agent workflow")
    .argument("<name>", "Workflow name (code-review, feature-dev, security-review)")
    .option("--path <path>", "Target path", ".")
    .option(
      "--strategy <strategy>",
      "Override merge strategy (additive, replace, conflict-flag, newest-wins, majority-wins)",
    )
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (name, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot run workflow.");
          return;
        }

        const orchestrator = createOrchestrator(client, ns);

        const entry = await orchestrator.startWorkflow({
          workflowName: name,
          path: opts.path,
        });

        if (opts.format === "json") {
          console.log(JSON.stringify(entry, null, 2));
          return;
        }

        const phaseNames = entry.phases.map((p) => p.name).join(" → ");
        console.log(`Workflow "${entry.name}" started:`);
        console.log(`  id: ${entry.id}`);
        console.log(`  path: ${entry.path}`);
        console.log(`  phases: ${phaseNames}`);
        console.log(`  current: ${entry.currentPhase}`);
        console.log(`  team: ${entry.teamId}`);

        // Execute all phases
        let phaseIdx = 0;
        while (true) {
          const phaseResult = await orchestrator.executeNextPhase(entry.id);
          if (!phaseResult) break;
          phaseIdx++;

          console.log(`\n  Phase ${phaseIdx}: ${phaseResult.phase} — ${phaseResult.status}`);
          for (const ar of phaseResult.agentResults) {
            console.log(`    - ${ar.agentId} (${ar.role}): ${ar.findings} findings`);
          }
          if (phaseResult.conflicts > 0) {
            console.log(`    conflicts: ${phaseResult.conflicts}`);
          }
        }

        // Final result
        const result = await orchestrator.completeWorkflow(entry.id);
        console.log(`\nResult: ${result.summary}`);
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- list ----

  workflow
    .command("list")
    .description("List available workflow definitions")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts) => {
      const defs = listWorkflowDefs();

      if (opts.format === "json") {
        console.log(JSON.stringify(defs, null, 2));
        return;
      }

      console.log(`Available workflows (${defs.length}):`);
      for (const def of defs) {
        const phaseNames = def.phases.map((p) => p.name).join(" → ");
        const agentCount = def.phases.reduce((sum, p) => sum + p.agents.length, 0);
        console.log(`  ${def.name}`);
        console.log(`    ${def.description}`);
        console.log(`    phases: ${phaseNames}`);
        console.log(`    agents: ${agentCount}`);
        console.log(`    strategy: ${def.defaultStrategy}`);
      }
    });

  // ---- status ----

  workflow
    .command("status")
    .description("Show progress of a workflow run")
    .argument("[id]", "Workflow run ID")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (id, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot get workflow status.");
          return;
        }

        const orchestrator = createOrchestrator(client, ns);

        if (!id) {
          // List recent runs
          const runs = await orchestrator.listWorkflowRuns();
          if (runs.length === 0) {
            console.log("No workflow runs found.");
            return;
          }

          if (opts.format === "json") {
            console.log(JSON.stringify(runs, null, 2));
            return;
          }

          console.log(`Recent workflow runs (${runs.length}):`);
          for (const r of runs) {
            console.log(`  - ${r.id}: ${r.name} [${r.state}] (updated: ${r.updatedAt})`);
          }
          return;
        }

        const entry = await orchestrator.getWorkflow(id);
        if (!entry) {
          console.log(`Workflow ${id} not found.`);
          return;
        }

        if (opts.format === "json") {
          console.log(JSON.stringify(entry, null, 2));
          return;
        }

        console.log(`Workflow "${entry.name}" (${entry.id}):`);
        console.log(`  state: ${entry.state}`);
        console.log(`  path: ${entry.path}`);
        console.log(`  current phase: ${entry.currentPhase}`);
        console.log(`  team: ${entry.teamId}`);
        console.log(`  created: ${entry.createdAt}`);
        console.log(`  updated: ${entry.updatedAt}`);

        const phaseResults = Object.values(entry.phaseResults);
        if (phaseResults.length > 0) {
          console.log(`  phase results:`);
          for (const pr of phaseResults) {
            console.log(
              `    ${pr.phase}: ${pr.status} (${pr.agentResults.length} agents, ${pr.conflicts} conflicts)`,
            );
          }
        }

        if (entry.result) {
          console.log(`  result: ${entry.result.summary}`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });

  // ---- history ----

  workflow
    .command("history")
    .description("List past workflow runs")
    .option("--limit <n>", "Max results", "20")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient(
        {
          host: parentOpts.cortexHost,
          port: parentOpts.cortexPort,
          token: parentOpts.cortexToken,
        },
        { pluginName: "agent-mesh" },
      );
      const ns = resolveNamespace("agent-mesh");

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex offline. Cannot list workflow history.");
          return;
        }

        const orchestrator = createOrchestrator(client, ns);
        const runs = await orchestrator.listWorkflowRuns();
        const limit = Number.parseInt(opts.limit, 10) || 20;
        const limited = runs.slice(0, limit);

        if (opts.format === "json") {
          console.log(JSON.stringify(limited, null, 2));
          return;
        }

        if (limited.length === 0) {
          console.log("No workflow runs found.");
          return;
        }

        console.log(
          `Workflow history (${limited.length}${runs.length > limit ? ` of ${runs.length}` : ""}):`,
        );
        for (const r of limited) {
          console.log(`  - ${r.id}: ${r.name} [${r.state}] (updated: ${r.updatedAt})`);
        }
      } catch (err) {
        console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
        process.exitCode = 1;
      } finally {
        client.destroy();
      }
    });
}

/**
 * `mayros kaneru` — Kaneru multi-agent coordination CLI.
 *
 * Provides access to squad management, mission routing, consensus,
 * delegation, knowledge fusion, and the Kaneru dashboard.
 *
 * Subcommands:
 *   squad create  — Create a new squad of agents
 *   squad run     — Run a mission on a squad
 *   squad status  — Get squad status and members
 *   squad list    — List all squads
 *   delegate      — Delegate a mission between agents
 *   consensus     — Run consensus across a squad
 *   route         — Route a mission to the best agent via Q-learning
 *   fuse          — Merge knowledge between namespaces
 *   dashboard     — Show Kaneru dashboard summary
 */

import type { Command } from "commander";
import { resolveCortexClient, CortexError } from "./shared/cortex-resolution.js";

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

/** Lazy-load KaneruFacade to avoid heavy imports at CLI parse time. */
async function createFacade(opts: {
  cortexHost?: string;
  cortexPort?: string;
  cortexToken?: string;
}) {
  const { KaneruFacade } = await import("../../extensions/agent-mesh/kaneru-facade.js");
  return new KaneruFacade({
    host: opts.cortexHost,
    port: opts.cortexPort,
    token: opts.cortexToken,
  });
}

// ============================================================================
// Registration
// ============================================================================

export function registerKaneruCli(program: Command) {
  const kaneru = program
    .command("kaneru")
    .description("Kaneru — multi-agent squads, missions, consensus, and routing")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 19090 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ------------------------------------------------------------------
  // mayros kaneru squad
  // ------------------------------------------------------------------
  const squad = kaneru.command("squad").description("Manage Kaneru squads");

  // mayros kaneru squad create
  squad
    .command("create")
    .description("Create a new squad of agents for coordinated missions")
    .requiredOption("--name <name>", "Squad name")
    .requiredOption("--agents <agents>", "Comma-separated agent IDs (e.g., reviewer,scanner,fixer)")
    .option(
      "--strategy <strategy>",
      "Merge strategy (additive|replace|conflict-flag|newest-wins|majority-wins)",
      "additive",
    )
    .action(async (opts: { name: string; agents: string; strategy: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const agentIds = opts.agents
          .split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        if (agentIds.length === 0) {
          console.error("Error: at least one agent ID is required");
          process.exitCode = 1;
          return;
        }
        const team = await facade.squadCreate({
          name: opts.name,
          agents: agentIds.map((id) => ({ agentId: id, role: "member" })),
          strategy: opts.strategy as "additive",
        });
        console.log(`Squad created: ${team.id}`);
        console.log(`  Name: ${team.name}`);
        console.log(`  Members: ${team.members.length}`);
        console.log(`  Strategy: ${team.strategy}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // mayros kaneru squad run
  squad
    .command("run")
    .description("Run a mission on an existing squad")
    .requiredOption("--squad <id>", "Squad ID")
    .requiredOption("--mission <text>", "Mission description")
    .action(async (opts: { squad: string; mission: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const entry = await facade.squadRun(opts.squad, opts.mission);
        console.log(`Workflow started: ${entry.id}`);
        console.log(`  Name: ${entry.name}`);
        console.log(`  State: ${entry.state}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // mayros kaneru squad status
  squad
    .command("status")
    .description("Get squad status and member details")
    .requiredOption("--squad <id>", "Squad ID")
    .action(async (opts: { squad: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const team = await facade.squadStatus(opts.squad);
        if (!team) {
          console.log("Squad not found.");
          return;
        }
        console.log(`Squad: ${team.name} (${team.id})`);
        console.log(`  Status: ${team.status}`);
        console.log(`  Strategy: ${team.strategy}`);
        console.log(`  Members:`);
        for (const m of team.members) {
          console.log(`    - ${m.agentId} [${m.role}] ${m.status}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // mayros kaneru squad list
  squad
    .command("list")
    .description("List all squads")
    .action(async () => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const teams = await facade.squadList();
        if (teams.length === 0) {
          console.log("No squads found.");
          return;
        }
        console.log(`Squads (${teams.length}):\n`);
        for (const t of teams) {
          console.log(`  ${t.id}  ${t.name}  [${t.status}]  updated: ${t.updatedAt}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru delegate
  // ------------------------------------------------------------------
  kaneru
    .command("delegate")
    .description("Delegate a mission from one agent to another")
    .requiredOption("--from <agentId>", "Source agent ID")
    .requiredOption("--to <agentId>", "Target agent ID")
    .requiredOption("--mission <text>", "Mission to delegate")
    .action(async (opts: { from: string; to: string; mission: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const ctx = await facade.delegate(opts.from, opts.to, opts.mission);
        console.log(`Delegation complete:`);
        console.log(`  From: ${ctx.parentAgentId}`);
        console.log(`  Mission: ${ctx.task}`);
        console.log(`  Context triples: ${ctx.relevantTriples.length}`);
        console.log(`  Related memories: ${ctx.relatedMemories.length}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru consensus
  // ------------------------------------------------------------------
  kaneru
    .command("consensus")
    .description("Run consensus across squad agents on a question")
    .requiredOption("--squad <id>", "Squad ID")
    .requiredOption("--question <text>", "Question or conflict to resolve")
    .option(
      "--strategy <strategy>",
      "Consensus strategy (majority|weighted|arbitrate|pbft-local|leader-score)",
      "weighted",
    )
    .action(async (opts: { squad: string; question: string; strategy: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const result = await facade.consensusResolve({
          squadId: opts.squad,
          question: opts.question,
          strategy: opts.strategy as "weighted",
        });
        console.log(`Consensus result:`);
        console.log(`  Strategy: ${result.strategy}`);
        console.log(`  Resolved: ${result.resolved}`);
        console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`  Resolutions: ${result.resolutions.length}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru route
  // ------------------------------------------------------------------
  kaneru
    .command("route")
    .description("Route a mission to the best agent via Q-learning")
    .requiredOption("--mission <text>", "Mission description")
    .option("--agents <agents>", "Available agent IDs (comma-separated)")
    .option("--path <path>", "File path context for domain detection")
    .action(async (opts: { mission: string; agents?: string; path?: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const available = opts.agents
          ?.split(",")
          .map((a) => a.trim())
          .filter(Boolean);
        const result = await facade.route(opts.mission, available, opts.path);
        console.log(`Routing decision:`);
        console.log(`  Agent: ${result.agentId}`);
        console.log(`  Confidence: ${(result.confidence * 100).toFixed(1)}%`);
        console.log(`  Task type: ${result.taskType}`);
        console.log(`  Complexity: ${result.complexity}`);
        console.log(`  Domain: ${result.domain}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru fuse
  // ------------------------------------------------------------------
  kaneru
    .command("fuse")
    .description("Merge knowledge between two agent namespaces")
    .requiredOption("--source <ns>", "Source namespace")
    .requiredOption("--target <ns>", "Target namespace")
    .option(
      "--strategy <strategy>",
      "Fusion strategy (additive|replace|conflict-flag|newest-wins|majority-wins)",
      "additive",
    )
    .action(async (opts: { source: string; target: string; strategy: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const report = await facade.fuse(opts.source, opts.target, opts.strategy as "additive");
        console.log(`Fusion complete:`);
        console.log(`  Added: ${report.added}`);
        console.log(`  Skipped: ${report.skipped}`);
        console.log(`  Conflicts: ${report.conflicts}`);
        console.log(`  Strategy: ${report.strategy}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru dashboard
  // ------------------------------------------------------------------
  kaneru
    .command("dashboard")
    .description("Show Kaneru dashboard summary")
    .action(async () => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const data = await facade.getDashboard();
        console.log(`Kaneru Dashboard`);
        console.log(`${"=".repeat(40)}`);
        console.log(`  Active squads: ${data.stats.activeSquads}`);
        console.log(`  Q-table size: ${data.stats.qTableSize}`);
        console.log(`  Epsilon: ${data.stats.epsilon.toFixed(3)}`);
        if (data.squads.length > 0) {
          console.log(`\nSquads:`);
          for (const s of data.squads) {
            console.log(`  ${s.id}  ${s.name}  [${s.status}]  members: ${s.memberCount}`);
          }
        }
        if (data.routeTable.length > 0) {
          console.log(`\nRoute Table (top 10):`);
          const sorted = [...data.routeTable].sort((a, b) => b.qValue - a.qValue).slice(0, 10);
          for (const r of sorted) {
            console.log(`  ${r.stateKey} -> ${r.agentId}  Q=${r.qValue.toFixed(3)}`);
          }
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });
}

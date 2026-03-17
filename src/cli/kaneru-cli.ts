/**
 * `mayros kaneru` — Kaneru multi-agent coordination CLI.
 *
 * Provides access to squad management, mission routing, consensus,
 * delegation, knowledge fusion, the Kaneru dashboard, and venture-layer
 * management (ventures, missions, pulse, fuel).
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
 *   venture create  — Create a new venture
 *   venture list    — List all ventures
 *   venture status  — Get venture status
 *   mission create     — Create a mission within a venture
 *   mission list       — List missions for a venture
 *   mission claim      — Claim a mission for an agent run
 *   mission transition — Transition a mission to a new status
 *   pulse register  — Register a pulse schedule for an agent
 *   pulse trigger   — Trigger a pulse event for an agent
 *   pulse list      — List pulse schedules for an agent
 *   fuel summary    — Show fuel consumption summary for a venture
 *   learn profile   — Show learning profiles for an agent
 *   learn top       — Show top agents for a domain and task type
 *   decisions list     — List recent consensus decisions
 *   decisions explain  — Explain a decision with full reasoning
 *   dojo list          — List available venture templates
 *   dojo preview       — Preview a template
 *   dojo install       — Install a template as a new venture
 *   sync               — Sync a venture with P2P peers
 *   peers              — List P2P peers for a venture
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

/** Lazy-load venture-layer managers to avoid heavy imports at CLI parse time. */
async function createVentureManagers(opts: {
  cortexHost?: string;
  cortexPort?: string;
  cortexToken?: string;
}) {
  let CortexClient: typeof import("../../extensions/shared/cortex-client.js").CortexClient;
  let VentureManager: typeof import("../../extensions/kaneru/venture.js").VentureManager;
  let MissionManager: typeof import("../../extensions/kaneru/mission.js").MissionManager;
  let ChainManager: typeof import("../../extensions/kaneru/chain.js").ChainManager;
  let FuelController: typeof import("../../extensions/kaneru/fuel.js").FuelController;
  let PulseScheduler: typeof import("../../extensions/kaneru/pulse.js").PulseScheduler;
  try {
    ({ CortexClient } = await import("../../extensions/shared/cortex-client.js"));
    ({ VentureManager } = await import("../../extensions/kaneru/venture.js"));
    ({ MissionManager } = await import("../../extensions/kaneru/mission.js"));
    ({ ChainManager } = await import("../../extensions/kaneru/chain.js"));
    ({ FuelController } = await import("../../extensions/kaneru/fuel.js"));
    ({ PulseScheduler } = await import("../../extensions/kaneru/pulse.js"));
  } catch {
    throw new Error("Failed to load Kaneru venture modules. Run `pnpm build` first.");
  }

  const host = opts.cortexHost ?? "127.0.0.1";
  const port = typeof opts.cortexPort === "string" ? parseInt(opts.cortexPort, 10) : 19090;
  const client = new CortexClient({ host, port, authToken: opts.cortexToken });
  const ns = "mayros";
  const vm = new VentureManager(client, ns);

  return {
    client,
    venture: vm,
    mission: new MissionManager(client, ns, vm),
    chain: new ChainManager(client, ns),
    fuel: new FuelController(client, ns),
    pulse: new PulseScheduler(client, ns),
    destroy() {
      client.destroy();
    },
  };
}

/** Lazy-load KaneruFacade to avoid heavy imports at CLI parse time. */
async function createFacade(opts: {
  cortexHost?: string;
  cortexPort?: string;
  cortexToken?: string;
}) {
  let mod: { KaneruFacade: typeof import("../../extensions/agent-mesh/kaneru-facade.js").KaneruFacade };
  try {
    mod = await import("../../extensions/agent-mesh/kaneru-facade.js");
  } catch {
    throw new Error("Failed to load Kaneru module. Run `pnpm build` first.");
  }
  return new mod.KaneruFacade({
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

  // ------------------------------------------------------------------
  // mayros kaneru venture
  // ------------------------------------------------------------------
  const venture = kaneru.command("venture").description("Manage Kaneru ventures");

  // mayros kaneru venture create
  venture
    .command("create")
    .description("Create a new venture")
    .requiredOption("--name <name>", "Venture name")
    .requiredOption("--prefix <prefix>", "Short prefix for the venture")
    .requiredOption("--directive <text>", "Venture directive / objective")
    .option("--fuel-limit <cents>", "Fuel limit in cents")
    .action(async (opts: { name: string; prefix: string; directive: string; fuelLimit?: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const v = await mgrs.venture.create({
          name: opts.name,
          prefix: opts.prefix,
          directive: opts.directive,
          fuelLimit: opts.fuelLimit ? parseInt(opts.fuelLimit, 10) : undefined,
        });
        console.log(`Venture created: ${v.id}`);
        console.log(`  Name: ${v.name}`);
        console.log(`  Prefix: ${v.prefix}`);
        console.log(`  Directive: ${v.directive}`);
        if (v.fuelLimit !== undefined) {
          console.log(`  Fuel limit: ${v.fuelLimit} cents`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // mayros kaneru venture list
  venture
    .command("list")
    .description("List all ventures")
    .action(async () => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const ventures = await mgrs.venture.list();
        if (ventures.length === 0) {
          console.log("No ventures found.");
          return;
        }
        console.log(`Ventures (${ventures.length}):\n`);
        for (const v of ventures) {
          console.log(`  ${v.id}  ${v.name}  [${v.prefix}]  status: ${v.status}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // mayros kaneru venture status
  venture
    .command("status")
    .description("Get venture status")
    .requiredOption("--venture <id>", "Venture ID")
    .action(async (opts: { venture: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const v = await mgrs.venture.get(opts.venture);
        if (!v) {
          console.log("Venture not found.");
          return;
        }
        console.log(`Venture: ${v.name} (${v.id})`);
        console.log(`  Prefix: ${v.prefix}`);
        console.log(`  Status: ${v.status}`);
        console.log(`  Directive: ${v.directive}`);
        console.log(`  Fuel limit: ${v.fuelLimit} cents`);
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru mission
  // ------------------------------------------------------------------
  const mission = kaneru.command("mission").description("Manage Kaneru missions within ventures");

  // mayros kaneru mission create
  mission
    .command("create")
    .description("Create a mission within a venture")
    .requiredOption("--venture <id>", "Venture ID")
    .requiredOption("--title <text>", "Mission title")
    .option("--priority <p>", "Mission priority (e.g., low, normal, high, critical)")
    .option("--directive <did>", "Directive ID to associate with")
    .action(
      async (opts: { venture: string; title: string; priority?: string; directive?: string }) => {
        const parent = kaneru.opts();
        const mgrs = await createVentureManagers(parent);
        try {
          const m = await mgrs.mission.create({
            ventureId: opts.venture,
            title: opts.title,
            priority: opts.priority as "medium" | undefined,
            directiveId: opts.directive,
          });
          console.log(`Mission created: ${m.id}`);
          console.log(`  Title: ${m.title}`);
          console.log(`  Venture: ${m.ventureId}`);
          console.log(`  Status: ${m.status}`);
          if (m.priority) {
            console.log(`  Priority: ${m.priority}`);
          }
        } catch (err) {
          handleError(err);
        } finally {
          mgrs.destroy();
        }
      },
    );

  // mayros kaneru mission list
  mission
    .command("list")
    .description("List missions for a venture")
    .requiredOption("--venture <id>", "Venture ID")
    .option("--status <s>", "Filter by status")
    .action(async (opts: { venture: string; status?: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const missions = await mgrs.mission.list(opts.venture, opts.status ? { status: opts.status as "queued" } : undefined);
        if (missions.length === 0) {
          console.log("No missions found.");
          return;
        }
        console.log(`Missions (${missions.length}):\n`);
        for (const m of missions) {
          console.log(`  ${m.id}  ${m.title}  [${m.status}]  priority: ${m.priority ?? "—"}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // mayros kaneru mission claim
  mission
    .command("claim")
    .description("Claim a mission for an agent run")
    .requiredOption("--mission <id>", "Mission ID")
    .requiredOption("--agent <aid>", "Agent ID claiming the mission")
    .requiredOption("--run <rid>", "Run ID for the claim")
    .action(async (opts: { mission: string; agent: string; run: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const result = await mgrs.mission.claim(opts.mission, opts.agent, opts.run);
        if (!result.ok) {
          console.error(`Claim failed: ${result.reason}`);
          process.exitCode = 1;
          return;
        }
        console.log(`Mission claimed: ${result.mission.id}`);
        console.log(`  Identifier: ${result.mission.identifier}`);
        console.log(`  Agent: ${result.mission.claimedBy}`);
        console.log(`  Status: ${result.mission.status}`);
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // mayros kaneru mission transition
  mission
    .command("transition")
    .description("Transition a mission to a new status")
    .requiredOption("--mission <id>", "Mission ID")
    .requiredOption("--status <s>", "New status")
    .requiredOption("--run <rid>", "Run ID performing the transition")
    .action(async (opts: { mission: string; status: string; run: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const result = await mgrs.mission.transition(opts.mission, opts.status as "queued", opts.run);
        console.log(`Mission transitioned: ${result.id}`);
        console.log(`  Identifier: ${result.identifier}`);
        console.log(`  New status: ${result.status}`);
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru pulse
  // ------------------------------------------------------------------
  const pulse = kaneru.command("pulse").description("Manage Kaneru agent pulse schedules");

  // mayros kaneru pulse register
  pulse
    .command("register")
    .description("Register a pulse schedule for an agent")
    .requiredOption("--agent <id>", "Agent ID")
    .requiredOption("--venture <vid>", "Venture ID")
    .requiredOption("--interval <interval>", "Pulse interval (e.g., 30s, 5m, 1h)")
    .option("--triggers <t1,t2>", "Comma-separated trigger types")
    .action(
      async (opts: { agent: string; venture: string; interval: string; triggers?: string }) => {
        const parent = kaneru.opts();
        const mgrs = await createVentureManagers(parent);
        try {
          const triggerList = opts.triggers
            ?.split(",")
            .map((t) => t.trim())
            .filter(Boolean) as import("../../extensions/kaneru/pulse.js").PulseTrigger[] | undefined;
          await mgrs.pulse.register(opts.agent, opts.venture, {
            interval: opts.interval,
            triggers: triggerList ?? ["timer"],
          });
          console.log(`Pulse registered:`);
          console.log(`  Agent: ${opts.agent}`);
          console.log(`  Venture: ${opts.venture}`);
          console.log(`  Interval: ${opts.interval}`);
          if (triggerList && triggerList.length > 0) {
            console.log(`  Triggers: ${triggerList.join(", ")}`);
          }
        } catch (err) {
          handleError(err);
        } finally {
          mgrs.destroy();
        }
      },
    );

  // mayros kaneru pulse trigger
  pulse
    .command("trigger")
    .description("Trigger a pulse event for an agent")
    .requiredOption("--agent <id>", "Agent ID")
    .requiredOption("--venture <vid>", "Venture ID")
    .requiredOption("--trigger <type>", "Trigger type to fire")
    .action(async (opts: { agent: string; venture: string; trigger: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const result = await mgrs.pulse.trigger(opts.agent, opts.venture, opts.trigger as "timer");
        console.log(`Pulse triggered:`);
        console.log(`  ID: ${result.id}`);
        console.log(`  Agent: ${result.agentId}`);
        console.log(`  Trigger: ${result.trigger}`);
        console.log(`  Status: ${result.status}`);
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // mayros kaneru pulse list
  pulse
    .command("list")
    .description("List pulse schedules for an agent")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (opts: { agent: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const queued = await mgrs.pulse.listQueued(opts.agent);
        if (queued.length === 0) {
          console.log("No queued pulses found.");
          return;
        }
        console.log(`Queued pulses (${queued.length}):\n`);
        for (const p of queued) {
          console.log(`  ${p.id}  trigger: ${p.trigger}  coalesced: ${p.coalescedCount}  requested: ${p.requestedAt}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru fuel
  // ------------------------------------------------------------------
  const fuel = kaneru.command("fuel").description("Manage Kaneru fuel consumption");

  // mayros kaneru fuel summary
  fuel
    .command("summary")
    .description("Show fuel consumption summary for a venture")
    .requiredOption("--venture <id>", "Venture ID")
    .action(async (opts: { venture: string }) => {
      const parent = kaneru.opts();
      const mgrs = await createVentureManagers(parent);
      try {
        const v = await mgrs.venture.get(opts.venture);
        const fuelLimit = v?.fuelLimit ?? 0;
        const summary = await mgrs.fuel.summary(opts.venture, fuelLimit);
        console.log(`Fuel Summary — Venture: ${summary.ventureId}`);
        console.log(`${"=".repeat(40)}`);
        console.log(`  Total spent: ${summary.totalCents} cents`);
        console.log(`  Fuel limit: ${summary.fuelLimit || "unlimited"}`);
        console.log(`  Remaining: ${summary.fuelLimit ? `${summary.remaining} cents` : "unlimited"}`);
        console.log(`  Burn rate: ${summary.burnRate} cents/hour`);
        if (summary.byAgent.length > 0) {
          console.log(`\n  By agent:`);
          for (const a of summary.byAgent) {
            console.log(`    ${a.agentId}: ${a.totalCents} cents`);
          }
        }
      } catch (err) {
        handleError(err);
      } finally {
        mgrs.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru learn
  // ------------------------------------------------------------------
  const learn = kaneru.command("learn").description("Agent learning profiles and expertise");

  // mayros kaneru learn profile --agent <id>
  learn
    .command("profile")
    .description("Show learning profiles for an agent")
    .requiredOption("--agent <id>", "Agent ID")
    .action(async (opts: { agent: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const profiles = await facade.getAgentExpertise(opts.agent);
        if (profiles.length === 0) {
          console.log(`No learning profiles found for agent: ${opts.agent}`);
          return;
        }
        console.log(`Learning profiles for ${opts.agent} (${profiles.length}):\n`);
        for (const p of profiles) {
          console.log(`  ${p.domain}:${p.taskType}`);
          console.log(`    Expertise: ${(p.expertise * 100).toFixed(1)}%`);
          console.log(`    Success rate: ${(p.successRate * 100).toFixed(1)}%`);
          console.log(`    Missions: ${p.missionCount}`);
          console.log(`    Avg duration: ${p.avgDurationMs}ms`);
          console.log(`    Last updated: ${p.lastUpdated}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // mayros kaneru learn top --domain <d> --task-type <t>
  learn
    .command("top")
    .description("Show top agents for a domain and task type")
    .requiredOption("--domain <d>", "Domain (e.g. typescript, python)")
    .requiredOption("--task-type <t>", "Task type (e.g. code-review, debugging)")
    .option("--limit <n>", "Max results", "10")
    .action(async (opts: { domain: string; taskType: string; limit: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const limit = parseInt(opts.limit, 10) || 10;
        const profiles = await facade.topAgentsFor(opts.domain, opts.taskType, limit);
        if (profiles.length === 0) {
          console.log(`No agents found for ${opts.domain}:${opts.taskType}`);
          return;
        }
        console.log(`Top agents for ${opts.domain}:${opts.taskType} (${profiles.length}):\n`);
        for (const p of profiles) {
          console.log(`  ${p.agentId}  expertise: ${(p.expertise * 100).toFixed(1)}%  success: ${(p.successRate * 100).toFixed(1)}%  missions: ${p.missionCount}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru decisions
  // ------------------------------------------------------------------
  const decisions = kaneru.command("decisions").description("Consensus decision history");

  // mayros kaneru decisions list [--venture <id>] [--limit N]
  decisions
    .command("list")
    .description("List recent decisions")
    .option("--venture <id>", "Filter by venture")
    .option("--limit <n>", "Max results", "20")
    .action(async (opts: { venture?: string; limit: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const limit = parseInt(opts.limit, 10) || 20;
        const records = await facade.queryDecisions({ ventureId: opts.venture, limit });
        if (records.length === 0) {
          console.log("No decisions found.");
          return;
        }
        console.log(`Decisions (${records.length}):\n`);
        for (const d of records) {
          console.log(`  ${d.id}  [${d.strategy}]  confidence: ${(d.confidence * 100).toFixed(1)}%`);
          console.log(`    Question: ${d.question}`);
          console.log(`    Outcome: ${d.resolvedValue}`);
          console.log(`    Decided: ${d.decidedAt}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // mayros kaneru decisions explain --decision <id>
  decisions
    .command("explain")
    .description("Explain a decision with full reasoning")
    .requiredOption("--decision <id>", "Decision ID")
    .action(async (opts: { decision: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const explanation = await facade.explainDecision(opts.decision);
        console.log(explanation);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru dojo
  // ------------------------------------------------------------------
  const dojo = kaneru.command("dojo").description("Kaneru Dojo — venture templates");

  // mayros kaneru dojo list
  dojo
    .command("list")
    .description("List available venture templates")
    .action(async () => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const templates = await facade.dojoList();
        if (templates.length === 0) {
          console.log("No templates found.");
          return;
        }
        console.log(`Templates (${templates.length}):\n`);
        for (const t of templates) {
          console.log(`  ${t.id}  ${t.name}`);
          console.log(`    ${t.description}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // mayros kaneru dojo preview --template <id>
  dojo
    .command("preview")
    .description("Preview a venture template")
    .requiredOption("--template <id>", "Template ID")
    .action(async (opts: { template: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const preview = await facade.dojoPreview(opts.template);
        console.log(preview);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // mayros kaneru dojo install --template <id> --name <name>
  dojo
    .command("install")
    .description("Install a template as a new venture")
    .requiredOption("--template <id>", "Template ID")
    .requiredOption("--name <name>", "Venture name")
    .action(async (opts: { template: string; name: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const result = await facade.dojoInstall(opts.template, opts.name);
        console.log(`Template installed:`);
        console.log(`  Venture: ${result.ventureId}`);
        console.log(`  Name: ${result.ventureName}`);
        console.log(`  Prefix: ${result.prefix}`);
        console.log(`  Agents deployed: ${result.agentsDeployed}`);
        console.log(`  Directives created: ${result.directivesCreated}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru sync
  // ------------------------------------------------------------------
  kaneru
    .command("sync")
    .description("Sync venture with P2P peers")
    .requiredOption("--venture <id>", "Venture ID")
    .action(async (opts: { venture: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const result = await facade.syncVenture(opts.venture);
        console.log(`Sync complete:`);
        console.log(`  Venture: ${result.ventureId}`);
        console.log(`  Actions synced: ${result.actionsSynced}`);
        console.log(`  Triples added: ${result.triplesAdded}`);
        console.log(`  Conflicts: ${result.conflicts}`);
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kaneru peers
  // ------------------------------------------------------------------
  kaneru
    .command("peers")
    .description("List P2P peers for a venture")
    .requiredOption("--venture <id>", "Venture ID")
    .action(async (opts: { venture: string }) => {
      const parent = kaneru.opts();
      const facade = await createFacade(parent);
      try {
        const peers = await facade.listPeers(opts.venture);
        if (peers.length === 0) {
          console.log("No peers found.");
          return;
        }
        console.log(`Peers (${peers.length}):\n`);
        for (const p of peers) {
          console.log(`  ${p}`);
        }
      } catch (err) {
        handleError(err);
      } finally {
        facade.destroy();
      }
    });
}

/**
 * `mayros dashboard` — Team Dashboard CLI.
 *
 * Aggregated views of teams, agents, mailbox stats, and trace metrics.
 *
 * Subcommands:
 *   team <teamId>     — Show dashboard for a specific team
 *   summary           — Show all active teams overview
 *   agent <agentId>   — Show agent activity across teams
 */

import type { Command } from "commander";
import { parseCortexConfig } from "../../extensions/shared/cortex-config.js";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import { AgentMailbox } from "../../extensions/agent-mesh/agent-mailbox.js";
import { TeamManager } from "../../extensions/agent-mesh/team-manager.js";
import { TeamDashboardService } from "../../extensions/agent-mesh/team-dashboard.js";
import { loadConfig } from "../config/config.js";

// ============================================================================
// Cortex resolution (reads from agent-mesh plugin config)
// ============================================================================

function resolveCortexClient(opts: { host?: string; port?: string; token?: string }): CortexClient {
  const host = opts.host ?? process.env.CORTEX_HOST ?? "127.0.0.1";
  const port = opts.port
    ? Number.parseInt(opts.port, 10)
    : process.env.CORTEX_PORT
      ? Number.parseInt(process.env.CORTEX_PORT, 10)
      : 8080;
  const authToken = opts.token ?? process.env.CORTEX_AUTH_TOKEN ?? undefined;

  if (!opts.host && !opts.port && !process.env.CORTEX_HOST && !process.env.CORTEX_PORT) {
    try {
      const cfg = loadConfig();
      const pluginCfg = cfg.plugins?.entries?.["agent-mesh"]?.config as
        | { cortex?: { host?: string; port?: number; authToken?: string } }
        | undefined;
      if (pluginCfg?.cortex) {
        const cortex = parseCortexConfig(pluginCfg.cortex);
        return new CortexClient(cortex);
      }
    } catch {
      // Config not available — use defaults
    }
  }

  return new CortexClient(parseCortexConfig({ host, port, authToken }));
}

function resolveNamespace(): string {
  try {
    const cfg = loadConfig();
    const pluginCfg = cfg.plugins?.entries?.["agent-mesh"]?.config as
      | { agentNamespace?: string }
      | undefined;
    return pluginCfg?.agentNamespace ?? "mayros";
  } catch {
    return "mayros";
  }
}

function resolveDashboard(client: CortexClient, ns: string): TeamDashboardService {
  const mailbox = new AgentMailbox(client, ns);
  // TeamManager requires nsMgr and fusion — create minimal instances for read-only dashboard.
  // The dashboard only calls getTeam/listTeams which need client + ns.
  const teamMgr = new TeamManager(
    client,
    ns,
    null, // nsMgr: not needed for getTeam/listTeams
    null, // fusion: not needed for getTeam/listTeams
    { maxTeamSize: 8, defaultStrategy: "additive", workflowTimeout: 600 },
  );
  return new TeamDashboardService(teamMgr, mailbox, null, ns);
}

// ============================================================================
// Registration
// ============================================================================

export function registerDashboardCli(program: Command) {
  const db = program
    .command("team-dashboard")
    .description("Team dashboard — real-time agent status and activity")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ---- team ----

  db.command("team")
    .description("Show dashboard for a specific team")
    .argument("<teamId>", "Team ID")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (teamId, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot load dashboard.");
        return;
      }

      const dashboard = resolveDashboard(client, ns);
      const d = await dashboard.getTeamDashboard(teamId);

      if (!d) {
        console.log(`Team ${teamId} not found.`);
        return;
      }

      if (opts.format === "json") {
        console.log(JSON.stringify(d, null, 2));
        return;
      }

      console.log(`Dashboard: "${d.teamName}" (${d.teamId})`);
      console.log(`  status: ${d.teamStatus}`);
      console.log(`  strategy: ${d.strategy}`);
      console.log(`  created: ${d.createdAt}`);
      console.log(`  updated: ${d.updatedAt}`);
      console.log(`  mail: ${d.mailboxSummary.total} total, ${d.mailboxSummary.unread} unread`);
      console.log(`  members:`);
      for (const m of d.members) {
        const events = m.totalEvents > 0 ? ` events:${m.totalEvents}` : "";
        const errors = m.errors > 0 ? ` errors:${m.errors}` : "";
        const unread = m.unreadMessages > 0 ? ` unread:${m.unreadMessages}` : "";
        console.log(`    - ${m.agentId} (${m.role}): ${m.status}${events}${errors}${unread}`);
      }
    });

  // ---- summary ----

  db.command("summary")
    .description("Show all active teams overview")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot load dashboard.");
        return;
      }

      const dashboard = resolveDashboard(client, ns);
      const s = await dashboard.getSummary();

      if (opts.format === "json") {
        console.log(JSON.stringify(s, null, 2));
        return;
      }

      if (s.activeTeams === 0) {
        console.log("No active teams.");
        return;
      }

      console.log(`Dashboard Summary:`);
      console.log(`  active teams: ${s.activeTeams}`);
      console.log(`  total agents: ${s.totalAgents}`);
      console.log(`  total unread: ${s.totalUnread}`);
      console.log(`  total errors: ${s.totalErrors}`);
      console.log();
      for (const t of s.teams) {
        console.log(
          `  ${t.teamId}: "${t.teamName}" [${t.teamStatus}] — ${t.members.length} members`,
        );
      }
    });

  // ---- agent ----

  db.command("agent")
    .description("Show agent activity across teams")
    .argument("<agentId>", "Agent ID")
    .option("--format <format>", "Output format (terminal|json)", "terminal")
    .action(async (agentId, opts, cmd) => {
      const parentOpts = cmd.parent.opts();
      const client = resolveCortexClient({
        host: parentOpts.cortexHost,
        port: parentOpts.cortexPort,
        token: parentOpts.cortexToken,
      });
      const ns = resolveNamespace();

      const healthy = await client.isHealthy();
      if (!healthy) {
        console.log("Cortex offline. Cannot load agent activity.");
        return;
      }

      const dashboard = resolveDashboard(client, ns);
      const act = await dashboard.getAgentActivity(agentId);

      if (opts.format === "json") {
        console.log(JSON.stringify(act, null, 2));
        return;
      }

      console.log(`Agent Activity: ${act.agentId}`);
      if (act.teams.length === 0) {
        console.log("  Not a member of any team.");
      } else {
        console.log(`  teams (${act.teams.length}):`);
        for (const t of act.teams) {
          console.log(`    - ${t.teamId}: "${t.teamName}" role:${t.role} status:${t.status}`);
        }
      }
      console.log(`  mailbox: ${act.mailboxStats.total} total, ${act.mailboxStats.unread} unread`);
      if (act.traceStats) {
        console.log(
          `  trace: ${act.traceStats.totalEvents} events, ${act.traceStats.errors} errors`,
        );
      }
    });
}

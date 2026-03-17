/**
 * MCP-friendly Kaneru venture tools.
 *
 * Exposes 16 tools for venture creation, mission lifecycle, fuel tracking,
 * pulse scheduling, learning profiles, decision history, Dojo templates,
 * distributed sync, and terminal execution via the venture layer managers.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";
import { CortexClient } from "../shared/cortex-client.js";
import type { CortexConfig } from "../shared/cortex-client.js";
import { VentureManager } from "../kaneru/venture.js";
import { MissionManager } from "../kaneru/mission.js";
import { FuelController } from "../kaneru/fuel.js";
import { PulseScheduler } from "../kaneru/pulse.js";
import { LearningProfileManager } from "../kaneru/learning-profiles.js";
import { DecisionHistory } from "../kaneru/decision-history.js";
import { DojoService } from "../kaneru/dojo.js";
import { ChainManager } from "../kaneru/chain.js";
import { DirectiveManager } from "../kaneru/directives.js";
import { DistributedVentureManager } from "../kaneru/distributed.js";
import type { MissionStatus } from "../kaneru/mission.js";
import type { PulseTrigger } from "../kaneru/pulse.js";

export type VentureToolDeps = {
  cortexBaseUrl: string;
  namespace?: string;
  authToken?: string;
};

type ToolContent = { content: Array<{ type: "text"; text: string }> };

function textResult(text: string): ToolContent {
  return { content: [{ type: "text" as const, text }] };
}

const VALID_MISSION_STATUSES = new Set(["queued", "ready", "active", "review", "complete", "abandoned"]);
const VALID_PRIORITIES = new Set(["critical", "high", "medium", "low"]);
const VALID_TRIGGERS = new Set(["timer", "assignment", "mention", "mission-ready", "escalation"]);

function validateEnum<T extends string>(value: string | undefined, valid: Set<string>, label: string): T | undefined {
  if (value === undefined) return undefined;
  if (!valid.has(value)) throw new Error(`Invalid ${label}: "${value}". Valid: ${[...valid].join(", ")}`);
  return value as T;
}

/**
 * Parse a cortexBaseUrl (e.g. "http://127.0.0.1:19090") into host and port.
 */
function parseBaseUrl(url: string): { host: string; port: number } {
  try {
    const parsed = new URL(url);
    return {
      host: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 19090,
    };
  } catch {
    return { host: "127.0.0.1", port: 19090 };
  }
}

export function createVentureTools(deps: VentureToolDeps): AdaptableTool[] & { destroy(): void } {
  let client: CortexClient | null = null;
  let ventureManager: VentureManager | null = null;
  let missionManager: MissionManager | null = null;
  let fuelController: FuelController | null = null;
  let pulseScheduler: PulseScheduler | null = null;
  let learningProfiles: LearningProfileManager | null = null;
  let decisionHistory: DecisionHistory | null = null;
  let dojoService: DojoService | null = null;
  let distributedManager: DistributedVentureManager | null = null;

  function getClient(): CortexClient {
    if (!client) {
      const { host, port } = parseBaseUrl(deps.cortexBaseUrl);
      const config: CortexConfig = { host, port, authToken: deps.authToken };
      client = new CortexClient(config);
    }
    return client;
  }

  function getNs(): string {
    return deps.namespace ?? "mayros";
  }

  function getVentureManager(): VentureManager {
    if (!ventureManager) {
      ventureManager = new VentureManager(getClient(), getNs());
    }
    return ventureManager;
  }

  function getMissionManager(): MissionManager {
    if (!missionManager) {
      missionManager = new MissionManager(getClient(), getNs(), getVentureManager());
    }
    return missionManager;
  }

  function getFuelController(): FuelController {
    if (!fuelController) {
      fuelController = new FuelController(getClient(), getNs());
    }
    return fuelController;
  }

  function getPulseScheduler(): PulseScheduler {
    if (!pulseScheduler) {
      pulseScheduler = new PulseScheduler(getClient(), getNs());
    }
    return pulseScheduler;
  }

  function getLearningProfiles(): LearningProfileManager {
    if (!learningProfiles) {
      learningProfiles = new LearningProfileManager(getClient(), getNs());
    }
    return learningProfiles;
  }

  function getDecisionHistory(): DecisionHistory {
    if (!decisionHistory) {
      decisionHistory = new DecisionHistory(getClient(), getNs());
    }
    return decisionHistory;
  }

  function getDojoService(): DojoService {
    if (!dojoService) {
      const vm = getVentureManager();
      const chain = new ChainManager(getClient(), getNs());
      const directives = new DirectiveManager(getClient(), getNs());
      dojoService = new DojoService(getClient(), getNs(), vm, chain, directives);
    }
    return dojoService;
  }

  function getDistributedManager(): DistributedVentureManager {
    if (!distributedManager) {
      distributedManager = new DistributedVentureManager(getClient(), getNs());
    }
    return distributedManager;
  }

  const tools: AdaptableTool[] = [
    // ------------------------------------------------------------------
    // 1. kaneru_venture_create
    // ------------------------------------------------------------------
    {
      name: "kaneru_venture_create",
      description:
        "Create a new Kaneru venture. A venture groups missions, agents, " +
        "and fuel budgets under a shared directive.",
      parameters: Type.Object({
        name: Type.String({ description: "Venture name" }),
        prefix: Type.String({
          description: "Short prefix for mission identifiers (max 10 chars, e.g. 'SEC')",
        }),
        directive: Type.String({ description: "Top-level directive for the venture" }),
        fuelLimit: Type.Optional(
          Type.Number({ description: "Fuel limit in cents (0 = unlimited)" }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const mgr = getVentureManager();
          const venture = await mgr.create({
            name: params.name as string,
            prefix: params.prefix as string,
            directive: params.directive as string,
            fuelLimit: (params.fuelLimit as number | undefined) ?? 0,
          });
          return textResult(
            `Venture created:\n` +
              `  ID: ${venture.id}\n` +
              `  Name: ${venture.name}\n` +
              `  Prefix: ${venture.prefix}\n` +
              `  Directive: ${venture.directive}\n` +
              `  Fuel limit: ${venture.fuelLimit} cents\n` +
              `  Status: ${venture.status}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 2. kaneru_venture_list
    // ------------------------------------------------------------------
    {
      name: "kaneru_venture_list",
      description:
        "List all Kaneru ventures with their status, prefix, and fuel limits.",
      parameters: Type.Object({}),
      execute: async (_callId: string, _params: Record<string, unknown>) => {
        try {
          const mgr = getVentureManager();
          const ventures = await mgr.list();
          if (ventures.length === 0) {
            return textResult("No ventures found.");
          }
          const lines = ventures.map(
            (v) =>
              `  [${v.status}] ${v.prefix} — ${v.name} (id: ${v.id}, fuel: ${v.fuelLimit}c)`,
          );
          return textResult(
            `${ventures.length} venture(s):\n${lines.join("\n")}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 3. kaneru_mission_create
    // ------------------------------------------------------------------
    {
      name: "kaneru_mission_create",
      description:
        "Create a new mission within a venture. Missions are the work units " +
        "agents execute. Auto-assigns an identifier from the venture prefix.",
      parameters: Type.Object({
        ventureId: Type.String({ description: "Venture ID to create the mission in" }),
        title: Type.String({ description: "Mission title" }),
        description: Type.Optional(
          Type.String({ description: "Detailed mission description" }),
        ),
        priority: Type.Optional(
          Type.String({
            description: "Priority: critical, high, medium, low (default: medium)",
          }),
        ),
        directiveId: Type.Optional(
          Type.String({ description: "Directive ID this mission fulfills" }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const mgr = getMissionManager();
          const mission = await mgr.create({
            ventureId: params.ventureId as string,
            title: params.title as string,
            description: (params.description as string | undefined) ?? undefined,
            priority: validateEnum(params.priority as string | undefined, VALID_PRIORITIES, "priority"),
            directiveId: (params.directiveId as string | undefined) ?? undefined,
          });
          return textResult(
            `Mission created:\n` +
              `  ID: ${mission.id}\n` +
              `  Identifier: ${mission.identifier}\n` +
              `  Title: ${mission.title}\n` +
              `  Status: ${mission.status}\n` +
              `  Priority: ${mission.priority}\n` +
              `  Venture: ${mission.ventureId}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 4. kaneru_mission_claim
    // ------------------------------------------------------------------
    {
      name: "kaneru_mission_claim",
      description:
        "Claim a mission for execution. Uses atomic CAS semantics to prevent " +
        "concurrent claims. Mission must be in 'ready' status.",
      parameters: Type.Object({
        missionId: Type.String({ description: "Mission ID to claim" }),
        agentId: Type.String({ description: "Agent ID claiming the mission" }),
        runId: Type.String({ description: "Current run ID for claim tracking" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const mgr = getMissionManager();
          const result = await mgr.claim(
            params.missionId as string,
            params.agentId as string,
            params.runId as string,
          );
          if (!result.ok) {
            return textResult(`Claim failed: ${result.reason}`);
          }
          return textResult(
            `Mission claimed:\n` +
              `  ID: ${result.mission.id}\n` +
              `  Identifier: ${result.mission.identifier}\n` +
              `  Claimed by: ${result.mission.claimedBy}\n` +
              `  Status: ${result.mission.status}\n` +
              `  Run: ${result.mission.claimRun}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 5. kaneru_mission_list
    // ------------------------------------------------------------------
    {
      name: "kaneru_mission_list",
      description:
        "List missions for a venture with optional status filter.",
      parameters: Type.Object({
        ventureId: Type.String({ description: "Venture ID to list missions for" }),
        status: Type.Optional(
          Type.String({
            description:
              "Filter by status: queued, ready, active, review, complete, abandoned",
          }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const mgr = getMissionManager();
          const status = validateEnum<MissionStatus>(params.status as string | undefined, VALID_MISSION_STATUSES, "status");
          const missions = await mgr.list(params.ventureId as string, { status });
          if (missions.length === 0) {
            const filterNote = status ? ` with status "${status}"` : "";
            return textResult(`No missions found${filterNote}.`);
          }
          const lines = missions.map(
            (m) =>
              `  [${m.status}] ${m.identifier} — ${m.title} (${m.priority})` +
              (m.claimedBy ? ` claimed by ${m.claimedBy}` : ""),
          );
          return textResult(
            `${missions.length} mission(s):\n${lines.join("\n")}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 6. kaneru_mission_transition
    // ------------------------------------------------------------------
    {
      name: "kaneru_mission_transition",
      description:
        "Transition a mission to a new status. Validates state machine: " +
        "queued->ready->active->review->complete. Also supports abandoned.",
      parameters: Type.Object({
        missionId: Type.String({ description: "Mission ID to transition" }),
        status: Type.String({
          description:
            "Target status: queued, ready, active, review, complete, abandoned",
        }),
        runId: Type.String({ description: "Current run ID for authorization" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const mgr = getMissionManager();
          const validatedStatus = validateEnum<MissionStatus>(params.status as string, VALID_MISSION_STATUSES, "status")!;
          const mission = await mgr.transition(
            params.missionId as string,
            validatedStatus,
            params.runId as string,
          );
          return textResult(
            `Mission transitioned:\n` +
              `  ID: ${mission.id}\n` +
              `  Identifier: ${mission.identifier}\n` +
              `  Status: ${mission.status}\n` +
              `  Claimed by: ${mission.claimedBy ?? "none"}\n` +
              `  Completed at: ${mission.completedAt ?? "n/a"}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 7. kaneru_fuel_summary
    // ------------------------------------------------------------------
    {
      name: "kaneru_fuel_summary",
      description:
        "Get fuel consumption summary for a venture including total spend, " +
        "burn rate, and per-agent/per-mission breakdowns.",
      parameters: Type.Object({
        ventureId: Type.String({ description: "Venture ID to get fuel summary for" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const fuel = getFuelController();
          const vm = getVentureManager();
          const ventureId = params.ventureId as string;

          // Get venture to read fuel limit
          const venture = await vm.get(ventureId);
          const fuelLimit = venture?.fuelLimit ?? 0;

          const summary = await fuel.summary(ventureId, fuelLimit);

          const agentLines =
            summary.byAgent.length > 0
              ? summary.byAgent
                  .map((a) => `    ${a.agentId}: ${a.totalCents}c`)
                  .join("\n")
              : "    (none)";

          const missionLines =
            summary.byMission.length > 0
              ? summary.byMission
                  .map((m) => `    ${m.missionId}: ${m.totalCents}c`)
                  .join("\n")
              : "    (none)";

          return textResult(
            `Fuel summary for venture "${ventureId}":\n` +
              `  Total spent: ${summary.totalCents}c\n` +
              `  Fuel limit: ${summary.fuelLimit}c\n` +
              `  Remaining: ${summary.remaining}c\n` +
              `  Burn rate: ${summary.burnRate}c/hour\n` +
              `  By agent:\n${agentLines}\n` +
              `  By mission:\n${missionLines}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 8. kaneru_pulse_trigger
    // ------------------------------------------------------------------
    {
      name: "kaneru_pulse_trigger",
      description:
        "Trigger a pulse for an agent. If coalescing is enabled and a queued " +
        "pulse exists, the trigger merges into it instead of creating a new one.",
      parameters: Type.Object({
        agentId: Type.String({ description: "Agent ID to trigger pulse for" }),
        ventureId: Type.String({ description: "Venture context for the pulse" }),
        trigger: Type.String({
          description:
            "Trigger type: timer, assignment, mention, mission-ready, escalation",
        }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const scheduler = getPulseScheduler();
          const validatedTrigger = validateEnum<PulseTrigger>(params.trigger as string, VALID_TRIGGERS, "trigger")!;
          const pulse = await scheduler.trigger(
            params.agentId as string,
            params.ventureId as string,
            validatedTrigger,
          );
          return textResult(
            `Pulse triggered:\n` +
              `  ID: ${pulse.id}\n` +
              `  Agent: ${pulse.agentId}\n` +
              `  Venture: ${pulse.ventureId}\n` +
              `  Trigger: ${pulse.trigger}\n` +
              `  Status: ${pulse.status}\n` +
              `  Coalesced count: ${pulse.coalescedCount}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 9. kaneru_learn_profile
    // ------------------------------------------------------------------
    {
      name: "kaneru_learn_profile",
      description:
        "Get learning profiles for an agent showing expertise across " +
        "domain×taskType combinations, success rates, and mission counts.",
      parameters: Type.Object({
        agentId: Type.String({ description: "Agent ID to get profiles for" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const mgr = getLearningProfiles();
          const profiles = await mgr.getAgentProfiles(params.agentId as string);
          if (profiles.length === 0) {
            return textResult(`No learning profiles found for agent: ${params.agentId}`);
          }
          const lines = profiles.map(
            (p) =>
              `  ${p.domain}:${p.taskType} — expertise: ${(p.expertise * 100).toFixed(1)}%, ` +
              `success: ${(p.successRate * 100).toFixed(1)}%, missions: ${p.missionCount}`,
          );
          return textResult(
            `${profiles.length} profile(s) for ${params.agentId}:\n${lines.join("\n")}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 10. kaneru_learn_top
    // ------------------------------------------------------------------
    {
      name: "kaneru_learn_top",
      description:
        "Get top agents for a given domain and task type, ranked by expertise score.",
      parameters: Type.Object({
        domain: Type.String({ description: "Domain (e.g. typescript, python, rust)" }),
        taskType: Type.String({ description: "Task type (e.g. code-review, debugging, implementation)" }),
        limit: Type.Optional(
          Type.Number({ description: "Max results (default: 10)" }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const mgr = getLearningProfiles();
          const limit = (params.limit as number | undefined) ?? 10;
          const profiles = await mgr.topAgents(
            params.domain as string,
            params.taskType as string,
            limit,
          );
          if (profiles.length === 0) {
            return textResult(
              `No agents found for ${params.domain}:${params.taskType}`,
            );
          }
          const lines = profiles.map(
            (p) =>
              `  ${p.agentId} — expertise: ${(p.expertise * 100).toFixed(1)}%, ` +
              `success: ${(p.successRate * 100).toFixed(1)}%, missions: ${p.missionCount}`,
          );
          return textResult(
            `Top ${profiles.length} agent(s) for ${params.domain}:${params.taskType}:\n${lines.join("\n")}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 11. kaneru_decisions_list
    // ------------------------------------------------------------------
    {
      name: "kaneru_decisions_list",
      description:
        "Query consensus decision history with optional venture filter. " +
        "Returns decisions sorted by most recent first.",
      parameters: Type.Object({
        ventureId: Type.Optional(
          Type.String({ description: "Filter by venture ID" }),
        ),
        limit: Type.Optional(
          Type.Number({ description: "Max results (default: 20)" }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const history = getDecisionHistory();
          const decisions = await history.query({
            ventureId: (params.ventureId as string | undefined) ?? undefined,
            limit: (params.limit as number | undefined) ?? 20,
          });
          if (decisions.length === 0) {
            return textResult("No decisions found.");
          }
          const lines = decisions.map(
            (d) =>
              `  ${d.id} [${d.strategy}] confidence: ${(d.confidence * 100).toFixed(1)}%\n` +
              `    Q: ${d.question}\n` +
              `    Outcome: ${d.resolvedValue}\n` +
              `    Decided: ${d.decidedAt}`,
          );
          return textResult(
            `${decisions.length} decision(s):\n${lines.join("\n")}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 12. kaneru_decisions_explain
    // ------------------------------------------------------------------
    {
      name: "kaneru_decisions_explain",
      description:
        "Get a human-readable explanation of a consensus decision including " +
        "question, votes, strategy, outcome, participants, and confidence.",
      parameters: Type.Object({
        decisionId: Type.String({ description: "Decision ID to explain" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const history = getDecisionHistory();
          const explanation = await history.explain(params.decisionId as string);
          return textResult(explanation);
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 13. kaneru_dojo_list
    // ------------------------------------------------------------------
    {
      name: "kaneru_dojo_list",
      description:
        "List available Dojo venture templates. Templates provide pre-configured " +
        "venture structures with missions, directives, and agent assignments.",
      parameters: Type.Object({}),
      execute: async (_callId: string, _params: Record<string, unknown>) => {
        try {
          const dojo = getDojoService();
          const templates = await dojo.listTemplates();
          if (templates.length === 0) {
            return textResult("No templates found.");
          }
          const lines = templates.map(
            (t) => `  ${t.id} — ${t.name}\n    ${t.description}`,
          );
          return textResult(
            `${templates.length} template(s):\n${lines.join("\n")}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 14. kaneru_dojo_install
    // ------------------------------------------------------------------
    {
      name: "kaneru_dojo_install",
      description:
        "Install a Dojo template as a new venture. Creates the venture, " +
        "missions, directives, and chain entries from the template blueprint.",
      parameters: Type.Object({
        templateId: Type.String({ description: "Template ID to install" }),
        ventureName: Type.String({ description: "Name for the new venture" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const dojo = getDojoService();
          const result = await dojo.install(
            params.templateId as string,
            params.ventureName as string,
          );
          return textResult(
            `Template installed:\n` +
              `  Venture: ${result.ventureId}\n` +
              `  Name: ${result.ventureName}\n` +
              `  Prefix: ${result.prefix}\n` +
              `  Agents deployed: ${result.agentsDeployed}\n` +
              `  Directives created: ${result.directivesCreated}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 15. kaneru_sync
    // ------------------------------------------------------------------
    {
      name: "kaneru_sync",
      description:
        "Sync a venture with P2P peers. Pushes local changes and pulls " +
        "remote updates, reporting conflicts if any.",
      parameters: Type.Object({
        ventureId: Type.String({ description: "Venture ID to sync" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const dist = getDistributedManager();
          const result = await dist.syncVenture(params.ventureId as string);
          return textResult(
            `Sync complete:\n` +
              `  Venture: ${result.ventureId}\n` +
              `  Actions synced: ${result.actionsSynced}\n` +
              `  Triples added: ${result.triplesAdded}\n` +
              `  Conflicts: ${result.conflicts}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 16. kaneru_terminal_exec
    // ------------------------------------------------------------------
    {
      name: "kaneru_terminal_exec",
      description:
        "Record a terminal command execution result. Used by remote terminal " +
        "channels to log command output, exit codes, and duration for audit trails.",
      parameters: Type.Object({
        agentId: Type.String({ description: "Agent ID that executed the command" }),
        command: Type.String({ description: "Command that was executed" }),
        exitCode: Type.Number({ description: "Process exit code" }),
        stdout: Type.String({ description: "Standard output" }),
        stderr: Type.String({ description: "Standard error output" }),
        durationMs: Type.Number({ description: "Execution duration in milliseconds" }),
        missionId: Type.Optional(
          Type.String({ description: "Associated mission ID (if any)" }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const client = getClient();
          const ns = getNs();
          const agentId = params.agentId as string;
          const command = params.command as string;
          const exitCode = params.exitCode as number;
          const stdout = params.stdout as string;
          const stderr = params.stderr as string;
          const durationMs = params.durationMs as number;
          const missionId = (params.missionId as string | undefined) ?? undefined;

          const subject = `${ns}:terminal:exec:${agentId}:${Date.now()}`;
          const payload = JSON.stringify({
            agentId,
            command,
            exitCode,
            stdout: stdout.slice(0, 4096),
            stderr: stderr.slice(0, 4096),
            durationMs,
            missionId,
            recordedAt: new Date().toISOString(),
          });

          await client.createTriple({
            subject,
            predicate: `${ns}:terminal:execution`,
            object: payload,
          });

          return textResult(
            `Terminal execution recorded:\n` +
              `  Agent: ${agentId}\n` +
              `  Command: ${command}\n` +
              `  Exit code: ${exitCode}\n` +
              `  Duration: ${durationMs}ms\n` +
              (missionId ? `  Mission: ${missionId}\n` : "") +
              `  Subject: ${subject}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },
  ];

  return Object.assign(tools, {
    destroy() {
      if (client) {
        client.destroy();
        client = null;
      }
      ventureManager = null;
      missionManager = null;
      fuelController = null;
      pulseScheduler = null;
      learningProfiles = null;
      decisionHistory = null;
      dojoService = null;
      distributedManager = null;
    },
  });
}

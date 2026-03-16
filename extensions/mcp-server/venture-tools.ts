/**
 * MCP-friendly Kaneru venture tools.
 *
 * Exposes 8 tools for venture creation, mission lifecycle, fuel tracking,
 * and pulse scheduling via the venture layer managers.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";
import { CortexClient } from "../shared/cortex-client.js";
import type { CortexConfig } from "../shared/cortex-client.js";
import { VentureManager } from "../kaneru/venture.js";
import { MissionManager } from "../kaneru/mission.js";
import { FuelController } from "../kaneru/fuel.js";
import { PulseScheduler } from "../kaneru/pulse.js";
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
    },
  });
}

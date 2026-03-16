/**
 * MCP-friendly Kaneru multi-agent tools.
 *
 * Exposes 8 tools for squad creation, workflow execution, delegation,
 * consensus resolution, task routing, knowledge fusion, and mailbox
 * operations via the KaneruFacade.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";
import { KaneruFacade } from "../agent-mesh/kaneru-facade.js";
import type { MergeStrategy } from "../agent-mesh/mesh-protocol.js";
import type { ConsensusStrategy } from "../agent-mesh/consensus-engine.js";

export type KaneruToolDeps = {
  cortexBaseUrl: string;
  namespace?: string;
  authToken?: string;
};

type ToolContent = { content: Array<{ type: "text"; text: string }> };

function textResult(text: string): ToolContent {
  return { content: [{ type: "text" as const, text }] };
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

export function createKaneruTools(deps: KaneruToolDeps): AdaptableTool[] {
  let facade: KaneruFacade | null = null;

  function getFacade(): KaneruFacade {
    if (!facade) {
      const { host, port } = parseBaseUrl(deps.cortexBaseUrl);
      facade = new KaneruFacade({
        host,
        port,
        token: deps.authToken,
        namespace: deps.namespace,
      });
    }
    return facade;
  }

  return [
    // ------------------------------------------------------------------
    // 1. kaneru_squad_create
    // ------------------------------------------------------------------
    {
      name: "kaneru_squad_create",
      description:
        "Create a Kaneru squad (team) of agents for coordinated missions. " +
        "Provide a name, comma-separated agent IDs, and an optional merge strategy.",
      parameters: Type.Object({
        name: Type.String({ description: "Squad name" }),
        agents: Type.String({
          description: "Comma-separated agent IDs (e.g. 'agent-a,agent-b,agent-c')",
        }),
        strategy: Type.Optional(
          Type.String({
            description: "Merge strategy for knowledge fusion (default: additive)",
          }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const agentIds = (params.agents as string)
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
          const team = await f.squadCreate({
            name: params.name as string,
            agents: agentIds.map((id) => ({ agentId: id, role: "member" })),
            strategy: (params.strategy as MergeStrategy | undefined) ?? undefined,
          });
          return textResult(
            `Squad created:\n` +
              `  ID: ${team.id}\n` +
              `  Name: ${team.name}\n` +
              `  Members: ${team.members.map((m: { agentId: string }) => m.agentId).join(", ")}\n` +
              `  Strategy: ${team.strategy}\n` +
              `  Status: ${team.status}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 2. kaneru_squad_run
    // ------------------------------------------------------------------
    {
      name: "kaneru_squad_run",
      description:
        "Start a workflow run on a Kaneru squad. " +
        "Provide the squad ID and a mission description.",
      parameters: Type.Object({
        squad: Type.String({ description: "Squad ID" }),
        mission: Type.String({ description: "Mission or workflow name to execute" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const entry = await f.squadRun(params.squad as string, params.mission as string);
          return textResult(
            `Workflow started:\n` +
              `  Workflow ID: ${entry.id}\n` +
              `  Name: ${entry.name}\n` +
              `  State: ${entry.state}\n` +
              `  Created at: ${entry.createdAt}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 3. kaneru_squad_status
    // ------------------------------------------------------------------
    {
      name: "kaneru_squad_status",
      description: "Get the current status of a Kaneru squad, including members and strategy.",
      parameters: Type.Object({
        squad: Type.String({ description: "Squad ID" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const team = await f.squadStatus(params.squad as string);
          if (!team) {
            return textResult(`Squad not found: ${String(params.squad)}`);
          }
          return textResult(
            `Squad ${team.id}:\n` +
              `  Name: ${team.name}\n` +
              `  Status: ${team.status}\n` +
              `  Strategy: ${team.strategy}\n` +
              `  Members (${team.members.length}):\n` +
              team.members
                .map((m: { agentId: string; role: string }) => `    - ${m.agentId} (${m.role})`)
                .join("\n"),
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 4. kaneru_delegate
    // ------------------------------------------------------------------
    {
      name: "kaneru_delegate",
      description:
        "Delegate a mission from one agent to another. " +
        "Prepares delegation context and injects it into the target agent.",
      parameters: Type.Object({
        from: Type.String({ description: "Source agent ID" }),
        to: Type.String({ description: "Target agent ID" }),
        mission: Type.String({ description: "Mission description to delegate" }),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const ctx = await f.delegate(
            params.from as string,
            params.to as string,
            params.mission as string,
          );
          return textResult(
            `Delegation complete:\n` +
              `  From: ${String(params.from)}\n` +
              `  To: ${String(params.to)}\n` +
              `  Mission: ${String(params.mission)}\n` +
              `  Context keys: ${Object.keys(ctx).join(", ")}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 5. kaneru_consensus
    // ------------------------------------------------------------------
    {
      name: "kaneru_consensus",
      description:
        "Run consensus resolution across a squad on a given question. " +
        "Returns the consensus result with resolution details.",
      parameters: Type.Object({
        squad: Type.String({ description: "Squad ID to poll for consensus" }),
        question: Type.String({ description: "Question to resolve via consensus" }),
        strategy: Type.Optional(
          Type.String({
            description:
              "Consensus strategy (e.g. 'weighted', 'majority', 'unanimous'). Default: weighted",
          }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const result = await f.consensusResolve({
            squadId: params.squad as string,
            question: params.question as string,
            strategy: (params.strategy as ConsensusStrategy | undefined) ?? undefined,
          });
          return textResult(
            `Consensus result:\n` +
              `  Resolved: ${result.resolved}\n` +
              `  Strategy: ${result.strategy}\n` +
              `  Details: ${JSON.stringify(result.resolutions, null, 2)}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 6. kaneru_route
    // ------------------------------------------------------------------
    {
      name: "kaneru_route",
      description:
        "Route a mission to the best available agent using Q-learning. " +
        "Returns the selected agent ID, confidence, task type, and complexity.",
      parameters: Type.Object({
        mission: Type.String({ description: "Mission description to route" }),
        agents: Type.Optional(
          Type.String({
            description:
              "Comma-separated available agent IDs. If omitted, routes across all known agents.",
          }),
        ),
        path: Type.Optional(Type.String({ description: "Optional file path context for routing" })),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const agents = params.agents
            ? (params.agents as string)
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined;
          const result = await f.route(
            params.mission as string,
            agents,
            (params.path as string | undefined) ?? undefined,
          );
          return textResult(
            `Routing decision:\n` +
              `  Agent: ${result.agentId}\n` +
              `  Confidence: ${(result.confidence * 100).toFixed(1)}%\n` +
              `  Task type: ${result.taskType}\n` +
              `  Complexity: ${result.complexity}\n` +
              `  Domain: ${result.domain}\n` +
              `  Routing ID: ${result.routingId}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 7. kaneru_fuse
    // ------------------------------------------------------------------
    {
      name: "kaneru_fuse",
      description:
        "Merge knowledge between two namespaces (knowledge fusion). " +
        "Supports additive, replace, and custom merge strategies.",
      parameters: Type.Object({
        source: Type.String({ description: "Source namespace" }),
        target: Type.String({ description: "Target namespace" }),
        strategy: Type.Optional(
          Type.String({
            description: "Merge strategy (default: additive)",
          }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const report = await f.fuse(
            params.source as string,
            params.target as string,
            (params.strategy as MergeStrategy | undefined) ?? undefined,
          );
          return textResult(
            `Fusion complete:\n` +
              `  Source: ${report.sourceNs}\n` +
              `  Target: ${report.targetNs}\n` +
              `  Strategy: ${report.strategy}\n` +
              `  Added: ${report.added}\n` +
              `  Skipped: ${report.skipped}\n` +
              `  Conflicts: ${report.conflicts}`,
          );
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },

    // ------------------------------------------------------------------
    // 8. kaneru_mailbox
    // ------------------------------------------------------------------
    {
      name: "kaneru_mailbox",
      description:
        "Interact with the agent mailbox system. " +
        "Actions: 'send' (send a message), 'check' (read inbox), 'stats' (get mailbox stats).",
      parameters: Type.Object({
        action: Type.Union([Type.Literal("send"), Type.Literal("check"), Type.Literal("stats")], {
          description: "Mailbox action: send, check, or stats",
        }),
        agent: Type.String({
          description: "Agent ID (sender for 'send', target for 'check'/'stats')",
        }),
        to: Type.Optional(Type.String({ description: "Recipient agent ID (required for 'send')" })),
        content: Type.Optional(
          Type.String({ description: "Message content (required for 'send')" }),
        ),
        type: Type.Optional(
          Type.String({
            description:
              "Message type: task, finding, question, status, knowledge-share, delegation-context (default: task). Used with 'send'.",
          }),
        ),
      }),
      execute: async (_callId: string, params: Record<string, unknown>) => {
        try {
          const f = getFacade();
          const action = params.action as string;
          const agent = params.agent as string;

          if (action === "send") {
            const to = params.to as string | undefined;
            const content = params.content as string | undefined;
            if (!to || !content) {
              return textResult("Error: 'to' and 'content' are required for send action.");
            }
            const msg = await f.mailboxSend(
              agent,
              to,
              content,
              (params.type as string | undefined) ?? undefined,
            );
            return textResult(
              `Message sent:\n` +
                `  ID: ${msg.id}\n` +
                `  From: ${agent}\n` +
                `  To: ${to}\n` +
                `  Type: ${msg.type}`,
            );
          }

          if (action === "check") {
            const messages = await f.mailboxCheck(agent);
            if (!messages || messages.length === 0) {
              return textResult(`No unread messages for agent "${agent}".`);
            }
            const lines = messages.map(
              (m: { id: string; from: string; type: string; content: string }) =>
                `  [${m.type}] from ${m.from}: ${m.content.slice(0, 120)}${m.content.length > 120 ? "..." : ""}`,
            );
            return textResult(
              `${messages.length} unread message(s) for "${agent}":\n${lines.join("\n")}`,
            );
          }

          if (action === "stats") {
            const stats = await f.mailboxStats(agent);
            return textResult(
              `Mailbox stats for "${agent}":\n` +
                `  Total: ${stats.total}\n` +
                `  Unread: ${stats.unread}\n` +
                `  Read: ${stats.read}\n` +
                `  Archived: ${stats.archived}`,
            );
          }

          return textResult(`Unknown mailbox action: ${action}`);
        } catch (err) {
          return textResult(`Error: ${String(err)}`);
        }
      },
    },
  ];
}

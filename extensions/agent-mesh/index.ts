/**
 * Mayros Agent Mesh Plugin
 *
 * Multi-agent coordination mesh with shared namespaces, delegation,
 * and knowledge fusion. Backed by AIngle Cortex sidecar for RDF storage.
 *
 * Tools: mesh_share_knowledge, mesh_request_knowledge, mesh_create_shared_space,
 *        mesh_list_agents, mesh_delegate, mesh_merge, mesh_conflicts,
 *        mesh_grant_access, mesh_revoke_access,
 *        mesh_create_team, mesh_team_status, mesh_run_workflow,
 *        agent_send_message, agent_check_inbox, mesh_team_dashboard,
 *        agent_track_background_task, agent_list_background_tasks
 *
 * Hooks: subagent_spawning, subagent_ended, before_agent_start, agent_end
 *
 * CLI: mayros mesh status, mayros mesh agents, mayros mesh namespaces, mayros mesh share,
 *      mayros mesh team create|status|list|merge
 */

import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { HealthMonitor } from "../shared/health-monitor.js";
import { NamespaceACL } from "./acl.js";
import { agentMeshConfigSchema } from "./config.js";
import { DelegationEngine } from "./delegation-engine.js";
import { KnowledgeFusion } from "./knowledge-fusion.js";
import {
  createMeshMessage,
  isValidAccessLevel,
  isValidMessageType,
  type AccessLevel,
  type MergeStrategy,
  type MeshMessage,
} from "./mesh-protocol.js";
import { NamespaceManager } from "./namespace-manager.js";
import { AgentMailbox } from "./agent-mailbox.js";
import { BackgroundTracker } from "./background-tracker.js";
import { TeamDashboardService } from "./team-dashboard.js";
import { TeamManager } from "./team-manager.js";
import { WorkflowOrchestrator } from "./workflow-orchestrator.js";
import { listWorkflows as listWorkflowDefs } from "./workflows/registry.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const agentMeshPlugin = {
  id: "agent-mesh",
  name: "Agent Mesh",
  description:
    "Multi-agent coordination mesh with shared namespaces, delegation, and knowledge fusion via AIngle Cortex",
  kind: "coordination" as const,
  configSchema: agentMeshConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = agentMeshConfigSchema.parse(api.pluginConfig);
    const ns = cfg.agentNamespace;
    const agentId = api.id;
    const client = new CortexClient(cfg.cortex);
    const nsMgr = new NamespaceManager(client, ns, cfg.mesh.maxSharedNamespaces);
    const delegationEngine = new DelegationEngine(client, ns, nsMgr);
    const fusion = new KnowledgeFusion(client, ns);
    const teamMgr = new TeamManager(client, ns, nsMgr, fusion, {
      maxTeamSize: cfg.teams.maxTeamSize,
      defaultStrategy: cfg.teams.defaultStrategy,
      workflowTimeout: cfg.teams.workflowTimeout,
    });
    const mailbox = new AgentMailbox(client, ns);
    const bgTracker = new BackgroundTracker(client, ns);
    const orchestrator = new WorkflowOrchestrator(
      client,
      ns,
      teamMgr,
      fusion,
      nsMgr,
      mailbox,
      bgTracker,
    );
    const dashboard = new TeamDashboardService(teamMgr, mailbox, null, ns);
    let cortexAvailable = false;
    const healthMonitor = new HealthMonitor(client, {
      onHealthy: () => {
        cortexAvailable = true;
        api.logger.info("agent-mesh: Cortex recovered — now healthy");
      },
      onUnhealthy: () => {
        cortexAvailable = false;
        api.logger.warn("agent-mesh: Cortex unreachable — now unhealthy");
      },
    });

    // Message bus for mesh messages (in-process for now)
    const MESSAGE_LOG_MAX = 1000;
    const messageLog: MeshMessage[] = [];

    function appendToMessageLog(msg: MeshMessage): void {
      messageLog.push(msg);
      if (messageLog.length > MESSAGE_LOG_MAX) {
        messageLog.splice(0, messageLog.length - MESSAGE_LOG_MAX);
      }
    }

    /**
     * Ensure a value carries the namespace prefix. If it already starts with
     * `${nsPrefix}:` it is returned as-is; otherwise the prefix is prepended.
     */
    function ensureNsPrefix(value: string, nsPrefix: string): string {
      if (value.startsWith(`${nsPrefix}:`)) return value;
      return `${nsPrefix}:${value}`;
    }

    api.logger.info(`agent-mesh: plugin registered (ns: ${ns}, agent: ${agentId})`);

    // ========================================================================
    // Cortex connectivity state
    // ========================================================================

    async function ensureCortex(): Promise<boolean> {
      if (cortexAvailable) return true;
      cortexAvailable = await client.isHealthy();
      return cortexAvailable;
    }

    // ========================================================================
    // Tools
    // ========================================================================

    // 1. mesh_share_knowledge
    api.registerTool(
      {
        name: "mesh_share_knowledge",
        label: "Mesh Share Knowledge",
        description:
          "Share knowledge triples from this agent's namespace with another agent or shared namespace.",
        parameters: Type.Object({
          toAgent: Type.String({ description: "Target agent ID or shared namespace" }),
          triples: Type.Array(
            Type.Object({
              subject: Type.String(),
              predicate: Type.String(),
              object: Type.String(),
            }),
            { description: "Triples to share" },
          ),
          namespace: Type.Optional(
            Type.String({
              description: "Target namespace (defaults to target agent's private ns)",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { toAgent, triples, namespace } = params as {
            toAgent: string;
            triples: Array<{ subject: string; predicate: string; object: string }>;
            namespace?: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot share knowledge." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          const targetNs = namespace ?? nsMgr.getPrivateNs(toAgent);

          // Check write access
          const hasAccess = await nsMgr.checkAccess(agentId, targetNs, "write");
          if (!hasAccess) {
            return {
              content: [{ type: "text", text: `No write access to namespace ${targetNs}.` }],
              details: { action: "denied", namespace: targetNs },
            };
          }

          let stored = 0;
          for (const t of triples) {
            await client.createTriple({
              subject: ensureNsPrefix(t.subject, ns),
              predicate: ensureNsPrefix(t.predicate, ns),
              object: t.object,
            });
            stored++;
          }

          const msg = createMeshMessage("knowledge-share", agentId, toAgent, targetNs, {
            tripleCount: stored,
          });
          appendToMessageLog(msg);

          return {
            content: [
              {
                type: "text",
                text: `Shared ${stored} triples with ${toAgent} in namespace ${targetNs}.`,
              },
            ],
            details: { action: "shared", tripleCount: stored, namespace: targetNs },
          };
        },
      },
      { name: "mesh_share_knowledge" },
    );

    // 2. mesh_request_knowledge
    api.registerTool(
      {
        name: "mesh_request_knowledge",
        label: "Mesh Request Knowledge",
        description:
          "Request knowledge from another agent's namespace by subject or predicate filter.",
        parameters: Type.Object({
          fromAgent: Type.String({ description: "Source agent ID" }),
          subject: Type.Optional(Type.String({ description: "Filter by subject" })),
          predicate: Type.Optional(Type.String({ description: "Filter by predicate" })),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 20)" })),
        }),
        async execute(_toolCallId, params) {
          const {
            fromAgent,
            subject,
            predicate,
            limit = 20,
          } = params as {
            fromAgent: string;
            subject?: string;
            predicate?: string;
            limit?: number;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot request knowledge." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          const sourceNs = nsMgr.getPrivateNs(fromAgent);

          // Check read access
          const hasAccess = await nsMgr.checkAccess(agentId, sourceNs, "read");
          if (!hasAccess) {
            return {
              content: [{ type: "text", text: `No read access to ${fromAgent}'s namespace.` }],
              details: { action: "denied", namespace: sourceNs },
            };
          }

          // Step 1: find memory subjects owned by this namespace
          const ownershipResult = await client.patternQuery({
            predicate: `${ns}:memory:ownedBy`,
            object: { node: sourceNs },
            limit: 200,
          });

          if (ownershipResult.matches.length === 0) {
            return {
              content: [{ type: "text", text: "No matching knowledge found." }],
              details: { count: 0, namespace: sourceNs },
            };
          }

          // Step 2: for each owned subject, fetch its triples respecting caller filters
          type SimpleTriple = { subject: string; predicate: string; object: unknown };
          const collected: SimpleTriple[] = [];
          for (const match of ownershipResult.matches) {
            if (collected.length >= limit) break;
            const triples = await client.listTriples({
              subject: match.subject,
              predicate,
              limit: 20,
            });
            for (const t of triples.triples) {
              if (subject && t.subject !== subject) continue;
              collected.push(t);
              if (collected.length >= limit) break;
            }
          }

          if (collected.length === 0) {
            return {
              content: [{ type: "text", text: "No matching knowledge found." }],
              details: { count: 0, namespace: sourceNs },
            };
          }

          const text = collected
            .map((t) => `${t.subject} ${t.predicate} ${JSON.stringify(t.object)}`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Found ${collected.length} triples from ${fromAgent}:\n\n${text}`,
              },
            ],
            details: { count: collected.length, namespace: sourceNs },
          };
        },
      },
      { name: "mesh_request_knowledge" },
    );

    // 3. mesh_create_shared_space
    api.registerTool(
      {
        name: "mesh_create_shared_space",
        label: "Mesh Create Shared Space",
        description: "Create a shared namespace for multiple agents to collaborate.",
        parameters: Type.Object({
          name: Type.String({
            description: "Shared namespace name (alphanumeric, starts with letter)",
          }),
          owners: Type.Array(Type.String(), {
            description: "Agent IDs to grant admin access",
          }),
        }),
        async execute(_toolCallId, params) {
          const { name, owners } = params as { name: string; owners: string[] };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot create namespace." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const sharedNs = await nsMgr.createSharedNamespace(name, owners);
            return {
              content: [
                {
                  type: "text",
                  text: `Created shared namespace: ${sharedNs} (owners: ${owners.join(", ")})`,
                },
              ],
              details: { action: "created", namespace: sharedNs, owners },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to create namespace: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_create_shared_space" },
    );

    // 4. mesh_list_agents
    api.registerTool(
      {
        name: "mesh_list_agents",
        label: "Mesh List Agents",
        description: "List all agents known to the mesh and their accessible namespaces.",
        parameters: Type.Object({
          namespace: Type.Optional(
            Type.String({ description: "Filter to agents with access to this namespace" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { namespace } = params as { namespace?: string };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot list agents." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          // Find all agent nodes in the graph
          const result = await client.patternQuery({
            predicate: `${ns}:agent:type`,
            object: "agent",
            limit: 100,
          });

          // Always include current agent
          const agents = new Set<string>([agentId]);
          const agentPrefix = `${ns}:agent:`;

          for (const match of result.matches) {
            if (match.subject.startsWith(agentPrefix)) {
              agents.add(match.subject.slice(agentPrefix.length));
            }
          }

          if (namespace) {
            // Filter to agents with access to the specified namespace
            const acl = nsMgr.getACL();
            const grants = await acl.listGrants(namespace);
            const grantedAgents = new Set(grants.map((g) => g.agent));
            const filtered = [...agents].filter((a) => grantedAgents.has(a));

            return {
              content: [
                {
                  type: "text",
                  text:
                    filtered.length > 0
                      ? `Agents with access to ${namespace}:\n${filtered.map((a) => `- ${a}`).join("\n")}`
                      : `No agents have access to ${namespace}.`,
                },
              ],
              details: { agents: filtered, namespace },
            };
          }

          const agentList = [...agents];
          return {
            content: [
              {
                type: "text",
                text: `Known agents (${agentList.length}):\n${agentList.map((a) => `- ${a}`).join("\n")}`,
              },
            ],
            details: { agents: agentList },
          };
        },
      },
      { name: "mesh_list_agents" },
    );

    // 5. mesh_delegate
    api.registerTool(
      {
        name: "mesh_delegate",
        label: "Mesh Delegate",
        description:
          "Prepare a delegation context for a child agent with relevant knowledge from the parent's namespace.",
        parameters: Type.Object({
          task: Type.String({ description: "Task description for the child agent" }),
          childAgentId: Type.String({ description: "ID of the child agent to delegate to" }),
        }),
        async execute(_toolCallId, params) {
          const { task, childAgentId } = params as {
            task: string;
            childAgentId: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot prepare delegation." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const ctx = await delegationEngine.prepareContext(task, agentId);
            const sessionKey = `delegation-${randomUUID()}`;
            delegationEngine.injectContext(sessionKey, ctx);

            const msg = createMeshMessage("delegation-context", agentId, childAgentId, ns, {
              task,
              sessionKey,
              tripleCount: ctx.relevantTriples.length,
              memoryCount: ctx.relatedMemories.length,
            });
            appendToMessageLog(msg);

            return {
              content: [
                {
                  type: "text",
                  text: `Delegation prepared for ${childAgentId}: ${ctx.relevantTriples.length} relevant triples, ${ctx.relatedMemories.length} related memories. Session: ${sessionKey}`,
                },
              ],
              details: {
                action: "prepared",
                sessionKey,
                tripleCount: ctx.relevantTriples.length,
                memoryCount: ctx.relatedMemories.length,
                context: ctx,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Delegation failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_delegate" },
    );

    // 6. mesh_merge
    api.registerTool(
      {
        name: "mesh_merge",
        label: "Mesh Merge",
        description:
          "Merge knowledge from one namespace into another using a specified strategy (additive, replace, conflict-flag, newest-wins, or majority-wins).",
        parameters: Type.Object({
          sourceNs: Type.String({ description: "Source namespace" }),
          targetNs: Type.String({ description: "Target namespace" }),
          strategy: Type.Unsafe<string>({
            type: "string",
            enum: ["additive", "replace", "conflict-flag", "newest-wins", "majority-wins"],
            description: "Merge strategy",
          }),
          additionalNs: Type.Optional(
            Type.Array(Type.String(), {
              description: "Additional namespaces for majority-wins voting",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { sourceNs, targetNs, strategy, additionalNs } = params as {
            sourceNs: string;
            targetNs: string;
            strategy: MergeStrategy;
            additionalNs?: string[];
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot merge." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          // Check write access to target
          const hasAccess = await nsMgr.checkAccess(agentId, targetNs, "write");
          if (!hasAccess) {
            return {
              content: [{ type: "text", text: `No write access to target namespace ${targetNs}.` }],
              details: { action: "denied", namespace: targetNs },
            };
          }

          try {
            const report = await fusion.merge(sourceNs, targetNs, strategy, additionalNs);

            const msg = createMeshMessage("merge-request", agentId, "mesh", targetNs, {
              sourceNs,
              strategy,
              added: report.added,
              skipped: report.skipped,
              conflicts: report.conflicts,
              resolutions: report.resolutions?.length ?? 0,
            });
            appendToMessageLog(msg);

            return {
              content: [
                {
                  type: "text",
                  text: `Merge complete (${strategy}): ${report.added} added, ${report.skipped} skipped, ${report.conflicts} conflicts.${report.details.length > 0 ? "\n\n" + report.details.join("\n") : ""}`,
                },
              ],
              details: { action: "merged", report },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Merge failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_merge" },
    );

    // 7. mesh_conflicts
    api.registerTool(
      {
        name: "mesh_conflicts",
        label: "Mesh Conflicts",
        description:
          "Detect conflicting facts between two namespaces where the same subject/predicate has different values.",
        parameters: Type.Object({
          ns1: Type.String({ description: "First namespace" }),
          ns2: Type.String({ description: "Second namespace" }),
        }),
        async execute(_toolCallId, params) {
          const { ns1, ns2 } = params as { ns1: string; ns2: string };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot detect conflicts." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const conflicts = await fusion.detectConflicts(ns1, ns2);

            if (conflicts.length === 0) {
              return {
                content: [
                  { type: "text", text: `No conflicts detected between ${ns1} and ${ns2}.` },
                ],
                details: { count: 0 },
              };
            }

            const text = conflicts
              .map(
                (c) =>
                  `- ${c.subject} ${c.predicate}: values=[${c.values.map((v) => `"${v}"`).join(", ")}]`,
              )
              .join("\n");

            const msg = createMeshMessage("conflict-alert", agentId, "mesh", ns, {
              ns1,
              ns2,
              conflictCount: conflicts.length,
            });
            appendToMessageLog(msg);

            return {
              content: [
                {
                  type: "text",
                  text: `Found ${conflicts.length} conflict(s) between ${ns1} and ${ns2}:\n\n${text}`,
                },
              ],
              details: { count: conflicts.length, conflicts },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Conflict detection failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_conflicts" },
    );

    // 8. mesh_grant_access
    api.registerTool(
      {
        name: "mesh_grant_access",
        label: "Mesh Grant Access",
        description: "Grant an agent a specific access level (read, write, admin) to a namespace.",
        parameters: Type.Object({
          targetAgent: Type.String({ description: "Agent ID to grant access to" }),
          namespace: Type.String({ description: "Namespace to grant access on" }),
          level: Type.Unsafe<string>({
            type: "string",
            enum: ["read", "write", "admin"],
            description: "Access level to grant",
          }),
        }),
        async execute(_toolCallId, params) {
          const {
            targetAgent,
            namespace: targetNamespace,
            level,
          } = params as {
            targetAgent: string;
            namespace: string;
            level: AccessLevel;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot grant access." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          if (!isValidAccessLevel(level)) {
            return {
              content: [
                {
                  type: "text",
                  text: `Invalid access level: ${level}. Use read, write, or admin.`,
                },
              ],
              details: { action: "failed", error: "invalid_access_level" },
            };
          }

          // Granter must have admin access
          const hasAdmin = await nsMgr.checkAccess(agentId, targetNamespace, "admin");
          if (!hasAdmin) {
            return {
              content: [
                {
                  type: "text",
                  text: `You need admin access to ${targetNamespace} to grant permissions.`,
                },
              ],
              details: { action: "denied" },
            };
          }

          try {
            const acl = nsMgr.getACL();
            await acl.grant(agentId, targetAgent, targetNamespace, level);

            return {
              content: [
                {
                  type: "text",
                  text: `Granted ${level} access to ${targetAgent} on ${targetNamespace}.`,
                },
              ],
              details: {
                action: "granted",
                targetAgent,
                namespace: targetNamespace,
                level,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Grant failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_grant_access" },
    );

    // 9. mesh_revoke_access
    api.registerTool(
      {
        name: "mesh_revoke_access",
        label: "Mesh Revoke Access",
        description: "Revoke an agent's access to a namespace.",
        parameters: Type.Object({
          targetAgent: Type.String({ description: "Agent ID to revoke access from" }),
          namespace: Type.String({ description: "Namespace to revoke access on" }),
        }),
        async execute(_toolCallId, params) {
          const { targetAgent, namespace: targetNamespace } = params as {
            targetAgent: string;
            namespace: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot revoke access." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          // Revoker must have admin access
          const hasAdmin = await nsMgr.checkAccess(agentId, targetNamespace, "admin");
          if (!hasAdmin) {
            return {
              content: [
                {
                  type: "text",
                  text: `You need admin access to ${targetNamespace} to revoke permissions.`,
                },
              ],
              details: { action: "denied" },
            };
          }

          try {
            const acl = nsMgr.getACL();
            await acl.revoke(agentId, targetAgent, targetNamespace);

            return {
              content: [
                {
                  type: "text",
                  text: `Revoked ${targetAgent}'s access to ${targetNamespace}.`,
                },
              ],
              details: {
                action: "revoked",
                targetAgent,
                namespace: targetNamespace,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Revoke failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_revoke_access" },
    );

    // 10. mesh_create_team
    api.registerTool(
      {
        name: "mesh_create_team",
        label: "Mesh Create Team",
        description: "Create a team of agents with a shared namespace for coordinated work.",
        parameters: Type.Object({
          name: Type.String({ description: "Team name" }),
          strategy: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["additive", "replace", "conflict-flag", "newest-wins", "majority-wins"],
              description: "Merge strategy (default: from config)",
            }),
          ),
          members: Type.Array(
            Type.Object({
              agentId: Type.String({ description: "Agent ID" }),
              role: Type.String({ description: "Agent role" }),
              task: Type.String({ description: "Task description" }),
            }),
            { description: "Team members" },
          ),
        }),
        async execute(_toolCallId, params) {
          const { name, strategy, members } = params as {
            name: string;
            strategy?: MergeStrategy;
            members: Array<{ agentId: string; role: string; task: string }>;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot create team." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const team = await teamMgr.createTeam({
              name,
              strategy: strategy ?? cfg.teams.defaultStrategy,
              members,
            });

            return {
              content: [
                {
                  type: "text",
                  text: `Team "${team.name}" created (id: ${team.id}, members: ${team.members.length}, strategy: ${team.strategy}, sharedNs: ${team.sharedNs})`,
                },
              ],
              details: { action: "created", team },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Team creation failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_create_team" },
    );

    // 11. mesh_team_status
    api.registerTool(
      {
        name: "mesh_team_status",
        label: "Mesh Team Status",
        description: "Get the status of a team and its members.",
        parameters: Type.Object({
          teamId: Type.String({ description: "Team ID" }),
        }),
        async execute(_toolCallId, params) {
          const { teamId } = params as { teamId: string };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot get team status." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          const team = await teamMgr.getTeam(teamId);
          if (!team) {
            return {
              content: [{ type: "text", text: `Team ${teamId} not found.` }],
              details: { action: "not_found" },
            };
          }

          const memberLines = team.members
            .map(
              (m) => `  - ${m.agentId} (${m.role}): ${m.status}${m.result ? ` — ${m.result}` : ""}`,
            )
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Team "${team.name}" (${team.id}):\n  status: ${team.status}\n  strategy: ${team.strategy}\n  sharedNs: ${team.sharedNs}\n  members:\n${memberLines}`,
              },
            ],
            details: { team },
          };
        },
      },
      { name: "mesh_team_status" },
    );

    // 12. mesh_run_workflow
    api.registerTool(
      {
        name: "mesh_run_workflow",
        label: "Mesh Run Workflow",
        description:
          "Start a pre-defined multi-agent workflow (code-review, feature-dev, security-review).",
        parameters: Type.Object({
          workflow: Type.String({ description: "Workflow name" }),
          path: Type.Optional(
            Type.String({ description: "Target path (default: current directory)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { workflow, path: targetPath } = params as {
            workflow: string;
            path?: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot run workflow." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const entry = await orchestrator.startWorkflow({
              workflowName: workflow,
              path: targetPath,
            });

            const phaseNames = entry.phases.map((p) => p.name).join(" → ");

            return {
              content: [
                {
                  type: "text",
                  text: `Workflow "${entry.name}" started (id: ${entry.id})\n  path: ${entry.path}\n  phases: ${phaseNames}\n  current: ${entry.currentPhase}\n  team: ${entry.teamId}`,
                },
              ],
              details: { action: "started", workflow: entry },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Workflow start failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_run_workflow" },
    );

    // 13. agent_send_message
    api.registerTool(
      {
        name: "agent_send_message",
        label: "Agent Send Message",
        description: "Send a persistent message to another agent via the Cortex-backed mailbox.",
        parameters: Type.Object({
          to: Type.String({ description: "Recipient agent ID" }),
          content: Type.String({ description: "Message content" }),
          type: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: [
                "task",
                "finding",
                "question",
                "status",
                "knowledge-share",
                "delegation-context",
              ],
              description: "Message type (default: task)",
            }),
          ),
          replyTo: Type.Optional(Type.String({ description: "Parent message ID for threading" })),
        }),
        async execute(_toolCallId, params) {
          const { to, content, type, replyTo } = params as {
            to: string;
            content: string;
            type?: string;
            replyTo?: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot send message." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const msg = await mailbox.send({
              from: agentId,
              to,
              content,
              type: type as "task" | undefined,
              replyTo,
            });

            // Also bridge to in-memory message log for backward compat
            const meshMsg = createMeshMessage(
              isValidMessageType(type ?? "task") ? (type as "task") : "knowledge-share",
              agentId,
              to,
              ns,
              { mailboxMessageId: msg.id, content },
            );
            appendToMessageLog(meshMsg);

            return {
              content: [
                {
                  type: "text",
                  text: `Message sent to ${to} (id: ${msg.id}, type: ${msg.type})`,
                },
              ],
              details: { action: "sent", message: msg },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Send failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "agent_send_message" },
    );

    // 14. agent_check_inbox
    api.registerTool(
      {
        name: "agent_check_inbox",
        label: "Agent Check Inbox",
        description: "Check the current agent's mailbox for persistent messages from other agents.",
        parameters: Type.Object({
          status: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["unread", "read", "archived"],
              description: "Filter by status (default: all)",
            }),
          ),
          type: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: [
                "task",
                "finding",
                "question",
                "status",
                "knowledge-share",
                "delegation-context",
              ],
              description: "Filter by message type",
            }),
          ),
          limit: Type.Optional(
            Type.Number({ description: "Max messages to return (default: 20)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            status,
            type,
            limit = 20,
          } = params as {
            status?: string;
            type?: string;
            limit?: number;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot check inbox." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const messages = await mailbox.inbox({
              agent: agentId,
              status: status as "unread" | undefined,
              type: type as "task" | undefined,
              limit,
            });

            if (messages.length === 0) {
              return {
                content: [{ type: "text", text: "No messages in inbox." }],
                details: { count: 0 },
              };
            }

            const text = messages
              .map(
                (m) =>
                  `- [${m.status}] ${m.id} from ${m.from} (${m.type}): ${m.content.slice(0, 100)}${m.content.length > 100 ? "…" : ""}`,
              )
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Inbox (${messages.length} message${messages.length === 1 ? "" : "s"}):\n\n${text}`,
                },
              ],
              details: { count: messages.length, messages },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Inbox check failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "agent_check_inbox" },
    );

    // 15. mesh_team_dashboard
    api.registerTool(
      {
        name: "mesh_team_dashboard",
        label: "Team Dashboard",
        description:
          "Get an aggregated dashboard view of team status, member activity, mailbox stats, and trace metrics.",
        parameters: Type.Object({
          teamId: Type.Optional(
            Type.String({ description: "Team ID (omit for summary of all teams)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { teamId } = params as { teamId?: string };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot load dashboard." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            if (teamId) {
              const d = await dashboard.getTeamDashboard(teamId);
              if (!d) {
                return {
                  content: [{ type: "text", text: `Team ${teamId} not found.` }],
                  details: { action: "not_found", teamId },
                };
              }
              return {
                content: [
                  {
                    type: "text",
                    text: `Dashboard: "${d.teamName}" [${d.teamStatus}]\n  members: ${d.members.length}\n  mail: ${d.mailboxSummary.total} total, ${d.mailboxSummary.unread} unread`,
                  },
                ],
                details: d,
              };
            }

            const s = await dashboard.getSummary();
            const teamLines = s.teams
              .map((t) => `  - ${t.teamId}: "${t.teamName}" [${t.teamStatus}]`)
              .join("\n");
            return {
              content: [
                {
                  type: "text",
                  text: `Dashboard Summary:\n  active teams: ${s.activeTeams}\n  total agents: ${s.totalAgents}\n  total unread: ${s.totalUnread}\n  total errors: ${s.totalErrors}\n${teamLines}`,
                },
              ],
              details: s,
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Dashboard failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "mesh_team_dashboard" },
    );

    // 16. agent_track_background_task
    api.registerTool(
      {
        name: "agent_track_background_task",
        label: "Track Background Task",
        description: "Track a new background agent task in the Cortex-backed task tracker.",
        parameters: Type.Object({
          agentId: Type.String({ description: "Agent ID running the task" }),
          description: Type.String({ description: "Description of the background task" }),
        }),
        async execute(_toolCallId, params) {
          const { agentId: taskAgentId, description: taskDesc } = params as {
            agentId: string;
            description: string;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot track task." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const task = await bgTracker.track({ agentId: taskAgentId, description: taskDesc });
            return {
              content: [
                {
                  type: "text",
                  text: `Background task tracked: ${task.id}\n  agent: ${task.agentId}\n  status: ${task.status}`,
                },
              ],
              details: { action: "tracked", task },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Track failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "agent_track_background_task" },
    );

    // 17. agent_list_background_tasks
    api.registerTool(
      {
        name: "agent_list_background_tasks",
        label: "List Background Tasks",
        description: "List background agent tasks with optional filtering by status and agent.",
        parameters: Type.Object({
          status: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["pending", "running", "completed", "failed", "cancelled"],
              description: "Filter by task status",
            }),
          ),
          agentId: Type.Optional(Type.String({ description: "Filter by agent ID" })),
          limit: Type.Optional(Type.Number({ description: "Max tasks to return (default: 20)" })),
        }),
        async execute(_toolCallId, params) {
          const {
            status,
            agentId: filterAgentId,
            limit = 20,
          } = params as {
            status?: string;
            agentId?: string;
            limit?: number;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Cannot list tasks." }],
              details: { action: "skipped", reason: "cortex_unavailable" },
            };
          }

          try {
            const tasks = await bgTracker.listTasks({
              status: status as "running" | undefined,
              agentId: filterAgentId,
              limit,
            });

            if (tasks.length === 0) {
              return {
                content: [{ type: "text", text: "No background tasks found." }],
                details: { count: 0 },
              };
            }

            const text = tasks
              .map(
                (t) =>
                  `- [${t.status}] ${t.id} (${t.agentId}): ${t.description.slice(0, 80)}${t.description.length > 80 ? "…" : ""}`,
              )
              .join("\n");

            return {
              content: [
                {
                  type: "text",
                  text: `Background tasks (${tasks.length}):\n\n${text}`,
                },
              ],
              details: { count: tasks.length, tasks },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `List failed: ${String(err)}` }],
              details: { action: "failed", error: String(err) },
            };
          }
        },
      },
      { name: "agent_list_background_tasks" },
    );

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Hook: subagent_spawning — inject parent context into child agents
    api.on("subagent_spawning", async (event, _ctx) => {
      if (!(await ensureCortex())) return;

      try {
        const childId = event.agentId;
        const task = event.label ?? `subagent-${event.childSessionKey}`;

        if (!childId || !task) return;

        api.logger.info(`agent-mesh: preparing delegation context for child ${childId}`);

        const ctx = await delegationEngine.prepareContext(task, agentId);

        if (ctx.relevantTriples.length > 0) {
          delegationEngine.injectContext(event.childSessionKey, ctx);
          api.logger.info(
            `agent-mesh: injected ${ctx.relevantTriples.length} triples for child ${childId} (session: ${event.childSessionKey})`,
          );
        }
      } catch (err) {
        api.logger.warn(`agent-mesh: subagent context injection failed: ${String(err)}`);
      }
    });

    // Hook: subagent_ended — merge child results back if autoMerge is enabled
    api.on("subagent_ended", async (event, _ctx) => {
      const childSessionKey = event.targetSessionKey;

      // Always clean up injected context for this child session
      delegationEngine.removeInjectedContext(childSessionKey);

      if (!cfg.mesh.autoMerge) return;
      if (!(await ensureCortex())) return;

      try {
        const success = event.outcome === "ok";

        if (!childSessionKey || !success) return;

        api.logger.info(`agent-mesh: auto-merging results from child ${childSessionKey}`);

        const runId = event.runId ?? `run-${Date.now()}`;
        const report = await delegationEngine.mergeResults(runId, agentId, childSessionKey);

        api.logger.info(
          `agent-mesh: merge complete — added: ${report.added}, skipped: ${report.skipped}, conflicts: ${report.conflicts}`,
        );
      } catch (err) {
        api.logger.warn(`agent-mesh: auto-merge failed: ${String(err)}`);
      }
    });

    // Hook: before_agent_start — register this agent in the mesh + track background agents
    api.on("before_agent_start", async (_event, _ctx) => {
      if (!(await ensureCortex())) return;

      try {
        // Register agent in the knowledge graph
        const agentNode = nsMgr.getPrivateNs(agentId);

        await client.createTriple({
          subject: agentNode,
          predicate: `${ns}:agent:type`,
          object: "agent",
        });

        await client.createTriple({
          subject: agentNode,
          predicate: `${ns}:agent:lastSeen`,
          object: Date.now(),
        });

        api.logger.info(`agent-mesh: agent ${agentId} registered in mesh`);

        // If the agent is a background agent, track it automatically
        try {
          const { findMarkdownAgent } = await import("../../src/agents/markdown-agents.js");
          const mdAgent = findMarkdownAgent(agentId);
          if (mdAgent?.background) {
            await bgTracker.track({
              agentId,
              description: `Background agent: ${mdAgent.name}`,
            });
            api.logger.info(`agent-mesh: background task tracked for ${agentId}`);
          }
        } catch {
          // Markdown agent not found — not a background agent, skip
        }
      } catch (err) {
        api.logger.warn(`agent-mesh: agent registration failed: ${String(err)}`);
      }
    });

    // Hook: agent_end — update agent status, persist mesh state, emit task_completed
    api.on("agent_end", async (event, _ctx) => {
      if (!(await ensureCortex())) return;

      try {
        const success = event.success;

        const agentNode = nsMgr.getPrivateNs(agentId);

        await client.createTriple({
          subject: agentNode,
          predicate: `${ns}:agent:lastSeen`,
          object: Date.now(),
        });

        await client.createTriple({
          subject: agentNode,
          predicate: `${ns}:agent:lastStatus`,
          object: success ? "completed" : "failed",
        });

        // Log message count for observability
        if (messageLog.length > 0) {
          api.logger.info(
            `agent-mesh: session ended with ${messageLog.length} mesh messages exchanged`,
          );
        }

        // Mark running background tasks as completed/failed
        try {
          const tasks = await bgTracker.listTasks({ agentId, status: "running" });
          for (const task of tasks) {
            const newStatus = success ? "completed" : "failed";
            const result = success ? "agent session ended" : (event.error ?? "unknown error");
            await bgTracker.updateStatus(task.id, newStatus, result);
          }
        } catch {
          // Background tracker may not have tasks for this agent
        }
      } catch (err) {
        api.logger.warn(`agent-mesh: agent end tracking failed: ${String(err)}`);
      }
    });

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const mesh = program.command("mesh").description("Agent mesh coordination commands");

        mesh
          .command("status")
          .description("Show mesh connection status and graph stats")
          .action(async () => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Mesh Cortex: OFFLINE");
              console.log(`  endpoint: ${client.baseUrl}`);
              return;
            }

            console.log("Mesh Cortex: ONLINE");
            try {
              const s = await client.stats();
              console.log(`  triples: ${s.graph.triple_count}`);
              console.log(`  subjects: ${s.graph.subject_count}`);
              console.log(`  predicates: ${s.graph.predicate_count}`);
              console.log(`  uptime: ${s.server.uptime_seconds}s`);
              console.log(`  version: ${s.server.version}`);
              console.log(`  clients: ${s.server.connected_clients}`);
            } catch (err) {
              console.log(`  (stats unavailable: ${String(err)})`);
            }

            console.log(`\nMesh Config:`);
            console.log(`  namespace: ${ns}`);
            console.log(`  maxSharedNamespaces: ${cfg.mesh.maxSharedNamespaces}`);
            console.log(`  delegationTimeout: ${cfg.mesh.delegationTimeout}s`);
            console.log(`  autoMerge: ${cfg.mesh.autoMerge}`);
            console.log(`  messages this session: ${messageLog.length}`);
          });

        mesh
          .command("agents")
          .description("List known agents in the mesh")
          .action(async () => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Cortex offline. Cannot list agents.");
              return;
            }

            const result = await client.patternQuery({
              predicate: `${ns}:agent:type`,
              object: "agent",
              limit: 100,
            });

            const agentPrefix = `${ns}:agent:`;
            const agents = new Set<string>([agentId]);

            for (const match of result.matches) {
              if (match.subject.startsWith(agentPrefix)) {
                agents.add(match.subject.slice(agentPrefix.length));
              }
            }

            console.log(`Known agents (${agents.size}):`);
            for (const a of agents) {
              const marker = a === agentId ? " (self)" : "";
              console.log(`  - ${a}${marker}`);
            }
          });

        mesh
          .command("namespaces")
          .description("List namespaces accessible to the current agent")
          .action(async () => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Cortex offline. Cannot list namespaces.");
              return;
            }

            try {
              const accessible = await nsMgr.listAccessible(agentId);
              console.log(`Accessible namespaces (${accessible.length}):`);
              for (const info of accessible) {
                console.log(
                  `  - ${info.namespace} [${info.accessLevel}] (owner: ${info.owner}, triples: ${info.tripleCount})`,
                );
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        mesh
          .command("share")
          .description("Share knowledge to a target agent or namespace")
          .argument("<target>", "Target agent ID or namespace")
          .argument("<subject>", "Triple subject")
          .argument("<predicate>", "Triple predicate")
          .argument("<object>", "Triple object")
          .action(async (target, subject, predicate, object) => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Cortex offline. Cannot share knowledge.");
              return;
            }

            const targetNs = target.includes(":") ? target : nsMgr.getPrivateNs(target);

            // Check write access before writing
            const hasAccess = await nsMgr.checkAccess(agentId, targetNs, "write");
            if (!hasAccess) {
              console.error(`No write access to namespace ${targetNs}.`);
              return;
            }

            const prefixedSubject = ensureNsPrefix(subject, targetNs);

            try {
              await client.createTriple({
                subject: prefixedSubject,
                predicate,
                object,
              });

              console.log(`Shared triple to ${targetNs}:`);
              console.log(`  ${prefixedSubject} ${predicate} "${object}"`);
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        // ---- Team subcommands ----

        const team = mesh.command("team").description("Team coordination commands");

        team
          .command("create")
          .description("Create a new agent team")
          .argument("<name>", "Team name")
          .option("--strategy <strategy>", "Merge strategy", cfg.teams.defaultStrategy)
          .option("--member <members...>", "Members as agentId:role:task")
          .action(async (name, opts) => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Cortex offline. Cannot create team.");
              return;
            }

            const rawMembers: string[] = opts.member ?? [];
            const members = rawMembers
              .map((m: string) => {
                const parts = m.split(":");
                if (parts.length < 3) {
                  console.error(`Invalid member format: ${m} (expected agentId:role:task)`);
                  process.exitCode = 1;
                  return null;
                }
                return {
                  agentId: parts[0],
                  role: parts[1],
                  task: parts.slice(2).join(":"),
                };
              })
              .filter((m): m is NonNullable<typeof m> => m !== null);

            if (members.length === 0) {
              console.error("At least one --member is required");
              return;
            }

            try {
              const created = await teamMgr.createTeam({
                name,
                strategy: opts.strategy,
                members,
              });

              console.log(`Team created:`);
              console.log(`  id: ${created.id}`);
              console.log(`  name: ${created.name}`);
              console.log(`  strategy: ${created.strategy}`);
              console.log(`  sharedNs: ${created.sharedNs}`);
              console.log(`  members: ${created.members.length}`);
              for (const m of created.members) {
                console.log(`    - ${m.agentId} (${m.role})`);
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });

        team
          .command("status")
          .description("Show team status and members")
          .argument("<teamId>", "Team ID")
          .action(async (teamId) => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Cortex offline. Cannot get team status.");
              return;
            }

            const entry = await teamMgr.getTeam(teamId);
            if (!entry) {
              console.log(`Team ${teamId} not found.`);
              return;
            }

            console.log(`Team "${entry.name}" (${entry.id}):`);
            console.log(`  status: ${entry.status}`);
            console.log(`  strategy: ${entry.strategy}`);
            console.log(`  sharedNs: ${entry.sharedNs}`);
            console.log(`  created: ${entry.createdAt}`);
            console.log(`  updated: ${entry.updatedAt}`);
            console.log(`  members:`);
            for (const m of entry.members) {
              const extra = m.result ? ` — ${m.result}` : "";
              console.log(`    - ${m.agentId} (${m.role}): ${m.status}${extra}`);
            }
            if (entry.result) {
              console.log(`  result: ${entry.result.summary}`);
            }
          });

        team
          .command("list")
          .description("List all teams")
          .option("--format <format>", "Output format (terminal|json)", "terminal")
          .action(async (opts) => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Cortex offline. Cannot list teams.");
              return;
            }

            const teams = await teamMgr.listTeams();

            if (opts.format === "json") {
              console.log(JSON.stringify(teams, null, 2));
              return;
            }

            if (teams.length === 0) {
              console.log("No teams found.");
              return;
            }

            console.log(`Teams (${teams.length}):`);
            for (const t of teams) {
              console.log(`  - ${t.id}: ${t.name} [${t.status}] (updated: ${t.updatedAt})`);
            }
          });

        team
          .command("merge")
          .description("Merge team results using configured strategy")
          .argument("<teamId>", "Team ID")
          .option("--strategy <strategy>", "Override merge strategy")
          .action(async (teamId) => {
            const healthy = await client.isHealthy();
            if (!healthy) {
              console.log("Cortex offline. Cannot merge team results.");
              return;
            }

            try {
              const result = await teamMgr.mergeTeamResults(teamId);

              console.log(`Merge result:`);
              console.log(`  summary: ${result.summary}`);
              console.log(`  conflicts: ${result.conflicts}`);
              console.log(`  member results:`);
              for (const mr of result.memberResults) {
                console.log(`    - ${mr.agentId} (${mr.role}): ${mr.findings} findings`);
              }
            } catch (err) {
              console.error(`Error: ${String(err)}`);
            }
          });
      },
      { commands: ["mesh"] },
    );

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "agent-mesh",
      async start() {
        cortexAvailable = await client.isHealthy();
        if (cortexAvailable) {
          // Register agent in graph on startup
          const agentNode = nsMgr.getPrivateNs(agentId);
          try {
            await client.createTriple({
              subject: agentNode,
              predicate: `${ns}:agent:type`,
              object: "agent",
            });
          } catch {
            // Non-fatal: agent may already be registered
          }
          api.logger.info(
            `agent-mesh: service started (cortex: connected, ns: ${ns}, agent: ${agentId})`,
          );
        } else {
          api.logger.warn(`agent-mesh: service started (cortex: offline, ns: ${ns})`);
        }
        healthMonitor.start();
      },
      async stop() {
        healthMonitor.stop();
        client.destroy();
        api.logger.info(
          `agent-mesh: service stopped (${messageLog.length} messages exchanged this session)`,
        );
      },
    });
  },
};

export default agentMeshPlugin;

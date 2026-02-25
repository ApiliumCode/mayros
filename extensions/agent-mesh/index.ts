/**
 * Mayros Agent Mesh Plugin
 *
 * Multi-agent coordination mesh with shared namespaces, delegation,
 * and knowledge fusion. Backed by AIngle Cortex sidecar for RDF storage.
 *
 * Tools: mesh_share_knowledge, mesh_request_knowledge, mesh_create_shared_space,
 *        mesh_list_agents, mesh_delegate, mesh_merge, mesh_conflicts,
 *        mesh_grant_access, mesh_revoke_access
 *
 * Hooks: subagent_spawning, subagent_ended, before_agent_start, agent_end
 *
 * CLI: mayros mesh status, mayros mesh agents, mayros mesh namespaces, mayros mesh share
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
    const messageLog: MeshMessage[] = [];

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
              subject: t.subject,
              predicate: t.predicate,
              object: t.object,
            });
            stored++;
          }

          const msg = createMeshMessage("knowledge-share", agentId, toAgent, targetNs, {
            tripleCount: stored,
          });
          messageLog.push(msg);

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

          const result = await client.patternQuery({
            subject,
            predicate,
            object: { node: sourceNs },
            limit,
          });

          if (result.matches.length === 0) {
            return {
              content: [{ type: "text", text: "No matching knowledge found." }],
              details: { count: 0, namespace: sourceNs },
            };
          }

          const text = result.matches
            .map((t) => `${t.subject} ${t.predicate} ${JSON.stringify(t.object)}`)
            .join("\n");

          return {
            content: [
              {
                type: "text",
                text: `Found ${result.matches.length} triples from ${fromAgent}:\n\n${text}`,
              },
            ],
            details: { count: result.matches.length, namespace: sourceNs },
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
            messageLog.push(msg);

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
            messageLog.push(msg);

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

            if (conflicts.length > 0) {
              const msg = createMeshMessage("conflict-alert", agentId, "mesh", ns, {
                ns1,
                ns2,
                conflictCount: conflicts.length,
              });
              messageLog.push(msg);
            }

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

    // ========================================================================
    // Lifecycle Hooks
    // ========================================================================

    // Hook: subagent_spawning — inject parent context into child agents
    api.on("subagent_spawning", async (event, _ctx) => {
      if (!(await ensureCortex())) return;

      try {
        const childId = (event as Record<string, unknown>).childAgentId as string | undefined;
        const task = (event as Record<string, unknown>).task as string | undefined;

        if (!childId || !task) return;

        api.logger.info(`agent-mesh: preparing delegation context for child ${childId}`);

        const ctx = await delegationEngine.prepareContext(task, agentId);

        if (ctx.relevantTriples.length > 0) {
          const sessionKey = `subagent-${childId}-${Date.now()}`;
          delegationEngine.injectContext(sessionKey, ctx);
          api.logger.info(
            `agent-mesh: injected ${ctx.relevantTriples.length} triples for child ${childId} (session: ${sessionKey})`,
          );
        }
      } catch (err) {
        api.logger.warn(`agent-mesh: subagent context injection failed: ${String(err)}`);
      }
    });

    // Hook: subagent_ended — merge child results back if autoMerge is enabled
    api.on("subagent_ended", async (event) => {
      if (!cfg.mesh.autoMerge) return;
      if (!(await ensureCortex())) return;

      try {
        const childId = (event as Record<string, unknown>).childAgentId as string | undefined;
        const success = (event as Record<string, unknown>).success as boolean | undefined;

        if (!childId || !success) return;

        api.logger.info(`agent-mesh: auto-merging results from child ${childId}`);

        const runId = `run-${Date.now()}`;
        const report = await delegationEngine.mergeResults(runId, agentId, childId);

        api.logger.info(
          `agent-mesh: merge complete — added: ${report.added}, skipped: ${report.skipped}, conflicts: ${report.conflicts}`,
        );
      } catch (err) {
        api.logger.warn(`agent-mesh: auto-merge failed: ${String(err)}`);
      }
    });

    // Hook: before_agent_start — register this agent in the mesh
    api.on("before_agent_start", async (event) => {
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
      } catch (err) {
        api.logger.warn(`agent-mesh: agent registration failed: ${String(err)}`);
      }
    });

    // Hook: agent_end — update agent status and persist mesh state
    api.on("agent_end", async (event) => {
      if (!(await ensureCortex())) return;

      try {
        const success = (event as Record<string, unknown>).success as boolean | undefined;

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

            try {
              await client.createTriple({
                subject,
                predicate,
                object,
              });

              console.log(`Shared triple to ${targetNs}:`);
              console.log(`  ${subject} ${predicate} "${object}"`);
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

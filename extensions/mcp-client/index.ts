/**
 * Mayros MCP Client Plugin
 *
 * Multi-transport MCP server client with Cortex tool registry integration.
 * Connects to external MCP servers, bridges their tools into Mayros, and
 * registers tool metadata as RDF triples in AIngle Cortex.
 *
 * Tools: mcp_connect, mcp_disconnect, mcp_list_tools, mcp_call_tool
 *
 * CLI: mayros mcp connect|disconnect|list|tools|status
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { mcpClientConfigSchema } from "./config.js";
import { McpCortexRegistry } from "./cortex-registry.js";
import { SessionManager } from "./session-manager.js";
import { bridgeMcpTool, classifyMcpToolKind } from "./tool-bridge.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const mcpClientPlugin = {
  id: "mcp-client",
  name: "MCP Client",
  description:
    "MCP server client with multi-transport support and Cortex tool registry for bridging external tools",
  kind: "integration" as const,
  configSchema: mcpClientConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = mcpClientConfigSchema.parse(api.pluginConfig);
    const ns = cfg.agentNamespace;
    const client = new CortexClient(cfg.cortex);

    let cortexAvailable = false;
    const registry = cfg.registerInCortex ? new McpCortexRegistry(client, ns) : undefined;
    const sessionMgr = new SessionManager(cfg, registry, api.logger);

    // Track dynamically registered tool names for cleanup
    const dynamicTools = new Map<string, string[]>(); // serverId -> tool names

    api.logger.info(`mcp-client: plugin registered (ns: ${ns}, servers: ${cfg.servers.length})`);

    // ========================================================================
    // Cortex connectivity state
    // ========================================================================

    async function ensureCortex(): Promise<boolean> {
      if (cortexAvailable) return true;
      cortexAvailable = await client.isHealthy();
      return cortexAvailable;
    }

    // ========================================================================
    // Helper: register bridged tools for a connected server
    // ========================================================================

    async function registerBridgedTools(serverId: string): Promise<number> {
      const connection = sessionMgr.getConnection(serverId);
      if (!connection || connection.status !== "connected") return 0;

      const serverConfig = cfg.servers.find((s) => s.id === serverId);
      const prefix = serverConfig?.toolPrefix;
      const registeredNames: string[] = [];

      for (const descriptor of connection.tools) {
        const bridged = bridgeMcpTool(descriptor, serverId, prefix);
        const kind =
          serverConfig?.defaultToolKind ??
          classifyMcpToolKind(descriptor.name, descriptor.description);

        api.registerTool(
          {
            name: bridged.name,
            label: bridged.label,
            description: bridged.description,
            parameters: bridged.parameters as Parameters<typeof Type.Object>[0],
            async execute(_toolCallId, params) {
              const transport = sessionMgr.getTransport(serverId);
              if (!transport || !transport.isConnected()) {
                return {
                  content: [{ type: "text", text: `Server ${serverId} is not connected.` }],
                  details: { action: "failed", reason: "not_connected" },
                };
              }

              try {
                const result = await transport.callTool(
                  bridged.originalName,
                  (params ?? {}) as Record<string, unknown>,
                );

                // Update usage in Cortex
                if (registry && (await ensureCortex())) {
                  try {
                    await registry.updateToolUsage(serverId, bridged.originalName);
                  } catch {
                    // Non-critical
                  }
                }

                const textContent = result.content
                  .map((c) => c.text ?? c.data ?? "")
                  .filter(Boolean)
                  .join("\n");

                return {
                  content: [{ type: "text", text: textContent || "(empty response)" }],
                  details: {
                    action: "called",
                    server: serverId,
                    tool: bridged.originalName,
                    isError: result.isError,
                  },
                };
              } catch (err) {
                return {
                  content: [{ type: "text", text: `Tool call failed: ${String(err)}` }],
                  details: { action: "failed", error: String(err) },
                };
              }
            },
          },
          { name: bridged.name },
        );

        registeredNames.push(bridged.name);

        // Register in Cortex
        if (registry && (await ensureCortex())) {
          try {
            await registry.registerTool(serverId, {
              name: descriptor.name,
              description: descriptor.description,
              kind,
              inputSchema: descriptor.inputSchema
                ? JSON.stringify(descriptor.inputSchema)
                : undefined,
            });
          } catch {
            // Non-critical
          }
        }
      }

      dynamicTools.set(serverId, registeredNames);
      return registeredNames.length;
    }

    // ========================================================================
    // Tools
    // ========================================================================

    // 1. mcp_connect
    api.registerTool(
      {
        name: "mcp_connect",
        label: "MCP Connect",
        description: "Connect to an MCP server by its configured ID.",
        parameters: Type.Object({
          serverId: Type.String({ description: "Server ID from config" }),
        }),
        async execute(_toolCallId, params) {
          const { serverId } = params as { serverId: string };

          try {
            const connection = await sessionMgr.connect(serverId);
            const toolCount = await registerBridgedTools(serverId);

            return {
              content: [
                {
                  type: "text",
                  text: `Connected to ${serverId} (${connection.transport}). ${toolCount} tools registered.`,
                },
              ],
              details: {
                action: "connected",
                serverId,
                transport: connection.transport,
                toolCount,
                tools: connection.tools.map((t) => t.name),
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Failed to connect to ${serverId}: ${String(err)}` }],
              details: { action: "failed", serverId, error: String(err) },
            };
          }
        },
      },
      { name: "mcp_connect" },
    );

    // 2. mcp_disconnect
    api.registerTool(
      {
        name: "mcp_disconnect",
        label: "MCP Disconnect",
        description: "Disconnect from an MCP server.",
        parameters: Type.Object({
          serverId: Type.String({ description: "Server ID to disconnect" }),
        }),
        async execute(_toolCallId, params) {
          const { serverId } = params as { serverId: string };

          try {
            await sessionMgr.disconnect(serverId);
            const toolNames = dynamicTools.get(serverId) ?? [];
            dynamicTools.delete(serverId);

            return {
              content: [
                {
                  type: "text",
                  text: `Disconnected from ${serverId}. ${toolNames.length} tools unregistered.`,
                },
              ],
              details: {
                action: "disconnected",
                serverId,
                toolsRemoved: toolNames.length,
              },
            };
          } catch (err) {
            return {
              content: [
                {
                  type: "text",
                  text: `Failed to disconnect from ${serverId}: ${String(err)}`,
                },
              ],
              details: { action: "failed", serverId, error: String(err) },
            };
          }
        },
      },
      { name: "mcp_disconnect" },
    );

    // 3. mcp_list_tools
    api.registerTool(
      {
        name: "mcp_list_tools",
        label: "MCP List Tools",
        description: "List tools available from connected MCP servers.",
        parameters: Type.Object({
          serverId: Type.Optional(
            Type.String({ description: "Filter by server ID (shows all if omitted)" }),
          ),
        }),
        async execute(_toolCallId, params) {
          const { serverId } = params as { serverId?: string };

          const connections = serverId
            ? [sessionMgr.getConnection(serverId)].filter(Boolean)
            : sessionMgr.listConnections().filter((c) => c.status === "connected");

          if (connections.length === 0) {
            return {
              content: [{ type: "text", text: "No connected servers." }],
              details: { action: "listed", toolCount: 0 },
            };
          }

          const lines: string[] = [];
          let totalTools = 0;

          for (const conn of connections) {
            if (!conn) continue;
            lines.push(`Server: ${conn.serverId} (${conn.transport})`);
            for (const tool of conn.tools) {
              const kind = classifyMcpToolKind(tool.name, tool.description);
              lines.push(`  - ${tool.name} [${kind}]: ${tool.description ?? "(no description)"}`);
              totalTools++;
            }
          }

          return {
            content: [
              {
                type: "text",
                text: `${totalTools} tool(s) from ${connections.length} server(s):\n\n${lines.join("\n")}`,
              },
            ],
            details: {
              action: "listed",
              toolCount: totalTools,
              serverCount: connections.length,
            },
          };
        },
      },
      { name: "mcp_list_tools" },
    );

    // 4. mcp_call_tool
    api.registerTool(
      {
        name: "mcp_call_tool",
        label: "MCP Call Tool",
        description: "Call a tool on a connected MCP server.",
        parameters: Type.Object({
          serverId: Type.String({ description: "Server ID" }),
          toolName: Type.String({ description: "Tool name" }),
          args: Type.Optional(
            Type.Record(Type.String(), Type.Unknown(), {
              description: "Tool arguments",
            }),
          ),
        }),
        async execute(_toolCallId, params) {
          const {
            serverId,
            toolName,
            args = {},
          } = params as {
            serverId: string;
            toolName: string;
            args?: Record<string, unknown>;
          };

          const transport = sessionMgr.getTransport(serverId);
          if (!transport || !transport.isConnected()) {
            return {
              content: [{ type: "text", text: `Server ${serverId} is not connected.` }],
              details: { action: "failed", reason: "not_connected" },
            };
          }

          try {
            const result = await transport.callTool(toolName, args);

            // Update usage in Cortex
            if (registry && (await ensureCortex())) {
              try {
                await registry.updateToolUsage(serverId, toolName);
              } catch {
                // Non-critical
              }
            }

            const textContent = result.content
              .map((c) => c.text ?? c.data ?? "")
              .filter(Boolean)
              .join("\n");

            return {
              content: [{ type: "text", text: textContent || "(empty response)" }],
              details: {
                action: "called",
                server: serverId,
                tool: toolName,
                isError: result.isError,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text", text: `Tool call failed: ${String(err)}` }],
              details: { action: "failed", server: serverId, tool: toolName, error: String(err) },
            };
          }
        },
      },
      { name: "mcp_call_tool" },
    );

    // ========================================================================
    // CLI: mayros mcp connect|disconnect|list|tools|status
    // ========================================================================

    api.registerCommand({
      name: "mcp",
      description: "MCP server client — connect, disconnect, and manage external tool servers",
      acceptsArgs: true,
      async handler(ctx) {
        const parts = (ctx.args ?? "").trim().split(/\s+/);
        const sub = parts[0] ?? "";
        const rest = parts.slice(1);

        switch (sub) {
          case "connect": {
            const targetId = rest[0];
            if (!targetId) {
              return { text: "Usage: mayros mcp connect <serverId>" };
            }
            try {
              const conn = await sessionMgr.connect(targetId);
              const toolCount = await registerBridgedTools(targetId);
              return {
                text: `Connected to ${targetId} (${conn.transport}). ${toolCount} tools bridged.`,
              };
            } catch (err) {
              return { text: `Failed: ${String(err)}` };
            }
          }

          case "disconnect": {
            const targetId = rest[0];
            if (!targetId) {
              return { text: "Usage: mayros mcp disconnect <serverId>" };
            }
            try {
              await sessionMgr.disconnect(targetId);
              dynamicTools.delete(targetId);
              return { text: `Disconnected from ${targetId}.` };
            } catch (err) {
              return { text: `Failed: ${String(err)}` };
            }
          }

          case "list": {
            const configuredServers = cfg.servers;
            if (configuredServers.length === 0) {
              return { text: "No servers configured." };
            }

            const lines = configuredServers.map((s) => {
              const conn = sessionMgr.getConnection(s.id);
              const status = conn?.status ?? "not connected";
              const toolCount = conn?.tools.length ?? 0;
              return `  ${s.id}: ${s.name ?? s.id} (${s.transport.type}) [${status}] ${toolCount} tools`;
            });

            return {
              text: `Configured servers (${configuredServers.length}):\n${lines.join("\n")}`,
            };
          }

          case "tools": {
            const targetId = rest[0];
            const connections = targetId
              ? [sessionMgr.getConnection(targetId)].filter(Boolean)
              : sessionMgr.listConnections().filter((c) => c.status === "connected");

            if (connections.length === 0) {
              return { text: "No connected servers. Use 'mayros mcp connect <serverId>' first." };
            }

            const lines: string[] = [];
            for (const conn of connections) {
              if (!conn) continue;
              lines.push(`\n  Server: ${conn.serverId} (${conn.transport})`);
              for (const tool of conn.tools) {
                const kind = classifyMcpToolKind(tool.name, tool.description);
                lines.push(`    - ${tool.name} [${kind}]`);
                if (tool.description) {
                  lines.push(`      ${tool.description}`);
                }
              }
            }

            return { text: `Available tools:${lines.join("\n")}` };
          }

          case "status": {
            const connections = sessionMgr.listConnections();
            if (connections.length === 0) {
              return { text: "No connections. Configure servers in mcp-client plugin settings." };
            }

            const lines = connections.map((c) => {
              const toolCount = c.tools.length;
              const since = c.connectedAt ? ` since ${c.connectedAt}` : "";
              const error = c.lastError ? ` (error: ${c.lastError})` : "";
              return `  ${c.serverId}: ${c.status}${since}, ${toolCount} tools${error}`;
            });

            return { text: `MCP connections (${connections.length}):\n${lines.join("\n")}` };
          }

          default:
            return {
              text: [
                "Usage: mayros mcp <command>",
                "",
                "Commands:",
                "  connect <serverId>      Connect to an MCP server",
                "  disconnect <serverId>   Disconnect from an MCP server",
                "  list                    List configured servers",
                "  tools [serverId]        List available tools",
                "  status                  Show connection status",
              ].join("\n"),
            };
        }
      },
    });

    // ========================================================================
    // Service: auto-connect on start, cleanup on stop
    // ========================================================================

    api.registerService({
      id: "mcp-client-lifecycle",
      async start() {
        // Auto-connect to configured servers
        await sessionMgr.autoConnectAll();

        // Register bridged tools for auto-connected servers
        for (const conn of sessionMgr.listConnections()) {
          if (conn.status === "connected") {
            await registerBridgedTools(conn.serverId);
          }
        }
      },
      async stop() {
        await sessionMgr.disconnectAll();
        dynamicTools.clear();
        client.destroy();
      },
    });
  },
};

export default mcpClientPlugin;

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
import { bridgeMcpContent, hasImageContent } from "./image-bridge.js";
import { OAuth2Client } from "./oauth2-client.js";
import { OAuth2TokenStore } from "./oauth2-token-store.js";
import {
  discoverOAuth2Metadata,
  buildManualMetadata,
  supportsDeviceCode,
} from "./oauth2-discovery.js";

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

    // Reverse lookup: bridged tool name -> { serverId, originalName }
    const toolOrigins = new Map<string, { serverId: string; originalName: string }>();

    // OAuth2 infrastructure
    const tokenStore = new OAuth2TokenStore(OAuth2TokenStore.defaultPath());
    const oauth2Clients = new Map<string, OAuth2Client>();

    // Create OAuth2 clients for servers with oauth2 config
    for (const server of cfg.servers) {
      if (server.transport.oauth2) {
        const oauth2Cfg = server.transport.oauth2;
        const oauthClient = new OAuth2Client(
          {
            clientId: oauth2Cfg.clientId,
            clientSecret: oauth2Cfg.clientSecret,
            scopes: oauth2Cfg.scopes ?? [],
            redirectPort: oauth2Cfg.redirectPort,
          },
          tokenStore,
        );
        oauth2Clients.set(server.id, oauthClient);
      }
    }

    const oauthServerCount = oauth2Clients.size;
    api.logger.info(
      `mcp-client: plugin registered (ns: ${ns}, servers: ${cfg.servers.length}, oauth2: ${oauthServerCount})`,
    );

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
            async execute(_toolCallId, params, _signal?, _onUpdate?) {
              const transport = sessionMgr.getTransport(serverId);
              if (!transport || !transport.isConnected()) {
                return {
                  content: [
                    { type: "text" as const, text: `Server ${serverId} is not connected.` },
                  ],
                  details: { action: "failed", reason: "not_connected" },
                };
              }

              try {
                const result = await transport.callTool(
                  bridged.originalName,
                  (params ?? {}) as Record<string, unknown>,
                );

                // Use image bridge for content with image blocks
                const content = hasImageContent(result.content)
                  ? bridgeMcpContent(result.content)
                  : (() => {
                      const textContent = result.content
                        .map((c) => c.text ?? "")
                        .filter(Boolean)
                        .join("\n");
                      return [{ type: "text" as const, text: textContent || "(empty response)" }];
                    })();

                return {
                  content,
                  details: {
                    action: "called",
                    server: serverId,
                    tool: bridged.originalName,
                    isError: result.isError,
                  },
                };
              } catch (err) {
                return {
                  content: [{ type: "text" as const, text: `Tool call failed: ${String(err)}` }],
                  details: { action: "failed", error: String(err) },
                };
              }
            },
          },
          { name: bridged.name },
        );

        registeredNames.push(bridged.name);
        toolOrigins.set(bridged.name, { serverId, originalName: descriptor.name });

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
        async execute(_toolCallId, params, _signal?, _onUpdate?) {
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
              content: [{ type: "text" as const, text: `Server ${serverId} is not connected.` }],
              details: { action: "failed", reason: "not_connected" },
            };
          }

          try {
            const result = await transport.callTool(toolName, args);

            // Use image bridge for content with image blocks
            const content = hasImageContent(result.content)
              ? bridgeMcpContent(result.content)
              : (() => {
                  const textContent = result.content
                    .map((c) => c.text ?? "")
                    .filter(Boolean)
                    .join("\n");
                  return [{ type: "text" as const, text: textContent || "(empty response)" }];
                })();

            return {
              content,
              details: {
                action: "called",
                server: serverId,
                tool: toolName,
                isError: result.isError,
              },
            };
          } catch (err) {
            return {
              content: [{ type: "text" as const, text: `Tool call failed: ${String(err)}` }],
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

    api.registerCli(
      ({ program }) => {
        const mcp = program
          .command("mcp")
          .description("MCP server client — connect, disconnect, and manage external tool servers");

        mcp
          .command("connect")
          .description("Connect to an MCP server")
          .argument("<serverId>", "Server ID from config")
          .action(async (targetId: string) => {
            try {
              const conn = await sessionMgr.connect(targetId);
              const toolCount = await registerBridgedTools(targetId);
              console.log(
                `Connected to ${targetId} (${conn.transport}). ${toolCount} tools bridged.`,
              );
            } catch (err) {
              console.log(`Failed: ${String(err)}`);
            }
          });

        mcp
          .command("disconnect")
          .description("Disconnect from an MCP server")
          .argument("<serverId>", "Server ID to disconnect")
          .action(async (targetId: string) => {
            try {
              await sessionMgr.disconnect(targetId);
              dynamicTools.delete(targetId);
              console.log(`Disconnected from ${targetId}.`);
            } catch (err) {
              console.log(`Failed: ${String(err)}`);
            }
          });

        mcp
          .command("list")
          .description("List configured servers")
          .action(async () => {
            const configuredServers = cfg.servers;
            if (configuredServers.length === 0) {
              console.log("No servers configured.");
              return;
            }

            const lines = configuredServers.map((s) => {
              const conn = sessionMgr.getConnection(s.id);
              const status = conn?.status ?? "not connected";
              const toolCount = conn?.tools.length ?? 0;
              return `  ${s.id}: ${s.name ?? s.id} (${s.transport.type}) [${status}] ${toolCount} tools`;
            });

            console.log(`Configured servers (${configuredServers.length}):\n${lines.join("\n")}`);
          });

        mcp
          .command("tools")
          .description("List available tools")
          .argument("[serverId]", "Filter by server ID (shows all if omitted)")
          .action(async (targetId?: string) => {
            const connections = targetId
              ? [sessionMgr.getConnection(targetId)].filter(Boolean)
              : sessionMgr.listConnections().filter((c) => c.status === "connected");

            if (connections.length === 0) {
              console.log("No connected servers. Use 'mayros mcp connect <serverId>' first.");
              return;
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

            console.log(`Available tools:${lines.join("\n")}`);
          });

        mcp
          .command("auth")
          .description("Authenticate with an OAuth2-configured MCP server")
          .argument("<serverId>", "Server ID to authenticate")
          .option("--device", "Force device code flow (for headless environments)")
          .action(async (targetId: string, opts: { device?: boolean }) => {
            const oauthClient = oauth2Clients.get(targetId);
            if (!oauthClient) {
              console.log(`Server "${targetId}" does not have OAuth2 configured.`);
              console.log("Servers with OAuth2:");
              for (const id of oauth2Clients.keys()) {
                console.log(`  - ${id}`);
              }
              return;
            }

            const serverConfig = cfg.servers.find((s) => s.id === targetId);
            const oauth2Cfg = serverConfig?.transport.oauth2;
            if (!oauth2Cfg) return;

            try {
              // Discover endpoints
              let metadata;
              if (oauth2Cfg.authorizationEndpoint && oauth2Cfg.tokenEndpoint) {
                const result = buildManualMetadata({
                  authorizationEndpoint: oauth2Cfg.authorizationEndpoint,
                  tokenEndpoint: oauth2Cfg.tokenEndpoint,
                  clientId: oauth2Cfg.clientId,
                  scopes: oauth2Cfg.scopes,
                  deviceAuthorizationEndpoint: oauth2Cfg.deviceAuthorizationEndpoint,
                });
                metadata = result.metadata;
              } else if (serverConfig?.transport.url) {
                console.log("Discovering OAuth2 endpoints...");
                const discovered = await discoverOAuth2Metadata(serverConfig.transport.url);
                if (!discovered) {
                  console.log("Could not discover OAuth2 endpoints. Configure them manually.");
                  return;
                }
                console.log(`Discovered endpoints (${discovered.source}).`);
                metadata = discovered.metadata;
              } else {
                console.log("No server URL or manual endpoints configured.");
                return;
              }

              // Device code flow
              if (opts.device || supportsDeviceCode(metadata)) {
                if (opts.device && !metadata.device_authorization_endpoint) {
                  console.log("Server does not support device code flow.");
                  return;
                }
                if (opts.device) {
                  const device = await oauthClient.authorizeWithDeviceCode(targetId, metadata);
                  console.log(`\nVisit: ${device.verificationUri}`);
                  console.log(`Enter code: ${device.userCode}\n`);
                  console.log("Waiting for authorization...");
                  const result = await device.pollForTokens();
                  console.log(`Authenticated via ${result.flow}.`);
                  return;
                }
              }

              // Authorization Code + PKCE flow
              const { authUrl, waitForCallback } = await oauthClient.authorizeWithPkce(
                targetId,
                metadata,
              );
              console.log(`\nOpen this URL in your browser:\n  ${authUrl}\n`);
              console.log("Waiting for authorization callback...");

              // Try to open browser
              try {
                const { exec } = await import("node:child_process");
                const openCmd =
                  process.platform === "darwin"
                    ? "open"
                    : process.platform === "win32"
                      ? "start"
                      : "xdg-open";
                exec(`${openCmd} "${authUrl}"`);
              } catch {
                // Browser open is best-effort
              }

              const result = await waitForCallback();
              console.log(`Authenticated via ${result.flow}.`);
            } catch (err) {
              console.log(`Authentication failed: ${String(err)}`);
            }
          });

        mcp
          .command("refresh")
          .description("Refresh OAuth2 tokens for an MCP server")
          .argument("<serverId>", "Server ID to refresh")
          .action(async (targetId: string) => {
            const oauthClient = oauth2Clients.get(targetId);
            if (!oauthClient) {
              console.log(`Server "${targetId}" does not have OAuth2 configured.`);
              return;
            }

            const serverConfig = cfg.servers.find((s) => s.id === targetId);
            const tokenEndpoint = serverConfig?.transport.oauth2?.tokenEndpoint;
            if (!tokenEndpoint) {
              console.log("No token endpoint configured.");
              return;
            }

            if (!tokenStore.hasRefreshToken(targetId)) {
              console.log("No refresh token stored. Run 'mayros mcp auth' first.");
              return;
            }

            try {
              const refreshed = await oauthClient.refreshAccessToken(targetId, tokenEndpoint);
              if (refreshed) {
                console.log("Token refreshed successfully.");
                if (refreshed.expiresAt) {
                  const expiresIn = Math.round((refreshed.expiresAt - Date.now()) / 1000);
                  console.log(`  Expires in: ${expiresIn}s`);
                }
              } else {
                console.log("Refresh failed. Run 'mayros mcp auth' to re-authenticate.");
              }
            } catch (err) {
              console.log(`Refresh failed: ${String(err)}`);
            }
          });

        mcp
          .command("tokens")
          .description("List stored OAuth2 tokens")
          .action(async () => {
            const serverIds = tokenStore.listServerIds();
            if (serverIds.length === 0) {
              console.log("No OAuth2 tokens stored.");
              return;
            }
            console.log(`Stored tokens (${serverIds.length}):`);
            for (const id of serverIds) {
              const entry = tokenStore.getEntry(id);
              if (!entry) continue;
              const expired = tokenStore.isExpired(id);
              const hasRefresh = tokenStore.hasRefreshToken(id);
              const status = expired ? "EXPIRED" : "VALID";
              const refresh = hasRefresh ? "has refresh token" : "no refresh token";
              const issuer = entry.issuer ? ` (${entry.issuer})` : "";
              console.log(`  ${id}: ${status}, ${refresh}${issuer}`);
            }
          });

        mcp
          .command("revoke")
          .description("Remove stored OAuth2 tokens for a server")
          .argument("<serverId>", "Server ID to revoke")
          .action(async (targetId: string) => {
            const removed = tokenStore.removeTokens(targetId);
            if (removed) {
              console.log(`Tokens for "${targetId}" removed.`);
            } else {
              console.log(`No tokens found for "${targetId}".`);
            }
          });

        mcp
          .command("status")
          .description("Show connection status")
          .action(async () => {
            const connections = sessionMgr.listConnections();
            if (connections.length === 0) {
              console.log("No connections. Configure servers in mcp-client plugin settings.");
              return;
            }

            const lines = connections.map((c) => {
              const toolCount = c.tools.length;
              const since = c.connectedAt ? ` since ${c.connectedAt}` : "";
              const error = c.lastError ? ` (error: ${c.lastError})` : "";
              return `  ${c.serverId}: ${c.status}${since}, ${toolCount} tools${error}`;
            });

            console.log(`MCP connections (${connections.length}):\n${lines.join("\n")}`);
          });
      },
      { commands: ["mcp"] },
    );

    // ========================================================================
    // Hook: after_tool_call — update MCP tool usage in Cortex
    // ========================================================================

    api.on("after_tool_call", async (event, _ctx) => {
      if (!registry) return;

      const toolName = event.toolName;

      // Case 1: Direct bridged tool call
      const origin = toolOrigins.get(toolName);
      if (origin) {
        if (await ensureCortex()) {
          try {
            await registry.updateToolUsage(origin.serverId, origin.originalName);
          } catch {
            // Non-critical — usage tracking is best-effort
          }
        }
        return;
      }

      // Case 2: mcp_call_tool invocation — extract serverId/toolName from params
      if (toolName === "mcp_call_tool" && event.params) {
        const params = event.params as { serverId?: string; toolName?: string };
        if (params.serverId && params.toolName && (await ensureCortex())) {
          try {
            await registry.updateToolUsage(params.serverId, params.toolName);
          } catch {
            // Non-critical — usage tracking is best-effort
          }
        }
      }
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
        toolOrigins.clear();
        client.destroy();
      },
    });
  },
};

export default mcpClientPlugin;

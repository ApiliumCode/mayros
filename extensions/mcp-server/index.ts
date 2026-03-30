/**
 * MCP Server Plugin.
 *
 * Exposes Mayros Gateway's tools, Cortex resources, and workflow prompts
 * via the Model Context Protocol (MCP). Any MCP client (VSCode, Cursor,
 * JetBrains, Claude Desktop, custom apps) can discover and use Mayros
 * capabilities through this server.
 *
 * Transports:
 *   - stdio:  For local IDE integrations (launch via `mayros serve --stdio`)
 *   - http:   Streamable HTTP for remote clients (`mayros serve --http`)
 *
 * Configuration: mayros.json → plugins.mcp-server
 */

// @ts-expect-error — dist/index.js has no declaration file; types resolved via source paths
import type { MayrosPluginApi, MayrosPluginToolContext } from "@apilium/mayros";
import { mcpServerConfigSchema, type McpServerConfig } from "./config.js";
import { McpServer, type McpServerOptions } from "./server.js";
import type { AdaptableTool } from "./tool-adapter.js";
import type { ResourceDataSources, AgentInfo } from "./resource-provider.js";
import type { PromptDataSources } from "./prompt-provider.js";

// ============================================================================
// Plugin
// ============================================================================

const mcpServerPlugin = {
  id: "mcp-server",
  name: "MCP Server",
  kind: "integration" as const,
  configSchema: mcpServerConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = mcpServerConfigSchema.parse(api.pluginConfig) as McpServerConfig;
    let server: McpServer | null = null;

    // ── Collect tools from the plugin registry ──────────────────────

    const collectTools = async (ctx: MayrosPluginToolContext): Promise<AdaptableTool[]> => {
      try {
        // Dynamically import the plugin tool resolver to avoid circular deps
        // at module load time. resolvePluginTools discovers all registered
        // plugin tools for the given context and returns AnyAgentTool[].
        const { resolvePluginTools } = (await import("../../src/plugins/tools.js")) as {
          resolvePluginTools: (params: { context: MayrosPluginToolContext }) => Array<{
            name: string;
            label?: string;
            description?: string;
            parameters?: unknown;
            execute: (...args: unknown[]) => Promise<unknown>;
          }>;
        };

        const tools = resolvePluginTools({ context: ctx });
        return tools.map((tool) => ({
          name: tool.name,
          label: tool.label,
          description: tool.description,
          parameters: tool.parameters,
          execute: async (
            toolCallId: string,
            params: Record<string, unknown>,
            signal?: AbortSignal,
          ) => {
            const result = await tool.execute(toolCallId, params, signal);
            const typed = result as {
              content?: Array<{ type: string; text?: string }>;
              details?: unknown;
            };
            return {
              content: typed.content ?? [{ type: "text" as const, text: JSON.stringify(result) }],
              details: typed.details,
            };
          },
        }));
      } catch {
        // Plugin tool resolution not available (e.g. during early loading)
        return [];
      }
    };

    // ── Resource data sources (stubs — wired at service start) ──────

    const emptyAgents: AgentInfo[] = [];

    const resourceSources: ResourceDataSources = {
      listAgents: () => emptyAgents,
      getAgent: () => null,
      listConventions: async () => [],
      getConvention: async () => null,
      listRules: async () => [],
      getRule: async () => null,
      getGraphStats: async () => null,
      listGraphSubjects: async () => [],
      getDagTips: async () => null,
      getDagStats: async () => null,
    };

    const promptSources: PromptDataSources = {
      listConventions: async () => [],
      resolveRules: async () => [],
      getAgentIdentity: () => null,
      listAgentIds: () => [],
    };

    // ── Register tools ──────────────────────────────────────────────

    api.registerTool(
      {
        name: "mcp_server_status",
        label: "MCP Server Status",
        description: "Check the status of the MCP server",
        parameters: {},
        async execute() {
          if (!server) {
            return {
              content: [{ type: "text" as const, text: "MCP server not started" }],
            };
          }
          const status = server.status();
          return {
            content: [
              {
                type: "text" as const,
                text: [
                  `MCP Server: ${status.running ? "running" : "stopped"}`,
                  `Transport: ${status.transport}`,
                  status.address ? `Address: ${status.address}` : null,
                  `Tools exposed: ${status.toolCount}`,
                  `Initialized: ${status.initialized}`,
                ]
                  .filter(Boolean)
                  .join("\n"),
              },
            ],
          };
        },
      },
      { name: "mcp_server_status" },
    );

    // ── Register CLI ────────────────────────────────────────────────

    api.registerCli(({ program }: { program: any }) => {
      const serve = program
        .command("serve")
        .description("Start MCP server to expose Mayros tools, resources, and prompts");

      serve
        .option("--stdio", "Use stdio transport (for IDE integration)")
        .option("--http", "Use HTTP transport (for remote clients)")
        .option("--port <port>", "HTTP port (default: 19100)", parseInt)
        .option("--host <host>", "HTTP host (default: 127.0.0.1)")
        .action(async (opts: { stdio?: boolean; http?: boolean; port?: number; host?: string }) => {
          const transport = opts.stdio ? "stdio" : opts.http ? "http" : cfg.transport;
          const port = opts.port ?? cfg.port;
          const host = opts.host ?? cfg.host;

          const serverCfg: McpServerConfig = {
            ...cfg,
            transport,
            port,
            host,
          };

          // Auto-start Cortex sidecar for memory and graph tools
          let sidecar: { stop: () => Promise<void> } | null = null;
          try {
            const { CortexSidecar } = (await import("../memory-semantic/cortex-sidecar.js")) as {
              CortexSidecar: new (cfg: unknown) => {
                start: () => Promise<boolean>;
                stop: () => Promise<void>;
              };
            };
            const instance = new CortexSidecar(serverCfg.cortex);
            const started = await instance.start();
            if (started) {
              sidecar = instance;
              api.logger.info("Cortex sidecar started for MCP server");
            } else {
              api.logger.warn("Cortex sidecar failed to start — memory tools will be unavailable");
            }
          } catch (err) {
            api.logger.warn(`Cortex sidecar not available: ${String(err)}`);
          }

          // Collect auto-discovered plugin tools
          const pluginTools = await collectTools({});

          // Register dedicated MCP tools
          const cortexPort = cfg.cortex?.port ?? 19090;
          const cortexBase = `http://127.0.0.1:${cortexPort}`;
          const ns = serverCfg.agentNamespace || "mayros";

          const { createMemoryTools } = await import("./memory-tools.js");
          const { createBudgetTools } = await import("./budget-tools.js");
          const { createGovernanceTools } = await import("./governance-tools.js");
          const { createCortexTools } = await import("./cortex-tools.js");

          const authToken = cfg.cortex?.authToken;
          const mcpTools: AdaptableTool[] = [
            ...createMemoryTools({ cortexBaseUrl: cortexBase, namespace: ns, authToken }),
            ...createBudgetTools(),
            ...createGovernanceTools(),
            ...createCortexTools({ cortexBaseUrl: cortexBase, namespace: ns, authToken }),
          ];

          // Memory health tools
          const { createMemoryHealthTools } = await import("./memory-health-tools.js");
          mcpTools.push(
            ...createMemoryHealthTools({ cortexBaseUrl: cortexBase, namespace: ns, authToken }),
          );

          // DAG tools — enabled by default, opt-out via cortex.dag.enabled = false
          if (cfg.cortex?.dag?.enabled !== false) {
            const { createDagTools } = await import("./dag-tools.js");
            mcpTools.push(
              ...createDagTools({ cortexBaseUrl: cortexBase, namespace: ns, authToken }),
            );
          }

          // Kaneru tools — multi-agent coordination
          const { createKaneruTools } = await import("./kaneru-tools.js");
          mcpTools.push(
            ...createKaneruTools({ cortexBaseUrl: cortexBase, namespace: ns, authToken }),
          );

          // Venture tools — ventures, missions, fuel, pulse
          const { createVentureTools } = await import("./venture-tools.js");
          mcpTools.push(
            ...createVentureTools({ cortexBaseUrl: cortexBase, namespace: ns, authToken }),
          );

          // Combine: dedicated MCP tools first, then auto-discovered plugin tools
          const allTools = [...mcpTools, ...pluginTools];

          const serverOpts: McpServerOptions = {
            config: serverCfg,
            tools: allTools,
            resourceSources,
            promptSources,
            logger: {
              info: (msg) => api.logger.info(msg),
              warn: (msg) => api.logger.warn(msg),
              error: (msg) => api.logger.error(msg),
            },
          };

          server = new McpServer(serverOpts);
          await server.start();

          // Register shutdown handler for sidecar cleanup
          const shutdown = () => {
            void (async () => {
              if (sidecar) await sidecar.stop();
              await server?.stop();
            })();
          };
          process.on("SIGINT", shutdown);
          process.on("SIGTERM", shutdown);

          if (transport !== "stdio") {
            const status = server.status();
            api.logger.info(
              `MCP server running at ${status.address ?? "unknown"} (${status.toolCount} tools)`,
            );
            // Keep process alive for HTTP mode
            await new Promise<void>((resolve) => {
              process.on("SIGINT", resolve);
              process.on("SIGTERM", resolve);
            });
          }
        });

      // mcp-setup command
      program
        .command("mcp-setup")
        .description("Register Mayros as an MCP server in Claude (Code or Desktop)")
        .option("--desktop", "Configure Claude Desktop (writes config file)")
        .option("--stdio", "Use stdio transport (default)")
        .option("--http", "Use HTTP transport (connect to pre-running server)")
        .option("--port <port>", "HTTP port (default: 19100)", parseInt)
        .option("--host <host>", "HTTP host (default: 127.0.0.1)")
        .action(
          async (opts: {
            desktop?: boolean;
            stdio?: boolean;
            http?: boolean;
            port?: number;
            host?: string;
          }) => {
            const { setupClaudeCodeMcp } = await import("./setup-claude.js");
            await setupClaudeCodeMcp({
              port: opts.port ?? cfg.port,
              host: opts.host ?? cfg.host,
              transport: opts.http ? "http" : "stdio",
              target: opts.desktop ? "desktop" : "code",
            });
          },
        );
    });

    // ── Register gateway method (MCP Dashboard) ────────────────────

    api.registerGatewayMethod("mcp.dashboard", async ({ respond }: { respond: any }) => {
      // Cortex health check with 3s timeout — always runs
      let cortexHealth: { status: "online" | "offline"; latencyMs: number };
      try {
        const cortexPort = cfg.cortex?.port ?? 19090;
        const cortexUrl = `http://127.0.0.1:${cortexPort}/api/v1/health`;
        const start = Date.now();
        const cortexRes = await fetch(cortexUrl, {
          signal: AbortSignal.timeout(3000),
        });
        const latencyMs = Date.now() - start;
        cortexHealth = {
          status: cortexRes.ok ? "online" : "offline",
          latencyMs,
        };
      } catch {
        cortexHealth = { status: "offline", latencyMs: 0 };
      }

      if (!server) {
        respond(true, {
          status: {
            running: false,
            transport: cfg.transport ?? "http",
            toolCount: 0,
            initialized: false,
            uptimeMs: 0,
            sseSessionCount: 0,
          },
          metrics: null,
          cortexHealth,
        });
        return;
      }

      const status = server.status();
      const metrics = server.getMetrics();
      respond(true, { status, metrics, cortexHealth });
    });

    // ── Register service lifecycle ──────────────────────────────────

    api.registerService({
      id: "mcp-server-lifecycle",
      async start() {
        // Wire up agent discovery for resources
        try {
          const { discoverMarkdownAgents } = await import("../../src/agents/markdown-agents.js");
          const agents = discoverMarkdownAgents();
          const agentInfos: AgentInfo[] = agents.map((a) => ({
            id: a.id,
            name: a.name,
            model: a.model,
            allowedTools: a.allowedTools,
            isDefault: a.isDefault,
            identity: a.identity,
            origin: a.origin,
          }));

          resourceSources.listAgents = () => agentInfos;
          resourceSources.getAgent = (id: string) => agentInfos.find((a) => a.id === id) ?? null;

          promptSources.getAgentIdentity = (id: string) => {
            const agent = agentInfos.find((a) => a.id === id);
            return agent?.identity ?? null;
          };
          promptSources.listAgentIds = () => agentInfos.map((a) => a.id);
        } catch {
          // Agent discovery not available in all contexts
        }

        // Wire up Cortex-backed resources if available
        try {
          const { CortexClient } = await import("../shared/cortex-client.js");
          const client = new CortexClient(cfg.cortex);
          const ns = cfg.agentNamespace;

          resourceSources.listConventions = async () => {
            try {
              const res = await client.patternQuery({
                subject: `${ns}:project:convention:*`,
                predicate: `${ns}:convention:text`,
              });
              return res.matches.map((m) => ({
                id: m.subject.split(":").pop() ?? "",
                text: typeof m.object === "string" ? m.object : JSON.stringify(m.object),
                category: "general",
                source: "cortex",
                confidence: 1,
                status: "active",
                createdAt: m.created_at ?? "",
              }));
            } catch {
              return [];
            }
          };

          resourceSources.getGraphStats = async () => {
            try {
              const stats = await client.stats();
              return {
                tripleCount: stats.graph.triple_count,
                subjectCount: stats.graph.subject_count,
                predicateCount: stats.graph.predicate_count,
              };
            } catch {
              return null;
            }
          };

          resourceSources.listGraphSubjects = async () => {
            try {
              const res = await client.listSubjects({ predicate: ns, limit: 200 });
              return res.subjects;
            } catch {
              return [];
            }
          };

          resourceSources.getConvention = async (id: string) => {
            try {
              const res = await client.patternQuery({
                subject: `${ns}:project:convention:${id}`,
                predicate: `${ns}:convention:text`,
              });
              const match = res.matches[0];
              if (!match) return null;
              return {
                id,
                text:
                  typeof match.object === "string" ? match.object : JSON.stringify(match.object),
                category: "general",
                source: "cortex",
                confidence: 1,
                status: "active",
                createdAt: match.created_at ?? "",
              };
            } catch {
              return null;
            }
          };

          resourceSources.listRules = async () => {
            try {
              const res = await client.patternQuery({
                subject: `${ns}:rule:*`,
                predicate: `${ns}:rule:content`,
              });
              return res.matches.map((m) => ({
                id: m.subject.split(":").pop() ?? "",
                content: typeof m.object === "string" ? m.object : JSON.stringify(m.object),
                scope: "global",
                priority: 0,
                source: "cortex",
                enabled: true,
              }));
            } catch {
              return [];
            }
          };

          resourceSources.getRule = async (id: string) => {
            try {
              const res = await client.patternQuery({
                subject: `${ns}:rule:${id}`,
                predicate: `${ns}:rule:content`,
              });
              const match = res.matches[0];
              if (!match) return null;
              return {
                id,
                content:
                  typeof match.object === "string" ? match.object : JSON.stringify(match.object),
                scope: "global",
                priority: 0,
                source: "cortex",
                enabled: true,
              };
            } catch {
              return null;
            }
          };

          promptSources.listConventions = resourceSources.listConventions as () => Promise<
            Array<{ text: string; category: string; confidence: number }>
          >;

          promptSources.resolveRules = async (scope: string) => {
            try {
              const res = await client.patternQuery({
                subject: `${ns}:rule:${scope}:*`,
                predicate: `${ns}:rule:content`,
              });
              return res.matches.map((m) => ({
                content: typeof m.object === "string" ? m.object : JSON.stringify(m.object),
                scope,
                priority: 0,
              }));
            } catch {
              return [];
            }
          };

          // DAG resources — enabled by default
          if (cfg.cortex?.dag?.enabled !== false) {
            resourceSources.getDagTips = async () => {
              try {
                const data = await client.dagTips();
                return { tips: data.tips, count: data.count };
              } catch {
                return null;
              }
            };

            resourceSources.getDagStats = async () => {
              try {
                const data = await client.dagStats();
                return { actionCount: data.action_count, tipCount: data.tip_count };
              } catch {
                return null;
              }
            };
          }
        } catch {
          // Cortex not available
        }
      },
      async stop() {
        if (server) {
          await server.stop();
          server = null;
        }
      },
    });
  },
};

export default mcpServerPlugin;

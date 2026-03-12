/**
 * `mayros serve` — Start MCP server.
 *
 * Exposes Mayros tools, Cortex resources, and workflow prompts via
 * the Model Context Protocol. Any MCP client can connect and use
 * Mayros capabilities.
 *
 * Usage:
 *   mayros serve --stdio         # stdio transport (IDE integration)
 *   mayros serve --http          # HTTP transport (remote clients)
 *   mayros serve --http --port 3100
 */

import type { Command } from "commander";

export function registerServeCli(program: Command): void {
  program
    .command("serve")
    .description("Start MCP server to expose Mayros tools, resources, and prompts")
    .option("--stdio", "Use stdio transport (for IDE integration)")
    .option("--http", "Use HTTP transport (for remote clients)")
    .option("--port <port>", "HTTP port (default: 19100)", parseInt)
    .option("--host <host>", "HTTP host (default: 127.0.0.1)")
    .action(async (opts: { stdio?: boolean; http?: boolean; port?: number; host?: string }) => {
      const { McpServer } = await import("../../extensions/mcp-server/server.js");
      const { mcpServerConfigSchema } = await import("../../extensions/mcp-server/config.js");

      const transport = opts.stdio ? ("stdio" as const) : ("http" as const);

      const config = mcpServerConfigSchema.parse({
        transport,
        ...(opts.port != null && { port: opts.port }),
        ...(opts.host != null && { host: opts.host }),
      });

      // Auto-start Cortex sidecar
      let sidecar: { stop: () => Promise<void> } | null = null;
      try {
        const { CortexSidecar } =
          (await import("../../extensions/memory-semantic/cortex-sidecar.js")) as {
            CortexSidecar: new (cfg: unknown) => {
              start: () => Promise<boolean>;
              stop: () => Promise<void>;
            };
          };
        const instance = new CortexSidecar(config.cortex);
        const started = await instance.start();
        if (started) {
          sidecar = instance;
          process.stderr.write("Cortex sidecar started\n");
        }
      } catch {
        // Cortex sidecar not available
      }

      // Load dedicated MCP tools
      const cortexPort = config.cortex?.port ?? 19090;
      const cortexBase = `http://127.0.0.1:${cortexPort}`;
      const ns = config.agentNamespace || "mayros";

      const { createMemoryTools } = await import("../../extensions/mcp-server/memory-tools.js");
      const { createBudgetTools } = await import("../../extensions/mcp-server/budget-tools.js");
      const { createGovernanceTools } =
        await import("../../extensions/mcp-server/governance-tools.js");
      const { createCortexTools } = await import("../../extensions/mcp-server/cortex-tools.js");

      const tools = [
        ...createMemoryTools({ cortexBaseUrl: cortexBase, namespace: ns }),
        ...createBudgetTools(),
        ...createGovernanceTools(),
        ...createCortexTools({ cortexBaseUrl: cortexBase, namespace: ns }),
      ];

      // Discover agents
      let agentInfos: Array<{
        id: string;
        name: string;
        model?: string;
        allowedTools?: string[];
        isDefault: boolean;
        identity: string;
        origin: "project" | "user";
      }> = [];

      try {
        const { discoverMarkdownAgents } = await import("../agents/markdown-agents.js");
        const agents = discoverMarkdownAgents();
        agentInfos = agents.map((a) => ({
          id: a.id,
          name: a.name,
          model: a.model,
          allowedTools: a.allowedTools,
          isDefault: a.isDefault,
          identity: a.identity,
          origin: a.origin,
        }));
      } catch {
        // Agent discovery not available
      }

      const server = new McpServer({
        config,
        tools,
        resourceSources: {
          listAgents: () => agentInfos,
          getAgent: (id) => agentInfos.find((a) => a.id === id) ?? null,
          listConventions: async () => [],
          getConvention: async () => null,
          listRules: async () => [],
          getRule: async () => null,
          getGraphStats: async () => null,
          listGraphSubjects: async () => [],
        },
        promptSources: {
          listConventions: async () => [],
          resolveRules: async () => [],
          getAgentIdentity: (id) => {
            const agent = agentInfos.find((a) => a.id === id);
            return agent?.identity ?? null;
          },
          listAgentIds: () => agentInfos.map((a) => a.id),
        },
        logger: {
          info: (msg) => process.stderr.write(`${msg}\n`),
          warn: (msg) => process.stderr.write(`WARN: ${msg}\n`),
          error: (msg) => process.stderr.write(`ERROR: ${msg}\n`),
        },
      });

      await server.start();

      // Shutdown handler: stop server + sidecar
      const shutdown = () => {
        void (async () => {
          if (sidecar) await sidecar.stop();
          await server.stop();
        })();
      };
      process.on("SIGINT", shutdown);
      process.on("SIGTERM", shutdown);

      if (transport !== "stdio") {
        const status = server.status();
        process.stderr.write(
          `MCP server running at ${status.address ?? "unknown"}\n` +
            `Tools: ${status.toolCount} | Transport: ${status.transport}\n` +
            `Agents: ${agentInfos.length} | Press Ctrl+C to stop\n`,
        );

        await new Promise<void>((resolve) => {
          process.on("SIGINT", resolve);
          process.on("SIGTERM", resolve);
        });
      }
    });
}

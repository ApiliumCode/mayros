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
    .option("--port <port>", "HTTP port (default: 3100)", parseInt)
    .option("--host <host>", "HTTP host (default: 127.0.0.1)")
    .action(async (opts: { stdio?: boolean; http?: boolean; port?: number; host?: string }) => {
      const { McpServer } = await import("../../extensions/mcp-server/server.js");
      const { mcpServerConfigSchema } = await import("../../extensions/mcp-server/config.js");

      const transport = opts.stdio ? ("stdio" as const) : ("http" as const);
      const port = opts.port ?? 3100;
      const host = opts.host ?? "127.0.0.1";

      const config = mcpServerConfigSchema.parse({
        transport,
        port,
        host,
      });

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
        tools: [],
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

      if (transport !== "stdio") {
        const status = server.status();
        process.stderr.write(
          `MCP server running at ${status.address ?? "unknown"}\n` +
            `Tools: ${status.toolCount} | Transport: ${status.transport}\n` +
            `Agents: ${agentInfos.length} | Press Ctrl+C to stop\n`,
        );

        await new Promise<void>((resolve) => {
          process.on("SIGINT", () => {
            void server.stop().then(resolve);
          });
          process.on("SIGTERM", () => {
            void server.stop().then(resolve);
          });
        });
      }
    });
}

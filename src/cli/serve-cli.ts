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

      // Shutdown handler: stop server + sidecar (both must run even if one fails)
      let shuttingDown = false;
      const shutdown = async () => {
        if (shuttingDown) return;
        shuttingDown = true;
        try {
          await server.stop();
        } catch (err: unknown) {
          process.stderr.write(`ERROR stopping server: ${String(err)}\n`);
        }
        try {
          if (sidecar) await sidecar.stop();
        } catch (err: unknown) {
          process.stderr.write(`ERROR stopping sidecar: ${String(err)}\n`);
        }
      };

      if (transport !== "stdio") {
        const status = server.status();
        process.stderr.write(
          `MCP server running at ${status.address ?? "unknown"}\n` +
            `Tools: ${status.toolCount} | Transport: ${status.transport}\n` +
            `Agents: ${agentInfos.length} | Press Ctrl+C to stop\n`,
        );

        await new Promise<void>((resolve) => {
          const onSignal = () => {
            void shutdown().finally(resolve);
          };
          process.once("SIGINT", onSignal);
          process.once("SIGTERM", onSignal);
        });
      } else {
        process.once("SIGINT", () => void shutdown());
        process.once("SIGTERM", () => void shutdown());
      }
    });
}

export function registerMcpSetupCli(program: Command): void {
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
        const { setupClaudeCodeMcp } = await import("../../extensions/mcp-server/setup-claude.js");
        await setupClaudeCodeMcp({
          port: opts.port ?? 19100,
          host: opts.host ?? "127.0.0.1",
          transport: opts.http ? "http" : "stdio",
          target: opts.desktop ? "desktop" : "code",
        });
      },
    );
}

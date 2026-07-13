import { randomUUID } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { parseKakeruConfig, kakeruConfigSchema } from "./config.js";
import { PlatformCoordinator } from "./coordinator.js";
import { ClaudeBridge } from "./bridges/claude-bridge.js";
import { CodexBridge } from "./bridges/codex-bridge.js";

const kakeruPlugin = {
  id: "kakeru-bridge",
  name: "Kakeru Bridge",
  description:
    "Dual-platform coordination — run tasks across Claude Code and Codex CLI in parallel",
  kind: "coordination" as const,
  configSchema: kakeruConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = parseKakeruConfig(api.pluginConfig);
    if (!cfg.enabled) {
      api.logger.info("kakeru: disabled (opt-in required)");
      return;
    }

    const coordinator = new PlatformCoordinator();

    // Always register Claude bridge (native)
    const claudeBridge = new ClaudeBridge();
    try {
      await claudeBridge.connect();
      coordinator.registerBridge(claudeBridge);
    } catch (err) {
      api.logger.warn(`kakeru: Claude bridge failed to connect: ${String(err)}`);
    }

    // Optionally register Codex bridge
    if (cfg.codex.enabled) {
      const codexBridge = new CodexBridge({
        binaryPath: cfg.codex.binaryPath,
        apiKeyEnv: cfg.codex.apiKeyEnv,
        defaultTimeout: cfg.codex.defaultTimeout,
      });
      try {
        await codexBridge.connect();
        coordinator.registerBridge(codexBridge);
        api.logger.info("kakeru: Codex bridge connected");
      } catch (err) {
        api.logger.warn(`kakeru: Codex bridge failed to connect: ${String(err)}`);
      }
    }

    // session_end — cleanup
    api.on("session_end", async () => {
      for (const bridge of coordinator.listBridges()) {
        coordinator.releaseAllLocks(bridge.id);
      }
    });

    // Tool: platform_status
    api.registerTool({
      name: "platform_status",
      label: "Platform Status",
      description: "List all registered platform bridges and their status",
      parameters: Type.Object({}),
      execute: async (_toolCallId: string) => {
        const bridges = coordinator.listBridges();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(bridges, null, 2),
            },
          ],
          details: undefined,
        };
      },
    });

    // Tool: platform_execute
    api.registerTool({
      name: "platform_execute",
      label: "Platform Execute",
      description: "Execute a task on a specific platform bridge",
      parameters: Type.Object({
        platform: Type.String({ description: "Platform ID (claude, codex)" }),
        prompt: Type.String({ description: "Task prompt to execute" }),
        workDir: Type.Optional(
          Type.String({ description: "Working directory (defaults to current)" }),
        ),
        timeout: Type.Optional(Type.Number({ description: "Timeout in ms" })),
      }),
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as {
          platform: string;
          prompt: string;
          workDir?: string;
          timeout?: number;
        };
        const bridge = coordinator.getBridge(params.platform);
        if (!bridge) {
          return {
            content: [
              { type: "text" as const, text: `Platform "${params.platform}" not registered` },
            ],
            details: undefined,
          };
        }

        const task = {
          id: randomUUID(),
          prompt: params.prompt,
          workDir: params.workDir ?? process.cwd(),
          timeout: params.timeout,
        };

        try {
          const result = await bridge.executeTask(task);
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(result, null, 2),
              },
            ],
            details: undefined,
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Execution failed: ${String(err)}` }],
            details: undefined,
          };
        }
      },
    });

    // Tool: platform_workflow
    api.registerTool({
      name: "platform_workflow",
      label: "Platform Workflow",
      description: "Execute tasks across multiple platforms in parallel",
      parameters: Type.Object({
        tasks: Type.Array(
          Type.Object({
            platform: Type.String({ description: "Platform ID" }),
            prompt: Type.String({ description: "Task prompt" }),
            filePaths: Type.Optional(Type.Array(Type.String(), { description: "Files to lock" })),
          }),
        ),
      }),
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as {
          tasks: Array<{ platform: string; prompt: string; filePaths?: string[] }>;
        };
        const workDir =
          ((api.config as Record<string, unknown> | undefined)?.workspaceDir as
            | string
            | undefined) ?? process.cwd();
        const workflowTasks = params.tasks.map((t) => ({
          platformId: t.platform,
          task: {
            id: randomUUID(),
            prompt: t.prompt,
            workDir,
            constraints: t.filePaths ? { filePaths: t.filePaths } : undefined,
          },
        }));

        const results = await coordinator.executeWorkflow(workflowTasks, cfg.branchPrefix);
        const output: Record<string, unknown> = {};
        for (const [id, result] of results) {
          output[id] = result;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(output, null, 2),
            },
          ],
          details: undefined,
        };
      },
    });

    // CLI
    api.registerCli(
      (ctx) => {
        const cmd = ctx.program
          .command("platform")
          .description("Kakeru platform bridge management");

        cmd
          .command("list")
          .description("List registered platforms")
          .action(() => {
            const bridges = coordinator.listBridges();
            for (const b of bridges) {
              console.log(`  ${b.id} (${b.name}) — ${b.status} [${b.capabilities.join(", ")}]`);
            }
          });

        cmd
          .command("test")
          .description("Test platform connectivity")
          .action(async () => {
            const bridges = coordinator.listBridges();
            for (const b of bridges) {
              console.log(`  ${b.id}: ${b.status}`);
            }
          });
      },
      { commands: ["platform"] },
    );

    api.logger.info(`kakeru: initialized with ${coordinator.listBridges().length} bridge(s)`);
  },
};

export default kakeruPlugin;

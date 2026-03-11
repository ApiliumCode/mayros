import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { parseHayameruConfig, hayameruConfigSchema } from "./config.js";
import { detectIntent } from "./intent-detector.js";
import { getTransform, listTransforms } from "./transforms/index.js";
import { HayameruMetrics } from "./metrics.js";

const hayameruPlugin = {
  id: "hayameru",
  name: "Hayameru",
  description:
    "Deterministic code transforms that bypass LLM for simple edits — zero tokens, sub-millisecond",
  kind: "optimization" as const,
  configSchema: hayameruConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = parseHayameruConfig(api.pluginConfig);
    if (!cfg.enabled) {
      api.logger.info("hayameru: disabled by config");
      return;
    }

    const metrics = new HayameruMetrics();
    const workDir = api.config?.workspaceDir ?? process.cwd();

    // before_agent_run hook — intercept simple code edits
    api.on(
      "before_agent_run",
      async (event) => {
        const start = performance.now();
        const intent = detectIntent(event.prompt);

        if (intent.kind === "none" || intent.confidence < cfg.confidenceThreshold) {
          return; // fall through to LLM
        }

        if (!cfg.transforms[intent.kind]) {
          return; // this transform is disabled
        }

        const transform = getTransform(intent.kind);
        if (!transform) return;

        // Resolve file path
        if (!intent.filePath) return; // need a target file

        const rawResolved = path.isAbsolute(intent.filePath)
          ? intent.filePath
          : path.resolve(workDir, intent.filePath);

        // Prevent path traversal — resolved path must be inside workspace
        let resolvedPath: string;
        try {
          resolvedPath = await fs.realpath(rawResolved);
          const realWorkDir = await fs.realpath(workDir);
          if (resolvedPath !== realWorkDir && !resolvedPath.startsWith(realWorkDir + path.sep)) {
            api.logger.warn(`hayameru: path traversal blocked: ${intent.filePath}`);
            return;
          }
        } catch {
          // File doesn't exist yet or path is invalid — try without realpath
          const normalized = path.normalize(rawResolved);
          const normalizedWork = path.normalize(workDir);
          if (normalized !== normalizedWork && !normalized.startsWith(normalizedWork + path.sep)) {
            api.logger.warn(`hayameru: path traversal blocked: ${intent.filePath}`);
            return;
          }
          resolvedPath = normalized;
        }

        if (cfg.metrics.enabled) metrics.recordAttempt();

        try {
          const stat = await fs.stat(resolvedPath);
          if (stat.size > cfg.maxFileSize) {
            api.logger.warn(`hayameru: file too large (${stat.size} bytes > ${cfg.maxFileSize})`);
            return;
          }

          const source = await fs.readFile(resolvedPath, "utf-8");
          const result = transform(source, resolvedPath);

          if (!result.changed) {
            return; // nothing to do, fall through to LLM
          }

          // Atomic write: backup → tmp → rename
          const tmpPath = resolvedPath + ".hayameru-tmp";
          const bakPath = resolvedPath + ".hayameru-bak";
          await fs.copyFile(resolvedPath, bakPath);
          await fs.writeFile(tmpPath, result.output, "utf-8");
          await fs.rename(tmpPath, resolvedPath);

          const durationMs = performance.now() - start;
          if (cfg.metrics.enabled) metrics.recordSuccess(intent.kind, durationMs, stat.size);

          const estimatedTokens = Math.ceil(stat.size / 4);
          const summary = [
            `**Hayameru** — ${result.description}`,
            `File: \`${path.relative(workDir, resolvedPath)}\``,
            `Edits: ${result.edits} | Time: ${durationMs.toFixed(1)}ms | Est. tokens saved: ~${estimatedTokens}`,
          ].join("\n");

          return {
            shortCircuit: true,
            response: summary,
            metadata: {
              hayameru: true,
              transform: intent.kind,
              edits: result.edits,
              durationMs,
            },
          };
        } catch (err) {
          if (cfg.metrics.enabled) metrics.recordFailure();
          api.logger.warn(`hayameru: transform failed: ${String(err)}`);
          return; // fall through to LLM
        }
      },
      { priority: 100 },
    );

    // Tool: hayameru_status
    api.registerTool({
      name: "hayameru_status",
      description: "Show Hayameru code transform metrics and available transforms",
      parameters: Type.Object({}),
      execute: async () => {
        const m = metrics.getMetrics();
        const transforms = listTransforms();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  metrics: m,
                  transforms: transforms.map((t) => ({
                    kind: t.kind,
                    available: t.available,
                    enabled: cfg.transforms[t.kind] !== false,
                  })),
                  config: {
                    confidenceThreshold: cfg.confidenceThreshold,
                    maxFileSize: cfg.maxFileSize,
                  },
                },
                null,
                2,
              ),
            },
          ],
        };
      },
    });

    // CLI
    api.registerCli(
      (ctx) => {
        const cmd = ctx.program
          .command("hayameru")
          .description("Hayameru code transform accelerator");

        cmd
          .command("status")
          .description("Show metrics and config")
          .action(() => {
            const m = metrics.getMetrics();
            console.log("Hayameru Status:");
            console.log(`  Total attempts:      ${m.totalAttempts}`);
            console.log(`  Boost successes:     ${m.boostSuccesses}`);
            console.log(`  Boost failures:      ${m.boostFailures}`);
            console.log(`  Est. tokens saved:   ${m.estimatedTokensSaved}`);
            console.log(`  Avg transform time:  ${m.avgTransformMs.toFixed(1)}ms`);
          });

        cmd
          .command("transforms")
          .description("List available transforms")
          .action(() => {
            const transforms = listTransforms();
            console.log("Available transforms:");
            for (const t of transforms) {
              const status = cfg.transforms[t.kind] !== false ? "enabled" : "disabled";
              console.log(`  ${t.kind}: ${status}`);
            }
          });
      },
      { commands: ["hayameru"] },
    );

    api.logger.info(`hayameru: initialized with ${Object.keys(cfg.transforms).length} transforms`);
  },
};

export default hayameruPlugin;

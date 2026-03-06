import fg from "fast-glob";
import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath, isPathInside } from "../path-utils.js";

export function registerCodeGlob(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_glob",
      label: "Glob Files",
      description:
        "Find files matching a glob pattern. Respects .gitignore. Returns paths sorted by modification time (newest first).",
      parameters: Type.Object({
        pattern: Type.String({ description: 'Glob pattern (e.g. "**/*.ts", "src/**/*.tsx")' }),
        path: Type.Optional(
          Type.String({ description: "Base directory for search (defaults to workspace root)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { pattern?: string; path?: string };
        if (typeof p.pattern !== "string" || !p.pattern.trim()) {
          throw new ToolInputError("pattern required");
        }

        const basePath = p.path?.trim()
          ? resolveSafePath(p.path.trim(), cfg.workspaceRoot)
          : cfg.workspaceRoot;

        // Ensure basePath is inside workspace
        if (!isPathInside(basePath, cfg.workspaceRoot) && basePath !== cfg.workspaceRoot) {
          throw new ToolInputError("path is outside workspace root");
        }

        const files = await fg(p.pattern.trim(), {
          cwd: basePath,
          dot: false,
          ignore: ["**/node_modules/**", "**/.git/**"],
          onlyFiles: true,
          followSymbolicLinks: false,
          suppressErrors: true,
        });

        // Sort by modification time (newest first)
        const withStats = await Promise.all(
          files.slice(0, cfg.maxGlobResults * 2).map(async (file) => {
            try {
              const stat = await fs.stat(`${basePath}/${file}`);
              return { file, mtime: stat.mtimeMs };
            } catch {
              return { file, mtime: 0 };
            }
          }),
        );

        withStats.sort((a, b) => b.mtime - a.mtime);
        const limited = withStats.slice(0, cfg.maxGlobResults);

        const text = limited.map((e) => e.file).join("\n") || "(no matches)";
        const truncated = files.length > cfg.maxGlobResults;

        return {
          content: [{ type: "text" as const, text }],
          details: {
            pattern: p.pattern.trim(),
            matches: limited.length,
            totalFound: files.length,
            truncated,
          },
        };
      },
    },
    { name: "code_glob" },
  );
}

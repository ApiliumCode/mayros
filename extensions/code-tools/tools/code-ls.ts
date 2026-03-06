/**
 * code_ls tool — List files and directories.
 *
 * Returns entries sorted: directories first, then files, alphabetical within groups.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath } from "../path-utils.js";

type LsEntry = {
  name: string;
  type: "file" | "directory" | "symlink";
  size?: number;
};

export function registerCodeLs(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_ls",
      label: "List Directory",
      description:
        "List files and directories. Returns entries sorted: directories first, then files, alphabetical.",
      parameters: Type.Object({
        path: Type.Optional(
          Type.String({ description: "Directory path (defaults to workspace root)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const rawPath = (params as Record<string, unknown>).path;
        const dirPath =
          typeof rawPath === "string" && rawPath.trim()
            ? resolveSafePath(rawPath.trim(), cfg.workspaceRoot)
            : cfg.workspaceRoot;

        let dirents;
        try {
          dirents = await fs.readdir(dirPath, { withFileTypes: true });
        } catch {
          throw new ToolInputError(`Cannot read directory: ${rawPath ?? "."}`);
        }

        const entries: LsEntry[] = [];
        for (const d of dirents) {
          const entryType = d.isSymbolicLink()
            ? ("symlink" as const)
            : d.isDirectory()
              ? ("directory" as const)
              : ("file" as const);

          const entry: LsEntry = { name: d.name, type: entryType };

          if (entryType === "file") {
            try {
              const stat = await fs.stat(path.join(dirPath, d.name));
              entry.size = stat.size;
            } catch {
              // size unavailable
            }
          }

          entries.push(entry);
        }

        // Sort: directories first, then files, alphabetical within each group
        entries.sort((a, b) => {
          if (a.type === "directory" && b.type !== "directory") return -1;
          if (a.type !== "directory" && b.type === "directory") return 1;
          return a.name.localeCompare(b.name);
        });

        const lines = entries.map((e) => {
          const suffix = e.type === "directory" ? "/" : e.type === "symlink" ? " @" : "";
          const sizeStr = e.size !== undefined ? ` (${e.size} bytes)` : "";
          return `${e.name}${suffix}${sizeStr}`;
        });

        return {
          content: [{ type: "text" as const, text: lines.join("\n") || "(empty directory)" }],
          details: {
            path: rawPath ?? ".",
            entries: entries.length,
          },
        };
      },
    },
    { name: "code_ls" },
  );
}

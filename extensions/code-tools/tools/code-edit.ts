import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath } from "../path-utils.js";
import { parseDiffStats } from "../../../src/tui/diff-renderer.js";

/**
 * Generate a minimal unified diff snippet showing the change context.
 */
function generateDiff(filePath: string, oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

  // Find first difference
  let start = 0;
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  ) {
    start++;
  }

  // Find last difference
  let oldEnd = oldLines.length - 1;
  let newEnd = newLines.length - 1;
  while (oldEnd > start && newEnd > start && oldLines[oldEnd] === newLines[newEnd]) {
    oldEnd--;
    newEnd--;
  }

  const ctxStart = Math.max(0, start - 3);
  const ctxOldEnd = Math.min(oldLines.length - 1, oldEnd + 3);
  const ctxNewEnd = Math.min(newLines.length - 1, newEnd + 3);

  lines.push(
    `@@ -${ctxStart + 1},${ctxOldEnd - ctxStart + 1} +${ctxStart + 1},${ctxNewEnd - ctxStart + 1} @@`,
  );

  // Context before
  for (let i = ctxStart; i < start; i++) {
    lines.push(` ${oldLines[i]}`);
  }

  // Removed lines
  for (let i = start; i <= oldEnd; i++) {
    lines.push(`-${oldLines[i]}`);
  }

  // Added lines
  for (let i = start; i <= newEnd; i++) {
    lines.push(`+${newLines[i]}`);
  }

  // Context after
  for (let i = oldEnd + 1; i <= ctxOldEnd; i++) {
    lines.push(` ${oldLines[i]}`);
  }

  return lines.join("\n");
}

export function registerCodeEdit(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_edit",
      label: "Edit File",
      description:
        "Perform exact string replacement in a file. The old_string must exist in the file. By default it must be unique; use replace_all to replace every occurrence.",
      parameters: Type.Object({
        path: Type.String({ description: "File path (absolute or relative to workspace)" }),
        old_string: Type.String({ description: "The exact text to find and replace" }),
        new_string: Type.String({ description: "The replacement text" }),
        replace_all: Type.Optional(
          Type.Boolean({ description: "Replace all occurrences (default: false)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          path?: string;
          old_string?: string;
          new_string?: string;
          replace_all?: boolean;
        };
        if (typeof p.path !== "string" || !p.path.trim()) {
          throw new ToolInputError("path required");
        }
        if (typeof p.old_string !== "string") {
          throw new ToolInputError("old_string required");
        }
        if (typeof p.new_string !== "string") {
          throw new ToolInputError("new_string required");
        }
        if (p.old_string === p.new_string) {
          throw new ToolInputError("old_string and new_string must be different");
        }

        const filePath = resolveSafePath(p.path.trim(), cfg.workspaceRoot);
        const replaceAll = p.replace_all === true;

        let content: string;
        try {
          content = await fs.readFile(filePath, "utf-8");
        } catch {
          throw new ToolInputError(`File not found: ${p.path}`);
        }

        // Check old_string exists
        const firstIdx = content.indexOf(p.old_string);
        if (firstIdx === -1) {
          throw new ToolInputError(
            `old_string not found in ${p.path}. Make sure the string matches exactly (including whitespace).`,
          );
        }

        // If not replace_all, check uniqueness
        if (!replaceAll) {
          const secondIdx = content.indexOf(p.old_string, firstIdx + 1);
          if (secondIdx !== -1) {
            throw new ToolInputError(
              `old_string is not unique in ${p.path} (found at multiple positions). Provide more context to make it unique, or use replace_all.`,
            );
          }
        }

        // Perform replacement
        let newContent: string;
        let replacements: number;
        if (replaceAll) {
          const parts = content.split(p.old_string);
          replacements = parts.length - 1;
          newContent = parts.join(p.new_string);
        } else {
          newContent = content.replace(p.old_string, p.new_string);
          replacements = 1;
        }

        await fs.writeFile(filePath, newContent, "utf-8");

        const diff = generateDiff(p.path.trim(), content, newContent);
        const stats = parseDiffStats(diff);

        return {
          content: [{ type: "text" as const, text: diff }],
          details: {
            path: p.path.trim(),
            replacements,
            diffStats: stats,
          },
        };
      },
    },
    { name: "code_edit" },
  );
}

export { generateDiff };

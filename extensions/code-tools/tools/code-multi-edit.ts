/**
 * code_multi_edit tool — Atomic batch file editing.
 *
 * Validates all edits before applying any. If any validation fails,
 * no changes are made (atomic semantics).
 */

import { readFileSync, writeFileSync } from "node:fs";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath } from "../path-utils.js";
import { parseDiffStats } from "../../../src/tui/diff-renderer.js";

type EditOp = {
  path: string;
  old_string: string;
  new_string: string;
  replace_all?: boolean;
};

type EditResult = {
  path: string;
  replacements: number;
  diff: string;
};

function buildDiffSnippet(oldStr: string, newStr: string, contextLines: number = 2): string {
  const oldLines = oldStr.split("\n");
  const newLines = newStr.split("\n");
  const parts: string[] = [];
  // Show a compact diff with context
  const maxShow = Math.min(oldLines.length, contextLines + 1);
  for (let i = 0; i < maxShow; i++) {
    parts.push(`- ${oldLines[i]}`);
  }
  if (oldLines.length > maxShow) {
    parts.push(`  ... (${oldLines.length - maxShow} more lines)`);
  }
  const maxShowNew = Math.min(newLines.length, contextLines + 1);
  for (let i = 0; i < maxShowNew; i++) {
    parts.push(`+ ${newLines[i]}`);
  }
  if (newLines.length > maxShowNew) {
    parts.push(`  ... (${newLines.length - maxShowNew} more lines)`);
  }
  return parts.join("\n");
}

export function registerCodeMultiEdit(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_multi_edit",
      label: "Multi Edit",
      description:
        "Apply multiple file edits atomically. All edits are validated first — if any fails, no changes are applied. Each edit replaces old_string with new_string in the specified file.",
      parameters: Type.Object({
        edits: Type.Array(
          Type.Object({
            path: Type.String({ description: "File path (relative to workspace)" }),
            old_string: Type.String({ description: "Text to find and replace" }),
            new_string: Type.String({ description: "Replacement text" }),
            replace_all: Type.Optional(
              Type.Boolean({ description: "Replace all occurrences (default: false)" }),
            ),
          }),
          { description: "Array of edit operations" },
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { edits?: EditOp[] };
        if (!Array.isArray(p.edits) || p.edits.length === 0) {
          throw new ToolInputError("edits array required and must not be empty");
        }

        if (p.edits.length > 50) {
          throw new ToolInputError("Maximum 50 edits per call");
        }

        // Phase 1: Validate all edits
        const fileContents = new Map<string, string>();
        const resolvedEdits: Array<{
          resolvedPath: string;
          old_string: string;
          new_string: string;
          replace_all: boolean;
        }> = [];
        const errors: string[] = [];

        for (let i = 0; i < p.edits.length; i++) {
          const edit = p.edits[i];
          if (typeof edit.path !== "string" || !edit.path.trim()) {
            errors.push(`edit[${i}]: path required`);
            continue;
          }
          if (typeof edit.old_string !== "string") {
            errors.push(`edit[${i}]: old_string required`);
            continue;
          }
          if (typeof edit.new_string !== "string") {
            errors.push(`edit[${i}]: new_string required`);
            continue;
          }
          if (edit.old_string === edit.new_string) {
            errors.push(`edit[${i}]: old_string and new_string are identical`);
            continue;
          }

          let resolvedPath: string;
          try {
            resolvedPath = resolveSafePath(edit.path, cfg.workspaceRoot);
          } catch {
            errors.push(`edit[${i}]: path outside workspace`);
            continue;
          }

          // Read file if not already read
          if (!fileContents.has(resolvedPath)) {
            try {
              fileContents.set(resolvedPath, readFileSync(resolvedPath, "utf-8"));
            } catch (err) {
              errors.push(`edit[${i}]: cannot read file — ${(err as Error).message}`);
              continue;
            }
          }

          const content = fileContents.get(resolvedPath)!;
          const replaceAll = edit.replace_all === true;

          if (!replaceAll) {
            // Check uniqueness: old_string should appear exactly once
            const firstIdx = content.indexOf(edit.old_string);
            if (firstIdx === -1) {
              errors.push(`edit[${i}]: old_string not found in ${edit.path}`);
              continue;
            }
            const secondIdx = content.indexOf(edit.old_string, firstIdx + 1);
            if (secondIdx !== -1) {
              errors.push(
                `edit[${i}]: old_string is not unique in ${edit.path} (found multiple occurrences). Use replace_all: true or provide more context.`,
              );
              continue;
            }
          } else {
            if (!content.includes(edit.old_string)) {
              errors.push(`edit[${i}]: old_string not found in ${edit.path}`);
              continue;
            }
          }

          resolvedEdits.push({
            resolvedPath,
            old_string: edit.old_string,
            new_string: edit.new_string,
            replace_all: replaceAll,
          });
        }

        if (errors.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Validation failed — no changes applied:\n${errors.map((e) => `  • ${e}`).join("\n")}`,
              },
            ],
            details: { errors },
          };
        }

        // Phase 2: Apply all edits (grouped by file)
        const results: EditResult[] = [];
        const editsByFile = new Map<string, typeof resolvedEdits>();
        for (const edit of resolvedEdits) {
          const existing = editsByFile.get(edit.resolvedPath) ?? [];
          existing.push(edit);
          editsByFile.set(edit.resolvedPath, existing);
        }

        for (const [filePath, edits] of editsByFile) {
          let content = fileContents.get(filePath)!;
          let totalReplacements = 0;
          const diffs: string[] = [];

          for (const edit of edits) {
            if (edit.replace_all) {
              const count = content.split(edit.old_string).length - 1;
              content = content.split(edit.old_string).join(edit.new_string);
              totalReplacements += count;
              diffs.push(buildDiffSnippet(edit.old_string, edit.new_string));
            } else {
              content = content.replace(edit.old_string, edit.new_string);
              totalReplacements += 1;
              diffs.push(buildDiffSnippet(edit.old_string, edit.new_string));
            }
          }

          writeFileSync(filePath, content, "utf-8");
          // Use the original relative path from the first edit for this file
          const relPath =
            p.edits.find((e) => {
              try {
                return resolveSafePath(e.path, cfg.workspaceRoot) === filePath;
              } catch {
                return false;
              }
            })?.path ?? filePath;

          results.push({
            path: relPath,
            replacements: totalReplacements,
            diff: diffs.join("\n---\n"),
          });
        }

        const totalFiles = results.length;
        const totalReplacements = results.reduce((sum, r) => sum + r.replacements, 0);

        const text = results
          .map((r) => `${r.path}: ${r.replacements} replacement(s)\n${r.diff}`)
          .join("\n\n");

        const allDiffs = results.map((r) => r.diff).join("\n");
        const aggregateStats = parseDiffStats(allDiffs);

        return {
          content: [
            {
              type: "text" as const,
              text: `Applied ${totalReplacements} edit(s) across ${totalFiles} file(s).\n\n${text}`,
            },
          ],
          details: { totalFiles, totalReplacements, results, diffStats: aggregateStats },
        };
      },
    },
    { name: "code_multi_edit" },
  );
}

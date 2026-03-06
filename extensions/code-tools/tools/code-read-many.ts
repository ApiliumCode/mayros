import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath, isImageFile, isBinaryBuffer } from "../path-utils.js";

const MAX_FILES = 20;

export function registerCodeReadMany(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_read_many",
      label: "Read Multiple Files",
      description:
        "Read multiple files in a single call. Returns text content with line numbers for each file. Max 20 files per call.",
      parameters: Type.Object({
        paths: Type.Array(
          Type.String({ description: "File path (absolute or relative to workspace)" }),
          {
            description: "Array of file paths to read",
            minItems: 1,
            maxItems: MAX_FILES,
          },
        ),
      }),
      async execute(_toolCallId, params) {
        const rawPaths = (params as Record<string, unknown>).paths;
        if (!Array.isArray(rawPaths) || rawPaths.length === 0) {
          throw new ToolInputError("paths array required (1-20 items)");
        }
        if (rawPaths.length > MAX_FILES) {
          throw new ToolInputError(`Too many files: ${rawPaths.length} (max ${MAX_FILES})`);
        }

        const results: Array<{ path: string; content: string; error?: string }> = [];

        for (const rawPath of rawPaths) {
          if (typeof rawPath !== "string" || !rawPath.trim()) {
            results.push({ path: String(rawPath), content: "", error: "invalid path" });
            continue;
          }

          try {
            const filePath = resolveSafePath(rawPath.trim(), cfg.workspaceRoot);
            const stat = await fs.stat(filePath);

            if (stat.isDirectory()) {
              results.push({ path: rawPath, content: "", error: "path is a directory" });
              continue;
            }

            if (stat.size > cfg.maxFileSizeBytes) {
              results.push({
                path: rawPath,
                content: "",
                error: `file too large: ${stat.size} bytes`,
              });
              continue;
            }

            if (isImageFile(filePath)) {
              results.push({ path: rawPath, content: `[image file: ${stat.size} bytes]` });
              continue;
            }

            const buffer = await fs.readFile(filePath);

            if (isBinaryBuffer(buffer)) {
              results.push({ path: rawPath, content: `[binary file: ${stat.size} bytes]` });
              continue;
            }

            const text = buffer.toString("utf-8");
            const lines = text.split("\n");
            const padWidth = String(lines.length).length;
            const numbered = lines.map((line, i) => {
              const lineNo = String(i + 1).padStart(padWidth, " ");
              return `${lineNo}\t${line}`;
            });
            results.push({ path: rawPath, content: numbered.join("\n") });
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results.push({ path: rawPath, content: "", error: msg });
          }
        }

        const textParts: string[] = [];
        for (const r of results) {
          textParts.push(`--- ${r.path} ---`);
          if (r.error) {
            textParts.push(`[Error: ${r.error}]`);
          } else {
            textParts.push(r.content);
          }
          textParts.push("");
        }

        return {
          content: [{ type: "text" as const, text: textParts.join("\n") }],
          details: {
            filesRequested: rawPaths.length,
            filesRead: results.filter((r) => !r.error).length,
            errors: results.filter((r) => r.error).length,
          },
        };
      },
    },
    { name: "code_read_many" },
  );
}

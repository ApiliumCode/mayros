/**
 * code_write tool — Write content to a file.
 *
 * Creates parent directories as needed. Overwrites existing files.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError, jsonResult } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath } from "../path-utils.js";
import { generateDiff } from "./code-edit.js";

export function registerCodeWrite(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_write",
      label: "Write File",
      description: "Write content to a file, creating parent directories if needed.",
      parameters: Type.Object({
        path: Type.String({ description: "File path (absolute or relative to workspace)" }),
        content: Type.String({ description: "Content to write" }),
      }),
      async execute(_toolCallId, params) {
        const p = params as { path?: string; content?: string };
        if (typeof p.path !== "string" || !p.path.trim()) {
          throw new ToolInputError("path required");
        }
        if (typeof p.content !== "string") {
          throw new ToolInputError("content required");
        }

        const filePath = resolveSafePath(p.path.trim(), cfg.workspaceRoot);
        const dir = path.dirname(filePath);

        // Read existing content for diff (if file exists)
        let oldContent: string | null = null;
        try {
          oldContent = await fs.readFile(filePath, "utf-8");
        } catch {
          // File doesn't exist yet — no diff
        }

        await fs.mkdir(dir, { recursive: true });
        await fs.writeFile(filePath, p.content, "utf-8");

        const bytesWritten = Buffer.byteLength(p.content, "utf-8");

        // Generate diff if file existed before
        let diff: string | undefined;
        if (oldContent !== null && oldContent !== p.content) {
          diff = generateDiff(p.path.trim(), oldContent, p.content);
        }

        if (diff) {
          return {
            content: [{ type: "text" as const, text: diff }],
            details: { path: p.path.trim(), bytesWritten, isNew: false },
          };
        }

        return jsonResult({
          path: p.path.trim(),
          bytesWritten,
          isNew: oldContent === null,
        });
      },
    },
    { name: "code_write" },
  );
}

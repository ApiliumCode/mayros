/**
 * code_shell tool — Execute a shell command in the workspace.
 *
 * Captures stdout, stderr, exit code. Commands are subject to
 * bash-sandbox validation if that plugin is active.
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath, isPathInside } from "../path-utils.js";

const execFileAsync = promisify(execFile);

export function registerCodeShell(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_shell",
      label: "Shell",
      description:
        "Execute a shell command in the workspace. Captures stdout, stderr, exit code. Commands are subject to bash-sandbox validation if that plugin is active.",
      parameters: Type.Object({
        command: Type.String({ description: "Shell command to execute" }),
        timeout: Type.Optional(
          Type.Number({ description: "Timeout in milliseconds (default: 120000)" }),
        ),
        cwd: Type.Optional(
          Type.String({ description: "Working directory (defaults to workspace root)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        if (!cfg.shellEnabled) {
          throw new ToolInputError("Shell tool is disabled in configuration");
        }

        const p = params as { command?: string; timeout?: number; cwd?: string };
        if (typeof p.command !== "string" || !p.command.trim()) {
          throw new ToolInputError("command required");
        }

        const command = p.command.trim();
        const timeout =
          typeof p.timeout === "number"
            ? Math.max(1000, Math.min(Math.trunc(p.timeout), cfg.shellTimeout))
            : cfg.shellTimeout;

        const cwd = p.cwd?.trim()
          ? resolveSafePath(p.cwd.trim(), cfg.workspaceRoot)
          : cfg.workspaceRoot;

        if (!isPathInside(cwd, cfg.workspaceRoot) && cwd !== cfg.workspaceRoot) {
          throw new ToolInputError("cwd is outside workspace root");
        }

        const startTime = Date.now();
        let stdout = "";
        let stderr = "";
        let exitCode = 0;

        try {
          const result = await execFileAsync("bash", ["-c", command], {
            cwd,
            timeout,
            maxBuffer: 10 * 1024 * 1024, // 10MB
            env: { ...process.env, TERM: "dumb" },
          });
          stdout = result.stdout;
          stderr = result.stderr;
        } catch (err) {
          const error = err as {
            stdout?: string;
            stderr?: string;
            code?: number | string;
            killed?: boolean;
          };
          stdout = error.stdout ?? "";
          stderr = error.stderr ?? "";
          if (error.killed) {
            exitCode = 137;
            stderr += `\n[Process killed after ${timeout}ms timeout]`;
          } else if (typeof error.code === "number") {
            exitCode = error.code;
          } else {
            exitCode = 1;
          }
        }

        const duration = Date.now() - startTime;

        // Build output text
        const parts: string[] = [];
        if (stdout.trim()) {
          parts.push(stdout.trimEnd());
        }
        if (stderr.trim()) {
          parts.push(`[stderr]\n${stderr.trimEnd()}`);
        }
        if (exitCode !== 0) {
          parts.push(`[exit code: ${exitCode}]`);
        }

        const text = parts.join("\n\n") || "(no output)";

        return {
          content: [{ type: "text" as const, text }],
          details: {
            command,
            exitCode,
            duration,
          },
        };
      },
    },
    { name: "code_shell" },
  );
}

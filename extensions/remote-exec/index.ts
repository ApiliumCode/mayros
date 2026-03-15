/**
 * Mayros Remote Exec Plugin
 *
 * Remote terminal execution with sandbox validation, path containment,
 * audit logging, and rate limiting. Three tools: remote_exec, remote_read_file, remote_ls.
 *
 * Tools: remote_exec, remote_read_file, remote_ls
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../src/agents/tools/common.js";
import { remoteExecConfigSchema } from "./config.js";
import { RemoteExecService } from "./exec-service.js";
import type { DirEntry } from "./exec-service.js";

// ============================================================================
// Tool Registration
// ============================================================================

function registerRemoteExec(api: MayrosPluginApi, service: RemoteExecService): void {
  api.registerTool(
    {
      name: "remote_exec",
      label: "Remote Shell",
      description:
        "Execute a shell command remotely within allowed directories. Commands are validated by the bash sandbox. Rate limited.",
      parameters: Type.Object({
        command: Type.String({ description: "Shell command to execute" }),
        workdir: Type.Optional(
          Type.String({ description: "Working directory (must be within allowedPaths)" }),
        ),
        timeout: Type.Optional(
          Type.Number({ description: "Timeout in milliseconds (clamped to config max)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { command?: string; workdir?: string; timeout?: number };
        if (typeof p.command !== "string" || !p.command.trim()) {
          throw new ToolInputError("command required");
        }

        const timeout =
          typeof p.timeout === "number"
            ? Math.max(1000, Math.min(Math.trunc(p.timeout), 120_000))
            : undefined;

        const result = await service.executeCommand({
          command: p.command.trim(),
          workdir: p.workdir?.trim() || undefined,
          timeout,
        });

        const parts: string[] = [];
        if (result.stdout.trim()) {
          parts.push(result.stdout.trimEnd());
        }
        if (result.stderr.trim()) {
          parts.push(`[stderr]\n${result.stderr.trimEnd()}`);
        }
        if (result.exitCode !== 0) {
          parts.push(`[exit code: ${result.exitCode}]`);
        }
        if (result.truncated) {
          parts.push("[output was truncated]");
        }

        const text = parts.join("\n\n") || "(no output)";

        return {
          content: [{ type: "text" as const, text }],
          details: {
            command: p.command.trim(),
            exitCode: result.exitCode,
            duration: result.durationMs,
            truncated: result.truncated,
          },
        };
      },
    },
    { name: "remote_exec" },
  );
}

function registerRemoteReadFile(api: MayrosPluginApi, service: RemoteExecService): void {
  api.registerTool(
    {
      name: "remote_read_file",
      label: "Remote Read File",
      description:
        "Read a file within allowed directories. Detects binary files. Supports line limiting.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the file to read" }),
        lines: Type.Optional(Type.Number({ description: "Maximum number of lines to return" })),
      }),
      async execute(_toolCallId, params) {
        const p = params as { path?: string; lines?: number };
        if (typeof p.path !== "string" || !p.path.trim()) {
          throw new ToolInputError("path required");
        }

        const lines =
          typeof p.lines === "number"
            ? Math.max(1, Math.min(Math.trunc(p.lines), 100_000))
            : undefined;

        const result = await service.readFile({
          path: p.path.trim(),
          lines,
        });

        let text: string;
        if (result.binary) {
          text = `[binary file, ${result.size} bytes]`;
        } else {
          const header = `File: ${p.path.trim()} (${result.size} bytes, ${result.totalLines} lines)`;
          const shown =
            result.linesShown < result.totalLines
              ? `\nShowing first ${result.linesShown} of ${result.totalLines} lines`
              : "";
          text = `${header}${shown}\n\n${result.content}`;
        }

        return {
          content: [{ type: "text" as const, text }],
          details: {
            path: p.path.trim(),
            binary: result.binary,
            size: result.size,
            totalLines: result.totalLines,
            linesShown: result.linesShown,
          },
        };
      },
    },
    { name: "remote_read_file" },
  );
}

function registerRemoteLs(api: MayrosPluginApi, service: RemoteExecService): void {
  api.registerTool(
    {
      name: "remote_ls",
      label: "Remote List Directory",
      description:
        "List directory contents within allowed directories. Shows type, name, and size.",
      parameters: Type.Object({
        path: Type.String({ description: "Absolute path to the directory" }),
      }),
      async execute(_toolCallId, params) {
        const p = params as { path?: string };
        if (typeof p.path !== "string" || !p.path.trim()) {
          throw new ToolInputError("path required");
        }

        const result = await service.listDirectory({ path: p.path.trim() });

        const formatEntry = (entry: DirEntry): string => {
          const marker =
            entry.type === "directory"
              ? "d"
              : entry.type === "symlink"
                ? "l"
                : entry.type === "file"
                  ? "f"
                  : "?";
          const sizeStr = entry.type === "directory" ? "-" : String(entry.size);
          return `${marker} ${sizeStr.padStart(10)} ${entry.name}`;
        };

        const lines = result.entries.map(formatEntry);
        const header = `Directory: ${result.path} (${result.entries.length} entries)`;
        const text = lines.length > 0 ? `${header}\n\n${lines.join("\n")}` : `${header}\n\n(empty)`;

        return {
          content: [{ type: "text" as const, text }],
          details: {
            path: result.path,
            count: result.entries.length,
          },
        };
      },
    },
    { name: "remote_ls" },
  );
}

// ============================================================================
// Plugin Definition
// ============================================================================

const remoteExecPlugin = {
  id: "remote-exec",
  name: "Remote Terminal",
  description:
    "Remote command execution with sandbox validation, path containment, and audit logging",
  kind: "security" as const,
  configSchema: remoteExecConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = remoteExecConfigSchema.parse(api.pluginConfig);

    if (!cfg.enabled) {
      api.logger.info("remote-exec: disabled (set enabled: true to activate)");
      return;
    }

    const service = new RemoteExecService(cfg, api.logger);

    registerRemoteExec(api, service);
    registerRemoteReadFile(api, service);
    registerRemoteLs(api, service);

    api.logger.info(
      `remote-exec: registered 3 tools (allowedPaths: ${cfg.allowedPaths.join(", ")})`,
    );
  },
};

export default remoteExecPlugin;

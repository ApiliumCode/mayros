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
import { AuditTrail } from "../osameru-governance/audit-trail.js";
import { remoteExecConfigSchema, type RemoteExecConfig } from "./config.js";
import path from "node:path";
import {
  ConfirmationManager,
  formatExecOutput,
  formatApprovalPrompt,
  formatPendingList,
  formatRunHelp,
  formatPagedOutput,
  formatMorePage,
  formatCdSuccess,
  formatPwdOutput,
} from "./confirmation-ux.js";
import { RemoteExecService } from "./exec-service.js";
import type { DirEntry } from "./exec-service.js";
import { SessionManager } from "./session-manager.js";

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
// /run Command Handlers
// ============================================================================

async function handleCd(
  sessionMgr: SessionManager,
  service: RemoteExecService,
  targetPath: string,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): Promise<{ text: string }> {
  if (!ctx.senderId) {
    return { text: "Error: Session requires a sender identity." };
  }

  const session = sessionMgr.getOrCreate(ctx.channel, ctx.senderId, config.allowedPaths[0]!);

  if (!targetPath.trim()) {
    return { text: formatPwdOutput(session.workdir) };
  }

  const resolved = path.isAbsolute(targetPath)
    ? targetPath
    : path.resolve(session.workdir, targetPath);

  const validated = await service.validateWorkdir(resolved);
  sessionMgr.setWorkdir(ctx.channel, ctx.senderId, validated);
  return { text: formatCdSuccess(validated) };
}

function handlePwd(
  sessionMgr: SessionManager,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): { text: string } {
  if (!ctx.senderId) {
    return { text: formatPwdOutput(config.allowedPaths[0]!) };
  }
  const workdir = sessionMgr.getWorkdir(ctx.channel, ctx.senderId) ?? config.allowedPaths[0]!;
  return { text: formatPwdOutput(workdir) };
}

function handleMore(
  sessionMgr: SessionManager,
  ctx: { senderId?: string; channel: string },
): { text: string } {
  if (!ctx.senderId) {
    return { text: "No more output to show." };
  }
  const result = sessionMgr.getNextPage(ctx.channel, ctx.senderId);
  if (!result) {
    return { text: "No more output to show." };
  }
  return {
    text: formatMorePage(
      result.page.content,
      result.pageNum,
      result.totalPages,
      result.remainingLines,
    ),
  };
}

function applyPaging(
  sessionMgr: SessionManager,
  formatted: string,
  command: string,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): string {
  if (!ctx.senderId || formatted.length <= config.session.outputPageSize) {
    return formatted;
  }
  const cache = sessionMgr.cacheOutput(ctx.channel, ctx.senderId, formatted, command);
  if (cache.pages.length <= 1) {
    return formatted;
  }
  const firstPage = cache.pages[0]!;
  let remainingLines = 0;
  for (let i = 1; i < cache.pages.length; i++) {
    remainingLines += cache.pages[i]!.lineCount;
  }
  return formatPagedOutput(firstPage.content, cache.pages.length, remainingLines);
}

async function handleExec(
  manager: ConfirmationManager,
  service: RemoteExecService,
  sessionMgr: SessionManager,
  command: string,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): Promise<{ text: string }> {
  const workdir = ctx.senderId
    ? sessionMgr.getOrCreate(ctx.channel, ctx.senderId, config.allowedPaths[0]!).workdir
    : config.allowedPaths[0]!;

  const result = manager.evaluateCommand({
    command,
    workdir,
    senderId: ctx.senderId,
    channel: ctx.channel,
  });

  if (result.action === "auto_approved") {
    const execResult = await service.executeCommand({ command, workdir });
    const formatted = formatExecOutput(execResult, command);
    return {
      text: applyPaging(sessionMgr, formatted, command, ctx, config),
    };
  }

  if (result.action === "pending_approval") {
    return { text: formatApprovalPrompt(result.request, config.confirmation.showRiskLevel) };
  }

  // blocked
  return { text: `Blocked: ${result.reason}` };
}

async function handleApprove(
  manager: ConfirmationManager,
  service: RemoteExecService,
  sessionMgr: SessionManager,
  id: string,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): Promise<{ text: string }> {
  if (!id) return { text: "Usage: /run approve <id>" };

  const request = manager.approve(id.trim(), ctx.senderId);
  if (!request) return { text: "Request not found or expired." };

  const execResult = await service.executeCommand({
    command: request.command,
    workdir: request.workdir,
  });
  const formatted = formatExecOutput(execResult, request.command);
  return {
    text: applyPaging(sessionMgr, formatted, request.command, ctx, config),
  };
}

function handleDeny(
  manager: ConfirmationManager,
  id: string,
  ctx: { senderId?: string },
): { text: string } {
  if (!id) return { text: "Usage: /run deny <id>" };

  const request = manager.deny(id.trim(), ctx.senderId);
  if (!request) return { text: "Request not found or expired." };

  return { text: `Denied: ${request.command}` };
}

function handlePending(manager: ConfirmationManager, ctx: { senderId?: string }): { text: string } {
  const requests = manager.listPending(ctx.senderId);
  return { text: formatPendingList(requests) };
}

function registerRunCommand(
  api: MayrosPluginApi,
  service: RemoteExecService,
  manager: ConfirmationManager,
  sessionMgr: SessionManager,
  config: RemoteExecConfig,
): void {
  api.registerCommand({
    name: "run",
    description: "Execute commands remotely. Usage: /run <command>",
    acceptsArgs: true,
    requireAuth: true,
    handler: async (ctx) => {
      const args = ctx.args?.trim() ?? "";
      if (!args) return { text: formatRunHelp() };

      const firstSpace = args.indexOf(" ");
      const action = (firstSpace === -1 ? args : args.slice(0, firstSpace)).toLowerCase();
      const rest = firstSpace === -1 ? "" : args.slice(firstSpace + 1).trim();

      try {
        if (action === "help") return { text: formatRunHelp() };
        if (action === "cd") return await handleCd(sessionMgr, service, rest, ctx, config);
        if (action === "pwd") return handlePwd(sessionMgr, ctx, config);
        if (action === "more") return handleMore(sessionMgr, ctx);
        if (action === "pending") return handlePending(manager, ctx);
        if (action === "approve")
          return await handleApprove(manager, service, sessionMgr, rest, ctx, config);
        if (action === "deny") return handleDeny(manager, rest, ctx);

        // Default: entire args is a command to execute
        return await handleExec(manager, service, sessionMgr, args, ctx, config);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return { text: `Error: ${message}` };
      }
    },
  });
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

    const audit = new AuditTrail(cfg.auditLogPath);
    const manager = new ConfirmationManager(cfg.confirmation, audit, api.logger);
    const sessionMgr = new SessionManager(cfg.session, api.logger);
    registerRunCommand(api, service, manager, sessionMgr, cfg);

    api.logger.info(
      `remote-exec: registered 3 tools + /run command (allowedPaths: ${cfg.allowedPaths.join(", ")})`,
    );
  },
};

export default remoteExecPlugin;

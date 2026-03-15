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
  formatHistoryList,
  formatEnvList,
  formatEnvSet,
  formatEnvDeleted,
  formatAliasList,
  formatAliasShow,
  formatAliasSet,
  formatAliasDeleted,
  formatSessionStatus,
  ENV_BLOCKLIST,
  ENV_NAME_PATTERN,
  ALIAS_NAME_PATTERN,
  RESERVED_ALIAS_NAMES,
} from "./confirmation-ux.js";
import { maskSensitiveOutput } from "../../src/security/output-masking.js";
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

function recordHistory(
  sessionMgr: SessionManager,
  command: string,
  exitCode: number,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): void {
  if (!ctx.senderId) return;
  sessionMgr.addHistory(
    ctx.channel,
    ctx.senderId,
    {
      command,
      exitCode,
      timestamp: Date.now(),
    },
    config.session.maxHistorySize,
  );
}

function resolveSessionEnv(
  sessionMgr: SessionManager,
  ctx: { senderId?: string; channel: string },
): Record<string, string> {
  if (!ctx.senderId) return {};
  return sessionMgr.getEnv(ctx.channel, ctx.senderId);
}

function handleHistory(
  sessionMgr: SessionManager,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): { text: string } {
  if (!ctx.senderId) {
    return { text: "No command history." };
  }
  const entries = sessionMgr.getHistory(ctx.channel, ctx.senderId);
  return { text: formatHistoryList(entries, config.session.maxHistorySize) };
}

async function handleRecall(
  sessionMgr: SessionManager,
  manager: ConfirmationManager,
  service: RemoteExecService,
  index: number,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): Promise<{ text: string }> {
  if (!ctx.senderId) {
    return { text: "Error: Session requires a sender identity." };
  }
  const entry = sessionMgr.getHistoryEntry(ctx.channel, ctx.senderId, index);
  if (!entry) {
    return { text: `No command at history position ${index}.` };
  }
  return handleExec(manager, service, sessionMgr, entry.command, ctx, config);
}

function handleEnv(
  sessionMgr: SessionManager,
  rest: string,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): { text: string } {
  if (!ctx.senderId) {
    return { text: "Error: Session requires a sender identity." };
  }

  // Ensure session exists
  sessionMgr.getOrCreate(ctx.channel, ctx.senderId, config.allowedPaths[0]!);

  // /run env (no args) — list
  if (!rest) {
    const env = sessionMgr.getEnv(ctx.channel, ctx.senderId);
    return { text: formatEnvList(env) };
  }

  // /run env -d KEY — delete
  if (rest.startsWith("-d ")) {
    const key = rest.slice(3).trim();
    if (!key) {
      return { text: "Usage: /run env -d KEY" };
    }
    if (!ENV_NAME_PATTERN.test(key)) {
      return { text: `Error: Invalid variable name "${key}". Use UPPER_CASE format.` };
    }
    const deleted = sessionMgr.deleteEnv(ctx.channel, ctx.senderId, key);
    if (!deleted) {
      return { text: `${key} is not set.` };
    }
    return { text: formatEnvDeleted(key) };
  }

  // /run env -d (no key)
  if (rest === "-d") {
    return { text: "Usage: /run env -d KEY" };
  }

  // /run env KEY=VALUE — set
  const eqIdx = rest.indexOf("=");
  if (eqIdx !== -1) {
    const key = rest.slice(0, eqIdx);
    const value = rest.slice(eqIdx + 1);

    if (!ENV_NAME_PATTERN.test(key)) {
      return { text: `Error: Invalid variable name "${key}". Use UPPER_CASE format.` };
    }
    if (ENV_BLOCKLIST.has(key)) {
      return { text: `Error: ${key} is a protected variable.` };
    }
    const ok = sessionMgr.setEnv(ctx.channel, ctx.senderId, key, value, config.session.maxEnvVars);
    if (!ok) {
      return {
        text: `Error: Maximum environment variables reached (${config.session.maxEnvVars}).`,
      };
    }
    return { text: formatEnvSet(key, value) };
  }

  // /run env KEY (no =) — show single
  const key = rest.trim();
  if (!ENV_NAME_PATTERN.test(key)) {
    return { text: `Error: Invalid variable name "${key}". Use UPPER_CASE format.` };
  }
  const env = sessionMgr.getEnv(ctx.channel, ctx.senderId);
  if (key in env) {
    return { text: `${key}=${env[key]}` };
  }
  return { text: `${key} is not set.` };
}

function handleAlias(
  sessionMgr: SessionManager,
  rest: string,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): { text: string } {
  if (!ctx.senderId) {
    return { text: "Error: Session requires a sender identity." };
  }

  sessionMgr.getOrCreate(ctx.channel, ctx.senderId, config.allowedPaths[0]!);

  // /run alias -d NAME or /run alias -d
  if (rest === "-d") {
    return { text: "Usage: /run alias -d NAME" };
  }
  if (rest.startsWith("-d ")) {
    const name = rest.slice(3).trim();
    if (!name) {
      return { text: "Usage: /run alias -d NAME" };
    }
    if (!ALIAS_NAME_PATTERN.test(name)) {
      return {
        text: `Error: Invalid alias name "${name}". Use lowercase letters, digits, hyphens (a-z start, max 30 chars).`,
      };
    }
    const deleted = sessionMgr.deleteAlias(ctx.channel, ctx.senderId, name);
    if (!deleted) {
      return { text: "Alias not found." };
    }
    return { text: formatAliasDeleted(name) };
  }

  // /run alias (no args) — list
  if (!rest) {
    const aliases = sessionMgr.getAliases(ctx.channel, ctx.senderId);
    return { text: formatAliasList(aliases) };
  }

  // /run alias NAME [COMMAND...]
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) {
    // /run alias NAME — show single
    const name = rest;
    if (!ALIAS_NAME_PATTERN.test(name)) {
      return {
        text: `Error: Invalid alias name "${name}". Use lowercase letters, digits, hyphens (a-z start, max 30 chars).`,
      };
    }
    const command = sessionMgr.getAlias(ctx.channel, ctx.senderId, name);
    if (!command) {
      return { text: "Alias not found." };
    }
    return { text: formatAliasShow(name, command) };
  }

  // /run alias NAME COMMAND...
  const name = rest.slice(0, spaceIdx);
  const command = rest.slice(spaceIdx + 1).trim();

  if (!ALIAS_NAME_PATTERN.test(name)) {
    return {
      text: `Error: Invalid alias name "${name}". Use lowercase letters, digits, hyphens (a-z start, max 30 chars).`,
    };
  }
  if (RESERVED_ALIAS_NAMES.has(name)) {
    return { text: `Error: "${name}" is a reserved name.` };
  }

  const ok = sessionMgr.setAlias(
    ctx.channel,
    ctx.senderId,
    name,
    command,
    config.session.maxAliases,
  );
  if (!ok) {
    return { text: `Error: Maximum aliases reached (${config.session.maxAliases}).` };
  }
  return { text: formatAliasSet(name, command) };
}

function handleStatus(
  sessionMgr: SessionManager,
  ctx: { senderId?: string; channel: string },
  config: RemoteExecConfig,
): { text: string } {
  if (!ctx.senderId) {
    return { text: "Error: Session requires a sender identity." };
  }

  const session = sessionMgr.getOrCreate(ctx.channel, ctx.senderId, config.allowedPaths[0]!);

  const ttlRemainingMs = Math.max(
    0,
    config.session.sessionTtlMs - (Date.now() - session.lastActivity),
  );

  return {
    text: formatSessionStatus({
      workdir: session.workdir,
      ttlRemainingMs,
      historyCount: session.history.length,
      maxHistory: config.session.maxHistorySize,
      envCount: Object.keys(session.env).length,
      maxEnv: config.session.maxEnvVars,
      aliasCount: Object.keys(session.aliases).length,
      maxAliases: config.session.maxAliases,
      maskOutput: config.maskOutput,
    }),
  };
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
    const env = resolveSessionEnv(sessionMgr, ctx);
    const execResult = await service.executeCommand({ command, workdir, env });
    recordHistory(sessionMgr, command, execResult.exitCode, ctx, config);
    let formatted = formatExecOutput(execResult, command);
    let maskNote = "";
    if (config.maskOutput) {
      const maskResult = maskSensitiveOutput(formatted);
      if (maskResult.masked) {
        formatted = maskResult.text;
        maskNote = `\n[${maskResult.redactions} redaction${maskResult.redactions !== 1 ? "s" : ""} applied]`;
      }
    }
    return {
      text: applyPaging(sessionMgr, formatted, command, ctx, config) + maskNote,
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

  const env = resolveSessionEnv(sessionMgr, ctx);
  const execResult = await service.executeCommand({
    command: request.command,
    workdir: request.workdir,
    env,
  });
  recordHistory(sessionMgr, request.command, execResult.exitCode, ctx, config);
  let formatted = formatExecOutput(execResult, request.command);
  let maskNote = "";
  if (config.maskOutput) {
    const maskResult = maskSensitiveOutput(formatted);
    if (maskResult.masked) {
      formatted = maskResult.text;
      maskNote = `\n[${maskResult.redactions} redaction${maskResult.redactions !== 1 ? "s" : ""} applied]`;
    }
  }
  return {
    text: applyPaging(sessionMgr, formatted, request.command, ctx, config) + maskNote,
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
        if (action === "history") return handleHistory(sessionMgr, ctx, config);
        if (action === "env") return handleEnv(sessionMgr, rest, ctx, config);
        if (action === "alias") return handleAlias(sessionMgr, rest, ctx, config);
        if (action === "status") return handleStatus(sessionMgr, ctx, config);
        if (action === "cd") return await handleCd(sessionMgr, service, rest, ctx, config);
        if (action === "pwd") return handlePwd(sessionMgr, ctx, config);
        if (action === "more") return handleMore(sessionMgr, ctx);
        if (action === "pending") return handlePending(manager, ctx);
        if (action === "approve")
          return await handleApprove(manager, service, sessionMgr, rest, ctx, config);
        if (action === "deny") return handleDeny(manager, rest, ctx);

        // History recall: !! or !N
        if (args === "!!") return await handleRecall(sessionMgr, manager, service, 1, ctx, config);
        const bangMatch = args.match(/^!(\d+)$/);
        if (bangMatch)
          return await handleRecall(
            sessionMgr,
            manager,
            service,
            parseInt(bangMatch[1]!, 10),
            ctx,
            config,
          );

        // Alias resolution
        if (ctx.senderId) {
          const aliasCmd = sessionMgr.getAlias(ctx.channel, ctx.senderId, action);
          if (aliasCmd) {
            const expanded = rest ? `${aliasCmd} ${rest}` : aliasCmd;
            return await handleExec(manager, service, sessionMgr, expanded, ctx, config);
          }
        }

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

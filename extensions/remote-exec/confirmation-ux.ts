/**
 * Confirmation UX for Remote Exec
 *
 * Manages the /run command approval flow:
 * - Classifies command risk using the intent-classifier
 * - Auto-approves commands within the configured risk threshold
 * - Queues risky commands for explicit approval via /run approve <id>
 * - Formats output for messaging channels (code blocks, exit codes, truncation)
 * - Audits every request, approval, and denial
 */

import { randomBytes } from "node:crypto";
import {
  classifyCommand,
  riskLevelSatisfies,
  type IntentClassification,
} from "../interactive-permissions/intent-classifier.js";
import type { AuditTrail } from "../osameru-governance/audit-trail.js";
import type { ExecResult } from "./exec-service.js";
import type { ConfirmationConfig } from "./config.js";
import type { HistoryEntry } from "./session-manager.js";

// ============================================================================
// Types
// ============================================================================

export type PendingRequest = {
  id: string;
  command: string;
  workdir?: string;
  classification: IntentClassification;
  senderId?: string;
  channel: string;
  createdAt: number;
  expiresAt: number;
};

export type ConfirmationResult =
  | { action: "auto_approved" }
  | { action: "pending_approval"; request: PendingRequest }
  | { action: "blocked"; reason: string };

// ============================================================================
// ConfirmationManager
// ============================================================================

export class ConfirmationManager {
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly config: ConfirmationConfig,
    private readonly audit: AuditTrail,
    private readonly logger: { info: (msg: string) => void; warn: (msg: string) => void },
  ) {}

  private generateId(): string {
    return randomBytes(3).toString("hex");
  }

  private pruneExpired(): void {
    const now = Date.now();
    for (const [id, req] of this.pending) {
      if (now > req.expiresAt) {
        void this.audit.log("run_command", req.senderId, "expired", {
          command: req.command,
          risk: req.classification.riskLevel,
          requestId: id,
        });
        this.pending.delete(id);
      }
    }
  }

  evaluateCommand(params: {
    command: string;
    workdir?: string;
    senderId?: string;
    channel: string;
  }): ConfirmationResult {
    this.pruneExpired();

    const senderCount = params.senderId
      ? [...this.pending.values()].filter((r) => r.senderId === params.senderId).length
      : this.pending.size;
    if (senderCount >= this.config.maxPending) {
      return {
        action: "blocked",
        reason: `Too many pending requests (max: ${this.config.maxPending}). Approve or deny existing requests first.`,
      };
    }

    const classification = classifyCommand(params.command);

    if (riskLevelSatisfies(classification.riskLevel, this.config.autoApproveMaxRisk)) {
      void this.audit.log("run_command", params.senderId, "allow", {
        command: params.command,
        risk: classification.riskLevel,
        action: "auto_approved",
      });
      return { action: "auto_approved" };
    }

    const now = Date.now();
    const request: PendingRequest = {
      id: this.generateId(),
      command: params.command,
      workdir: params.workdir,
      classification,
      senderId: params.senderId,
      channel: params.channel,
      createdAt: now,
      expiresAt: now + this.config.approvalTtlMs,
    };

    this.pending.set(request.id, request);

    void this.audit.log("run_command", params.senderId, "flagged", {
      command: params.command,
      risk: classification.riskLevel,
      action: "pending_approval",
      requestId: request.id,
    });

    return { action: "pending_approval", request };
  }

  approve(id: string, senderId?: string): PendingRequest | null {
    this.pruneExpired();

    const request = this.pending.get(id);
    if (!request) return null;

    if (request.senderId && senderId && request.senderId !== senderId) {
      return null;
    }

    this.pending.delete(id);

    void this.audit.log("run_command", senderId, "allow", {
      command: request.command,
      risk: request.classification.riskLevel,
      action: "approved",
      requestId: id,
    });

    return request;
  }

  deny(id: string, senderId?: string): PendingRequest | null {
    this.pruneExpired();

    const request = this.pending.get(id);
    if (!request) return null;

    if (request.senderId && senderId && request.senderId !== senderId) {
      return null;
    }

    this.pending.delete(id);

    void this.audit.log("run_command", senderId, "deny", {
      command: request.command,
      risk: request.classification.riskLevel,
      action: "denied",
      requestId: id,
    });

    return request;
  }

  listPending(senderId?: string): PendingRequest[] {
    this.pruneExpired();
    const all = Array.from(this.pending.values());
    if (senderId) {
      return all.filter((r) => r.senderId === senderId);
    }
    return all;
  }

  getPending(id: string): PendingRequest | null {
    this.pruneExpired();
    return this.pending.get(id) ?? null;
  }
}

// ============================================================================
// Formatters
// ============================================================================

export function formatExecOutput(result: ExecResult, command: string): string {
  const parts: string[] = [];

  parts.push(`> ${command}`);

  if (result.stdout.trim()) {
    parts.push("```");
    parts.push(result.stdout.trimEnd());
    parts.push("```");
  }

  if (result.stderr.trim()) {
    parts.push(`*stderr:*\n\`\`\`\n${result.stderr.trimEnd()}\n\`\`\``);
  }

  const meta: string[] = [];
  if (result.exitCode !== 0) {
    meta.push(`exit: ${result.exitCode}`);
  }
  meta.push(`${result.durationMs}ms`);
  if (result.truncated) {
    meta.push("(truncated)");
  }

  parts.push(meta.join(" | "));

  return parts.join("\n");
}

export function formatApprovalPrompt(request: PendingRequest, showRisk: boolean): string {
  const parts: string[] = [];

  if (showRisk) {
    parts.push(
      `Command requires approval (risk: ${request.classification.riskLevel.toUpperCase()})`,
    );
  } else {
    parts.push("Command requires approval");
  }

  parts.push(`> ${request.command}`);
  parts.push("");
  parts.push(`Approve: /run approve ${request.id}`);
  parts.push(`Deny: /run deny ${request.id}`);

  const ttlSec = Math.round((request.expiresAt - request.createdAt) / 1000);
  parts.push(`Expires in ${ttlSec} seconds.`);

  return parts.join("\n");
}

export function formatPendingList(requests: PendingRequest[]): string {
  if (requests.length === 0) {
    return "No pending requests.";
  }

  const lines: string[] = [`Pending requests (${requests.length}):\n`];

  for (const req of requests) {
    const remainSec = Math.max(0, Math.round((req.expiresAt - Date.now()) / 1000));
    lines.push(
      `[${req.id}] ${req.command} (risk: ${req.classification.riskLevel}, expires: ${remainSec}s)`,
    );
  }

  return lines.join("\n");
}

export function formatPagedOutput(
  firstPageContent: string,
  totalPages: number,
  remainingLines: number,
): string {
  const parts: string[] = [];

  parts.push(firstPageContent.trimEnd());
  parts.push(`Page 1/${totalPages} (${remainingLines} lines remaining). /run more for next.`);

  return parts.join("\n");
}

export function formatMorePage(
  pageContent: string,
  pageNum: number,
  totalPages: number,
  remainingLines: number,
): string {
  const parts: string[] = [];

  parts.push(pageContent.trimEnd());

  if (pageNum < totalPages) {
    parts.push(
      `Page ${pageNum}/${totalPages} (${remainingLines} lines remaining). /run more for next.`,
    );
  } else {
    parts.push(`Page ${pageNum}/${totalPages} (end of output).`);
  }

  return parts.join("\n");
}

export function formatCdSuccess(newWorkdir: string): string {
  return `Working directory: ${newWorkdir}`;
}

export function formatPwdOutput(workdir: string): string {
  return `Working directory: ${workdir}`;
}

export function formatRunHelp(): string {
  return [
    "Usage: /run <command>",
    "",
    "Execute commands remotely with risk-based approval.",
    "",
    "Subcommands:",
    "  /run <command>        Execute a command",
    "  /run !!               Re-run last command",
    "  /run !<N>             Re-run command #N from history",
    "  /run history          Show command history",
    "  /run env              Show session environment variables",
    "  /run env KEY=VALUE    Set a session env var",
    "  /run env -d KEY       Delete a session env var",
    "  /run alias            List command aliases",
    "  /run alias NAME CMD   Define an alias",
    "  /run alias -d NAME    Delete an alias",
    "  /run status           Show session status",
    "  /run clear            Reset session state",
    "  /run config           Show active configuration",
    "  /run cd <path>        Change working directory",
    "  /run pwd              Show current working directory",
    "  /run more             Show next page of output",
    "  /run approve <id>     Approve a pending command",
    "  /run deny <id>        Deny a pending command",
    "  /run pending          List pending requests",
    "  /run unlock <pin>     Unlock session with PIN",
    "  /run help             Show this help",
  ].join("\n");
}

// ============================================================================
// Environment Variable Constants
// ============================================================================

export const ENV_BLOCKLIST = new Set([
  "HOME",
  "USER",
  "SHELL",
  "TERM",
  "LOGNAME",
  "HOSTNAME",
  "UID",
  "EUID",
  "LD_PRELOAD",
  "DYLD_INSERT_LIBRARIES",
  "BASH_ENV",
  "ENV",
  "PATH",
  "NODE_OPTIONS",
  "NODE_PATH",
  "PYTHONPATH",
  "PYTHONSTARTUP",
  "RUBYLIB",
  "PERL5LIB",
  "CLASSPATH",
  "CDPATH",
  "IFS",
  "GLOBIGNORE",
  "PROMPT_COMMAND",
  "PS1",
]);

export const ENV_NAME_PATTERN = /^[A-Z_][A-Z0-9_]*$/;

// ============================================================================
// History & Env Formatters
// ============================================================================

function formatRelativeTime(timestamp: number): string {
  const diff = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function formatHistoryList(entries: HistoryEntry[], maxShown: number): string {
  if (entries.length === 0) {
    return "No command history.";
  }

  const shown = entries.slice(0, maxShown);
  const lines: string[] = [`Command history (${shown.length}/${entries.length}):`];

  for (let i = 0; i < shown.length; i++) {
    const entry = shown[i]!;
    const status = entry.exitCode === 0 ? "[ok]" : `[exit:${entry.exitCode}]`;
    lines.push(`  ${i + 1}. ${status} ${entry.command}  (${formatRelativeTime(entry.timestamp)})`);
  }

  lines.push("");
  lines.push("Re-run: /run !! (last) or /run !<N>");

  return lines.join("\n");
}

export function formatEnvList(env: Record<string, string>): string {
  const keys = Object.keys(env);
  if (keys.length === 0) {
    return "No session environment variables set.";
  }

  const lines: string[] = [`Session env (${keys.length}):`];
  for (const key of keys) {
    lines.push(`  ${key}=${env[key]}`);
  }

  lines.push("");
  lines.push("Set: /run env KEY=VALUE");
  lines.push("Delete: /run env -d KEY");

  return lines.join("\n");
}

export function formatEnvSet(key: string, value: string): string {
  return `Set: ${key}=${value}`;
}

export function formatEnvDeleted(key: string): string {
  return `Deleted: ${key}`;
}

// ============================================================================
// Alias Constants & Formatters
// ============================================================================

export const ALIAS_NAME_PATTERN = /^[a-z][a-z0-9-]{0,29}$/;

export const RESERVED_ALIAS_NAMES = new Set([
  "help",
  "history",
  "env",
  "cd",
  "pwd",
  "more",
  "pending",
  "approve",
  "deny",
  "alias",
  "status",
  "clear",
  "config",
  "unlock",
]);

export function formatAliasList(aliases: Record<string, string>): string {
  const keys = Object.keys(aliases);
  if (keys.length === 0) {
    return "No aliases defined.\n\nDefine: /run alias NAME COMMAND...\nDelete: /run alias -d NAME";
  }

  const lines: string[] = [`Aliases (${keys.length}):`];
  for (const key of keys) {
    lines.push(`  ${key} = ${aliases[key]}`);
  }

  lines.push("");
  lines.push("Define: /run alias NAME COMMAND...");
  lines.push("Delete: /run alias -d NAME");

  return lines.join("\n");
}

export function formatAliasShow(name: string, command: string): string {
  return `${name} = ${command}`;
}

export function formatAliasSet(name: string, command: string): string {
  return `Alias set: ${name} = ${command}`;
}

export function formatAliasDeleted(name: string): string {
  return `Alias deleted: ${name}`;
}

// ============================================================================
// Session Status Formatter
// ============================================================================

function formatDuration(ms: number): string {
  if (ms <= 0) return "0s";
  const totalSec = Math.floor(ms / 1000);
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;

  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  return `${seconds}s`;
}

// ============================================================================
// Clear, Config & Blocklist Formatters
// ============================================================================

export function formatClearSuccess(): string {
  return "Session cleared (history, env, aliases, output cache, workdir reset).";
}

export function formatBlockedCommand(command: string, patternSource: string): string {
  const escaped = patternSource.replace(/\//g, "\\/");
  return `Blocked by pattern: /${escaped}/\n> ${command}`;
}

// ============================================================================
// PIN Authentication Formatters
// ============================================================================

export function formatPinLocked(reason: string): string {
  return reason;
}

export function formatPinUnlocked(message: string): string {
  return message;
}

export function formatPinFailed(message: string): string {
  return message;
}

export function formatSessionStatus(params: {
  workdir: string;
  ttlRemainingMs: number;
  historyCount: number;
  maxHistory: number;
  envCount: number;
  maxEnv: number;
  aliasCount: number;
  maxAliases: number;
  maskOutput: boolean;
  pinConfigured?: boolean;
  pinUnlocked?: boolean;
}): string {
  const lines = [
    "Session status:",
    `  Working directory: ${params.workdir}`,
    `  TTL remaining: ${formatDuration(params.ttlRemainingMs)}`,
    `  History: ${params.historyCount}/${params.maxHistory}`,
    `  Env vars: ${params.envCount}/${params.maxEnv}`,
    `  Aliases: ${params.aliasCount}/${params.maxAliases}`,
    `  Output masking: ${params.maskOutput ? "on" : "off"}`,
  ];
  if (params.pinConfigured !== undefined) {
    lines.push(
      `  PIN: ${params.pinConfigured ? (params.pinUnlocked ? "unlocked" : "locked") : "not configured"}`,
    );
  }
  return lines.join("\n");
}

export function formatConfigView(params: {
  enabled: boolean;
  allowedPathsCount: number;
  commandTimeout: number;
  maxOutputBytes: number;
  maskOutput: boolean;
  blockedPatterns: RegExp[];
  rateLimits: { maxCallsPerWindow: number; windowMs: number };
  confirmation: {
    autoApproveMaxRisk: string;
    approvalTtlMs: number;
    maxPending: number;
    showRiskLevel: boolean;
  };
  session: {
    sessionTtlMs: number;
    outputPageSize: number;
    maxHistorySize: number;
    maxEnvVars: number;
    maxAliases: number;
  };
  pin?: {
    configured: boolean;
    pinAutoLockMs: number;
    pinMaxAttempts: number;
  };
}): string {
  const lines: string[] = [
    "Active configuration:",
    "",
    "General:",
    `  enabled: ${params.enabled}`,
    `  allowedPaths: ${params.allowedPathsCount} path(s)`,
    `  commandTimeout: ${params.commandTimeout}ms`,
    `  maxOutputBytes: ${params.maxOutputBytes}`,
    `  maskOutput: ${params.maskOutput}`,
    `  blockedPatterns: ${params.blockedPatterns.length} pattern(s)`,
  ];

  for (const re of params.blockedPatterns) {
    lines.push(`    - /${re.source}/`);
  }

  lines.push(
    "",
    "Rate limits:",
    `  maxCallsPerWindow: ${params.rateLimits.maxCallsPerWindow}`,
    `  windowMs: ${params.rateLimits.windowMs}ms`,
    "",
    "Confirmation:",
    `  autoApproveMaxRisk: ${params.confirmation.autoApproveMaxRisk}`,
    `  approvalTtlMs: ${params.confirmation.approvalTtlMs}ms`,
    `  maxPending: ${params.confirmation.maxPending}`,
    `  showRiskLevel: ${params.confirmation.showRiskLevel}`,
    "",
    "Session:",
    `  sessionTtlMs: ${params.session.sessionTtlMs}ms`,
    `  outputPageSize: ${params.session.outputPageSize}`,
    `  maxHistorySize: ${params.session.maxHistorySize}`,
    `  maxEnvVars: ${params.session.maxEnvVars}`,
    `  maxAliases: ${params.session.maxAliases}`,
  );

  if (params.pin) {
    lines.push(
      "",
      "PIN:",
      `  configured: ${params.pin.configured ? "yes" : "no"}`,
      `  autoLockMs: ${params.pin.pinAutoLockMs}ms`,
      `  maxAttempts: ${params.pin.pinMaxAttempts}`,
    );
  }

  return lines.join("\n");
}

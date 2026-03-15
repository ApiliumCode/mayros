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

    if (this.pending.size >= this.config.maxPending) {
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
  command: string,
  totalPages: number,
  remainingLines: number,
  durationMs: number,
  exitCode: number,
): string {
  const parts: string[] = [];

  parts.push(`> ${command}`);

  if (firstPageContent.trim()) {
    parts.push("```");
    parts.push(firstPageContent.trimEnd());
    parts.push("```");
  }

  const meta: string[] = [];
  if (exitCode !== 0) {
    meta.push(`exit: ${exitCode}`);
  }
  meta.push(`${durationMs}ms`);
  parts.push(meta.join(" | "));

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

  if (pageContent.trim()) {
    parts.push("```");
    parts.push(pageContent.trimEnd());
    parts.push("```");
  }

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
    "  /run cd <path>        Change working directory",
    "  /run pwd              Show current working directory",
    "  /run more             Show next page of output",
    "  /run approve <id>     Approve a pending command",
    "  /run deny <id>        Deny a pending command",
    "  /run pending          List pending requests",
    "  /run help             Show this help",
  ].join("\n");
}

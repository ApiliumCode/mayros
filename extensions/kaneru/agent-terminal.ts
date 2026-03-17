/**
 * Agent Terminal Service
 *
 * Wraps the remote-exec system for agent-driven command execution.
 * Agents can execute shell commands on paired devices as part of
 * mission execution, with full audit trail.
 *
 * Security: delegates to remote-exec's sandbox, PIN auth, path
 * validation, and rate limiting.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type AgentTerminalConfig = {
  enabled: boolean;
  allowedPaths: string[];
  commandTimeout: number;
  requirePin: boolean;
};

export type TerminalExecResult = {
  id: string;
  agentId: string;
  missionId: string | null;
  command: string;
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  executedAt: string;
};

const DEFAULT_CONFIG: AgentTerminalConfig = {
  enabled: true,
  allowedPaths: [],
  commandTimeout: 30_000,
  requirePin: false,
};

// ============================================================================
// Helpers
// ============================================================================

function terminalSubject(ns: string, id: string): string {
  return `${ns}:terminal:${id}`;
}

function terminalPredicate(ns: string, field: string): string {
  return `${ns}:terminal:${field}`;
}

function stripBrackets(s: string): string {
  return s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1) : s;
}

// ============================================================================
// AgentTerminalService
// ============================================================================

export class AgentTerminalService {
  private readonly config: AgentTerminalConfig;

  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    config?: Partial<AgentTerminalConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if terminal execution is enabled. */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Execute a command and record it in the audit trail.
   * Note: actual shell execution should be delegated to remote-exec service.
   * This method records the execution metadata as Cortex triples.
   */
  async recordExecution(
    agentId: string,
    command: string,
    result: { exitCode: number; stdout: string; stderr: string; durationMs: number },
    missionId?: string,
  ): Promise<TerminalExecResult> {
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = terminalSubject(this.ns, id);

    const fields: Array<[string, string | number]> = [
      ["agentId", agentId],
      ["command", command],
      ["exitCode", result.exitCode],
      ["stdout", result.stdout.slice(0, 2000)],
      ["stderr", result.stderr.slice(0, 1000)],
      ["durationMs", result.durationMs],
      ["executedAt", now],
    ];

    if (missionId) fields.push(["missionId", missionId]);

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: terminalPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      agentId,
      missionId: missionId ?? null,
      command,
      exitCode: result.exitCode,
      stdout: result.stdout,
      stderr: result.stderr,
      durationMs: result.durationMs,
      executedAt: now,
    };
  }

  /** Get execution history for an agent. */
  async getHistory(agentId: string, limit = 20): Promise<TerminalExecResult[]> {
    const result = await this.client.patternQuery({
      predicate: terminalPredicate(this.ns, "agentId"),
      object: agentId,
      limit,
    });

    const executions: TerminalExecResult[] = [];
    const prefix = `${this.ns}:terminal:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const exec = await this.getExecution(id);
      if (exec) executions.push(exec);
    }

    return executions.sort((a, b) =>
      new Date(b.executedAt).getTime() - new Date(a.executedAt).getTime(),
    );
  }

  /** Get a specific execution record. */
  private async getExecution(id: string): Promise<TerminalExecResult | null> {
    const subject = terminalSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 20 });

    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const prefix = `${this.ns}:terminal:`;

    for (const t of result.triples) {
      const pred = stripBrackets(String(t.predicate));
      if (pred.startsWith(prefix)) {
        fields[pred.slice(prefix.length)] = String(t.object);
      }
    }

    return {
      id,
      agentId: fields.agentId ?? "",
      missionId: fields.missionId ?? null,
      command: fields.command ?? "",
      exitCode: parseInt(fields.exitCode ?? "1", 10),
      stdout: fields.stdout ?? "",
      stderr: fields.stderr ?? "",
      durationMs: parseInt(fields.durationMs ?? "0", 10),
      executedAt: fields.executedAt ?? "",
    };
  }
}

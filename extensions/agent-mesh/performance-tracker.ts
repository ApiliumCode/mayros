/**
 * Performance Tracker
 *
 * Tracks per-agent performance metrics with EMA smoothing.
 * Stores records in Cortex triples for persistence.
 */

import type { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type TaskOutcome = {
  agentId: string;
  completed: boolean;
  durationMs: number;
  costUsd: number;
  findings: number;
  conflicts: number;
};

export type AgentPerformanceRecord = {
  agentId: string;
  totalTasks: number;
  completedTasks: number;
  avgDurationMs: number;
  avgCostUsd: number;
  scoreEma: number; // 0.0 - 1.0
};

// ============================================================================
// Constants
// ============================================================================

const EMA_SMOOTHING = 0.3;
const PREDICATE_PREFIX = "miteru:perf:";

// ============================================================================
// PerformanceTracker
// ============================================================================

export class PerformanceTracker {
  private cache = new Map<string, AgentPerformanceRecord>();

  constructor(
    private readonly client: CortexClient | null,
    private readonly ns: string,
  ) {}

  /**
   * Record a task outcome and update the agent's performance record.
   */
  async recordOutcome(outcome: TaskOutcome): Promise<void> {
    let record = this.cache.get(outcome.agentId);
    if (!record) {
      record = await this.loadRecord(outcome.agentId);
    }

    if (!record) {
      record = {
        agentId: outcome.agentId,
        totalTasks: 0,
        completedTasks: 0,
        avgDurationMs: 0,
        avgCostUsd: 0,
        scoreEma: 0.5, // neutral start
      };
    }

    record.totalTasks++;
    if (outcome.completed) record.completedTasks++;

    // Running average for duration and cost
    record.avgDurationMs =
      record.avgDurationMs + (outcome.durationMs - record.avgDurationMs) / record.totalTasks;
    record.avgCostUsd =
      record.avgCostUsd + (outcome.costUsd - record.avgCostUsd) / record.totalTasks;

    // Compute instant score (0-1) from outcome
    const completionScore = outcome.completed ? 1.0 : 0.0;
    const findingsBonus = Math.min(0.2, outcome.findings * 0.02);
    const conflictPenalty = Math.min(0.15, outcome.conflicts * 0.05);
    const instantScore = Math.max(
      0,
      Math.min(1, completionScore + findingsBonus - conflictPenalty),
    );

    // EMA update
    record.scoreEma = EMA_SMOOTHING * instantScore + (1 - EMA_SMOOTHING) * record.scoreEma;

    this.cache.set(outcome.agentId, record);
    await this.persistRecord(record);
  }

  /**
   * Get the performance record for an agent.
   */
  async getPerformance(agentId: string): Promise<AgentPerformanceRecord | null> {
    const cached = this.cache.get(agentId);
    if (cached) return cached;
    return this.loadRecord(agentId);
  }

  /**
   * Get the EMA score for an agent (0.0 - 1.0). Returns 0.5 if unknown.
   */
  async getScore(agentId: string): Promise<number> {
    const record = await this.getPerformance(agentId);
    return record?.scoreEma ?? 0.5;
  }

  /**
   * Get all cached performance records.
   */
  getAllCached(): AgentPerformanceRecord[] {
    return [...this.cache.values()];
  }

  // ---------- persistence ----------

  private async loadRecord(agentId: string): Promise<AgentPerformanceRecord | null> {
    if (!this.client) return null;

    try {
      const subject = `${this.ns}:${PREDICATE_PREFIX}${agentId}`;
      const result = await this.client.listTriples({ subject, limit: 10 });

      if (result.triples.length === 0) return null;

      const fields: Record<string, string> = {};
      for (const t of result.triples) {
        const pred = String(t.predicate);
        const prefix = `${this.ns}:${PREDICATE_PREFIX}`;
        if (pred.startsWith(prefix)) {
          const field = pred.slice(prefix.length);
          fields[field] =
            typeof t.object === "object" && t.object !== null && "node" in t.object
              ? String((t.object as { node: string }).node)
              : String(t.object);
        }
      }

      const record: AgentPerformanceRecord = {
        agentId,
        totalTasks: Number(fields.totalTasks) || 0,
        completedTasks: Number(fields.completedTasks) || 0,
        avgDurationMs: Number(fields.avgDurationMs) || 0,
        avgCostUsd: Number(fields.avgCostUsd) || 0,
        scoreEma: Number(fields.scoreEma) || 0.5,
      };

      this.cache.set(agentId, record);
      return record;
    } catch {
      return null;
    }
  }

  private async persistRecord(record: AgentPerformanceRecord): Promise<void> {
    if (!this.client) return;

    try {
      const subject = `${this.ns}:${PREDICATE_PREFIX}${record.agentId}`;

      // Delete existing
      const existing = await this.client.listTriples({ subject, limit: 20 });
      for (const t of existing.triples) {
        if (t.id) await this.client.deleteTriple(t.id);
      }

      // Write new values
      const fields: Array<[string, string]> = [
        ["totalTasks", String(record.totalTasks)],
        ["completedTasks", String(record.completedTasks)],
        ["avgDurationMs", String(record.avgDurationMs)],
        ["avgCostUsd", String(record.avgCostUsd)],
        ["scoreEma", String(record.scoreEma)],
      ];

      for (const [field, value] of fields) {
        await this.client.createTriple({
          subject,
          predicate: `${this.ns}:${PREDICATE_PREFIX}${field}`,
          object: value,
        });
      }
    } catch {
      // best-effort persistence
    }
  }
}

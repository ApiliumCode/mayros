/**
 * ObservabilityQueryEngine — aggregation and analysis of trace events.
 *
 * Provides stats, slow-operation detection, and error pattern analysis
 * by querying Cortex for stored trace events.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import type { TraceEvent, TraceEventType } from "./trace-emitter.js";

// ============================================================================
// Types
// ============================================================================

export type AgentStats = {
  agentId: string;
  totalEvents: number;
  toolCalls: number;
  llmCalls: number;
  decisions: number;
  delegations: number;
  errors: number;
  avgToolDurationMs: number;
  avgLLMDurationMs: number;
};

export type ErrorPattern = {
  error: string;
  count: number;
  lastSeen: string;
  agentId: string;
};

export type TimeRange = { from?: Date; to?: Date };

// ============================================================================
// ObservabilityQueryEngine
// ============================================================================

export class ObservabilityQueryEngine {
  constructor(
    private client: CortexClient,
    private ns: string,
  ) {}

  /**
   * Aggregate stats for an agent over a time range.
   */
  async aggregateStats(agentId: string, timeRange?: TimeRange): Promise<AgentStats> {
    const events = await this.fetchEvents(agentId, timeRange);

    let toolCalls = 0;
    let llmCalls = 0;
    let decisions = 0;
    let delegations = 0;
    let errors = 0;
    let toolDurationSum = 0;
    let toolDurationCount = 0;
    let llmDurationSum = 0;
    let llmDurationCount = 0;

    for (const evt of events) {
      switch (evt.type) {
        case "tool_call":
          toolCalls++;
          if (evt.durationMs !== undefined) {
            toolDurationSum += evt.durationMs;
            toolDurationCount++;
          }
          break;
        case "llm_call":
          llmCalls++;
          if (evt.durationMs !== undefined) {
            llmDurationSum += evt.durationMs;
            llmDurationCount++;
          }
          break;
        case "decision":
          decisions++;
          break;
        case "delegation":
          delegations++;
          break;
        case "error":
          errors++;
          break;
      }
    }

    return {
      agentId,
      totalEvents: events.length,
      toolCalls,
      llmCalls,
      decisions,
      delegations,
      errors,
      avgToolDurationMs:
        toolDurationCount > 0 ? Math.round(toolDurationSum / toolDurationCount) : 0,
      avgLLMDurationMs: llmDurationCount > 0 ? Math.round(llmDurationSum / llmDurationCount) : 0,
    };
  }

  /**
   * Find operations exceeding a duration threshold.
   */
  async findSlowOps(agentId: string, thresholdMs: number): Promise<TraceEvent[]> {
    const events = await this.fetchEvents(agentId);

    return events.filter(
      (evt) =>
        (evt.type === "tool_call" || evt.type === "llm_call") &&
        evt.durationMs !== undefined &&
        evt.durationMs > thresholdMs,
    );
  }

  /**
   * Find error patterns for an agent.
   */
  async findErrors(agentId: string, limit = 20): Promise<ErrorPattern[]> {
    const events = await this.fetchEvents(agentId);

    const errorEvents = events.filter((evt) => evt.type === "error");

    // Group by error message
    const errorMap = new Map<string, { count: number; lastSeen: string; agentId: string }>();

    for (const evt of errorEvents) {
      const errorMsg = evt.fields.error ?? "unknown";
      const existing = errorMap.get(errorMsg);
      if (existing) {
        existing.count++;
        if (evt.timestamp > existing.lastSeen) {
          existing.lastSeen = evt.timestamp;
        }
      } else {
        errorMap.set(errorMsg, {
          count: 1,
          lastSeen: evt.timestamp,
          agentId: evt.agentId,
        });
      }
    }

    // Sort by count descending
    const patterns: ErrorPattern[] = [];
    for (const [error, data] of errorMap.entries()) {
      patterns.push({ error, ...data });
    }
    patterns.sort((a, b) => b.count - a.count);

    return patterns.slice(0, limit);
  }

  // ---------- Private helpers ----------

  private async fetchEvents(agentId: string, timeRange?: TimeRange): Promise<TraceEvent[]> {
    const params: Record<string, string | undefined> = { agentId };
    if (timeRange?.from) {
      params.from = timeRange.from.toISOString();
    }
    if (timeRange?.to) {
      params.to = timeRange.to.toISOString();
    }

    const result = await this.client.getEvents(params);
    return (result.events ?? []) as TraceEvent[];
  }
}

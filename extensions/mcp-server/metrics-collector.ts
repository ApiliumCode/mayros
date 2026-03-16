/**
 * MCP Metrics Collector.
 *
 * Tracks tool call invocations for the MCP Dashboard: per-tool aggregates
 * (call count, error count, total duration) and a ring buffer of recent
 * calls so the UI can show a live activity log.
 */

// ============================================================================
// Types
// ============================================================================

export type ToolCallRecord = {
  timestamp: number;
  toolName: string;
  durationMs: number;
  status: "ok" | "error";
  params?: string;
};

export type ToolMetrics = {
  toolName: string;
  callCount: number;
  errorCount: number;
  totalDurationMs: number;
  lastCalledAt: number;
};

export type McpMetricsSnapshot = {
  startedAt: number;
  tools: ToolMetrics[];
  recentCalls: ToolCallRecord[];
  totalCalls: number;
  totalErrors: number;
};

// ============================================================================
// Collector
// ============================================================================

const MAX_RECENT = 100;
const MAX_PARAMS_LENGTH = 200;

export class McpMetricsCollector {
  private readonly startedAt: number;
  private readonly ringBuffer: ToolCallRecord[] = [];
  private ringHead = 0;
  private ringSize = 0;
  private readonly toolMap = new Map<string, ToolMetrics>();
  private totalCalls = 0;
  private totalErrors = 0;

  constructor() {
    this.startedAt = Date.now();
  }

  /** Record a tool invocation result. O(1). */
  recordCall(toolName: string, durationMs: number, isError: boolean, params?: string): void {
    const now = Date.now();

    // Truncate params if provided
    let truncated = params;
    if (truncated && truncated.length > MAX_PARAMS_LENGTH) {
      truncated = truncated.slice(0, MAX_PARAMS_LENGTH) + "...";
    }

    // Ring buffer insert
    const record: ToolCallRecord = {
      timestamp: now,
      toolName,
      durationMs,
      status: isError ? "error" : "ok",
      params: truncated,
    };

    if (this.ringSize < MAX_RECENT) {
      this.ringBuffer.push(record);
      this.ringSize++;
    } else {
      this.ringBuffer[this.ringHead] = record;
    }
    this.ringHead = (this.ringHead + 1) % MAX_RECENT;

    // Per-tool aggregation
    let metrics = this.toolMap.get(toolName);
    if (!metrics) {
      metrics = { toolName, callCount: 0, errorCount: 0, totalDurationMs: 0, lastCalledAt: 0 };
      this.toolMap.set(toolName, metrics);
    }
    metrics.callCount++;
    if (isError) metrics.errorCount++;
    metrics.totalDurationMs += durationMs;
    metrics.lastCalledAt = now;

    // Totals
    this.totalCalls++;
    if (isError) this.totalErrors++;
  }

  /** Return a full snapshot (recent calls newest-first). */
  snapshot(): McpMetricsSnapshot {
    // Extract recent calls in reverse chronological order
    const recent: ToolCallRecord[] = [];
    if (this.ringSize > 0) {
      let idx = (this.ringHead - 1 + MAX_RECENT) % MAX_RECENT;
      for (let i = 0; i < this.ringSize; i++) {
        recent.push(this.ringBuffer[idx]);
        idx = (idx - 1 + MAX_RECENT) % MAX_RECENT;
      }
    }

    return {
      startedAt: this.startedAt,
      tools: [...this.toolMap.values()],
      recentCalls: recent,
      totalCalls: this.totalCalls,
      totalErrors: this.totalErrors,
    };
  }

  /** Reset all metrics. */
  reset(): void {
    this.ringBuffer.length = 0;
    this.ringHead = 0;
    this.ringSize = 0;
    this.toolMap.clear();
    this.totalCalls = 0;
    this.totalErrors = 0;
  }
}

/**
 * TraceEmitter — emits structured trace events as RDF triples via Cortex.
 *
 * Events are buffered in memory and flushed periodically (or on stop)
 * to the Cortex /api/v1/events endpoint in batch.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient, EventPayload } from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type TraceEventType = "tool_call" | "llm_call" | "decision" | "delegation" | "error";

export type TraceEvent = {
  id: string;
  type: TraceEventType;
  agentId: string;
  timestamp: string;
  session?: string;
  parentEvent?: string;
  durationMs?: number;
  fields: Record<string, string>;
};

// ============================================================================
// TraceEmitter
// ============================================================================

/** Default maximum buffer size. Events beyond this limit cause oldest to be dropped. */
const DEFAULT_MAX_BUFFER_SIZE = 5000;
/** Events older than this TTL are discarded during flush. */
const EVENT_TTL_MS = 5 * 60 * 1000; // 5 minutes
/** Maximum backoff multiplier for flush interval on consecutive failures. */
const MAX_BACKOFF_INTERVAL_MS = 60_000;

export class TraceEmitter {
  private buffer: TraceEvent[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private readonly maxBufferSize: number;

  constructor(
    private client: CortexClient,
    private ns: string,
    private flushIntervalMs: number,
    options?: { maxBufferSize?: number },
  ) {
    this.maxBufferSize = options?.maxBufferSize ?? DEFAULT_MAX_BUFFER_SIZE;
  }

  // ---------- Lifecycle ----------

  /**
   * Start the background flush timer.
   */
  start(): void {
    if (this.flushTimer) return;
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }
    const effectiveInterval = Math.min(
      this.flushIntervalMs * 2 ** this.consecutiveFailures,
      MAX_BACKOFF_INTERVAL_MS,
    );
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, effectiveInterval);
    // Allow the timer to not block process exit
    if (this.flushTimer && typeof this.flushTimer === "object" && "unref" in this.flushTimer) {
      this.flushTimer.unref();
    }
  }

  /**
   * Stop the flush timer and flush any remaining buffered events.
   */
  async stop(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }
    await this.flush();
    // If events remain after final flush attempt, they are being dropped
    if (this.buffer.length > 0) {
      console.warn(`[trace-emitter] dropping ${this.buffer.length} unflushed events on stop`);
      this.buffer.length = 0;
    }
  }

  // ---------- Buffer helpers ----------

  private pushEvent(event: TraceEvent): void {
    // Cap buffer size — drop oldest events (FIFO)
    while (this.buffer.length >= this.maxBufferSize) {
      this.buffer.shift();
    }
    this.buffer.push(event);
  }

  // ---------- Emit methods ----------

  /**
   * Record a tool invocation.
   */
  emitToolCall(
    agentId: string,
    toolName: string,
    input: unknown,
    output: unknown,
    durationMs: number,
    session?: string,
  ): string {
    const id = randomUUID();
    const event: TraceEvent = {
      id,
      type: "tool_call",
      agentId,
      timestamp: new Date().toISOString(),
      session,
      durationMs,
      fields: {
        toolName,
        input: typeof input === "string" ? input : JSON.stringify(input),
        output: typeof output === "string" ? output : JSON.stringify(output),
      },
    };
    this.pushEvent(event);
    return id;
  }

  /**
   * Record an LLM call.
   */
  emitLLMCall(
    agentId: string,
    model: string,
    promptTokens: number,
    completionTokens: number,
    durationMs: number,
    session?: string,
  ): string {
    const id = randomUUID();
    const event: TraceEvent = {
      id,
      type: "llm_call",
      agentId,
      timestamp: new Date().toISOString(),
      session,
      durationMs,
      fields: {
        model,
        promptTokens: String(promptTokens),
        completionTokens: String(completionTokens),
        totalTokens: String(promptTokens + completionTokens),
      },
    };
    this.pushEvent(event);
    return id;
  }

  /**
   * Record a decision point.
   */
  emitDecision(
    agentId: string,
    description: string,
    alternatives: string[],
    chosen: string,
    reasoning?: string,
    session?: string,
  ): string {
    const id = randomUUID();
    const fields: Record<string, string> = {
      description,
      alternatives: JSON.stringify(alternatives),
      chosen,
    };
    if (reasoning) {
      fields.reasoning = reasoning;
    }
    const event: TraceEvent = {
      id,
      type: "decision",
      agentId,
      timestamp: new Date().toISOString(),
      session,
      fields,
    };
    this.pushEvent(event);
    return id;
  }

  /**
   * Record a subagent delegation.
   */
  emitDelegation(
    parentId: string,
    childId: string,
    task: string,
    runId: string,
    session?: string,
  ): string {
    const id = randomUUID();
    const event: TraceEvent = {
      id,
      type: "delegation",
      agentId: parentId,
      timestamp: new Date().toISOString(),
      session,
      fields: {
        parentId,
        childId,
        task,
        runId,
      },
    };
    this.pushEvent(event);
    return id;
  }

  /**
   * Record an error.
   */
  emitError(agentId: string, error: string, context?: string, session?: string): string {
    const id = randomUUID();
    const fields: Record<string, string> = { error };
    if (context) {
      fields.context = context;
    }
    const event: TraceEvent = {
      id,
      type: "error",
      agentId,
      timestamp: new Date().toISOString(),
      session,
      fields,
    };
    this.pushEvent(event);
    return id;
  }

  // ---------- Raw emit (for fork/copy) ----------

  /**
   * Push a pre-built event into the buffer without generating a new id or
   * timestamp. Used by SessionForkManager to copy events across sessions.
   */
  emitRaw(event: TraceEvent): void {
    this.pushEvent(event);
  }

  // ---------- Buffer access (for testing) ----------

  /**
   * Return the current number of buffered events.
   */
  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Return the count of buffered events, optionally filtered by session.
   */
  getBufferedEventCount(session?: string): number {
    if (!session) return this.buffer.length;
    return this.buffer.filter((e) => e.session === session).length;
  }

  /**
   * Return a shallow copy of the current buffer (for testing/inspection).
   */
  getBufferedEvents(): TraceEvent[] {
    return [...this.buffer];
  }

  // ---------- Flush ----------

  /**
   * Flush buffered events to Cortex POST /api/v1/events.
   *
   * Events are serialised as RDF-style objects with namespace-prefixed
   * subjects and predicates:
   *   subject: {ns}:event:{id}
   *   predicate: {ns}:event:{field}
   */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;

    // TTL: discard events older than 5 minutes
    const now = Date.now();
    const beforeLen = this.buffer.length;
    this.buffer = this.buffer.filter(
      (evt) => now - new Date(evt.timestamp).getTime() < EVENT_TTL_MS,
    );
    const ttlDropped = beforeLen - this.buffer.length;
    if (ttlDropped > 0 && this.buffer.length > 0) {
      // Silently discard stale events
    }

    if (this.buffer.length === 0) return;

    const events = this.buffer.splice(0);

    const payload: EventPayload[] = events.map((evt) => ({
      subject: `${this.ns}:event:${evt.id}`,
      type: evt.type,
      agentId: evt.agentId,
      timestamp: evt.timestamp,
      session: evt.session,
      parentEvent: evt.parentEvent,
      durationMs: evt.durationMs,
      fields: evt.fields,
    }));

    try {
      const res = await this.client.emitEvents(payload);

      if (!res.ok) {
        // Put events back into the buffer for retry
        this.buffer.unshift(...events);
        this.consecutiveFailures++;
        this.scheduleFlush();
      } else {
        if (this.consecutiveFailures > 0) {
          this.consecutiveFailures = 0;
          this.scheduleFlush(); // restore normal interval
        }
      }
    } catch {
      // Network error — put events back for retry
      this.buffer.unshift(...events);
      this.consecutiveFailures++;
      this.scheduleFlush();
    }
  }
}

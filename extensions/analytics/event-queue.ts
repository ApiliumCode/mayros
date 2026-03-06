/**
 * Analytics Event Queue — in-memory buffer with periodic batch flush.
 *
 * Follows the same pattern as TraceEmitter:
 * - Memory buffer with max size
 * - Timer-based flush with exponential backoff
 * - TTL for stale events
 * - Graceful shutdown
 */

import { createHash } from "node:crypto";
import type { AnalyticsEvent, AnalyticsBatch } from "./event-schema.js";
import { createBatch } from "./event-schema.js";

export type EventQueueConfig = {
  /** Max events in buffer before force-flush (default: 500). */
  maxBufferSize: number;
  /** Flush interval in ms (default: 30_000). */
  flushIntervalMs: number;
  /** Max backoff on failure in ms (default: 300_000). */
  maxBackoffMs: number;
  /** Event TTL in ms — discard events older than this (default: 3_600_000 = 1h). */
  eventTtlMs: number;
  /** Client version string. */
  clientVersion: string;
  /** Flush callback — called with batch to deliver. */
  onFlush?: (batch: AnalyticsBatch) => Promise<void>;
};

const DEFAULT_CONFIG: EventQueueConfig = {
  maxBufferSize: 500,
  flushIntervalMs: 30_000,
  maxBackoffMs: 300_000,
  eventTtlMs: 3_600_000,
  clientVersion: "unknown",
};

export class EventQueue {
  private buffer: AnalyticsEvent[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private consecutiveFailures = 0;
  private config: EventQueueConfig;
  private stopped = false;

  constructor(config: Partial<EventQueueConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Start the periodic flush timer. */
  start(): void {
    if (this.timer) return;
    this.stopped = false;
    this.timer = setInterval(() => {
      void this.flush();
    }, this.currentIntervalMs());
  }

  /** Stop the timer and flush remaining events. */
  async stop(): Promise<void> {
    this.stopped = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Final flush
    await this.flush();
  }

  /** Enqueue an event. Force-flushes if buffer is full. */
  enqueue(event: AnalyticsEvent): void {
    if (this.stopped) return;
    this.buffer.push(event);
    if (this.buffer.length >= this.config.maxBufferSize) {
      void this.flush();
    }
  }

  /** Flush all buffered events. */
  async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    if (!this.config.onFlush) return;

    // Drain buffer, enforce TTL
    const now = Date.now();
    const events = this.buffer.filter((e) => {
      const age = now - new Date(e.timestamp).getTime();
      return age < this.config.eventTtlMs;
    });
    this.buffer = [];

    if (events.length === 0) return;

    const batch = createBatch(events, this.config.clientVersion);

    try {
      await this.config.onFlush(batch);
      this.consecutiveFailures = 0;
    } catch {
      // Re-buffer events on failure (up to max)
      this.buffer.unshift(...events.slice(0, this.config.maxBufferSize - this.buffer.length));
      this.consecutiveFailures++;
      // Restart timer with backoff
      this.restartTimer();
    }
  }

  /** Get current buffer size. */
  getBufferSize(): number {
    return this.buffer.length;
  }

  /** Get consecutive failure count. */
  getFailureCount(): number {
    return this.consecutiveFailures;
  }

  /** Get buffered events (for testing). */
  getBufferedEvents(): readonly AnalyticsEvent[] {
    return this.buffer;
  }

  private currentIntervalMs(): number {
    if (this.consecutiveFailures === 0) return this.config.flushIntervalMs;
    const backoff = this.config.flushIntervalMs * Math.pow(2, this.consecutiveFailures);
    return Math.min(backoff, this.config.maxBackoffMs);
  }

  private restartTimer(): void {
    if (this.timer) {
      clearInterval(this.timer);
    }
    if (!this.stopped) {
      this.timer = setInterval(() => {
        void this.flush();
      }, this.currentIntervalMs());
    }
  }
}

/**
 * Hash a string for anonymization (SHA-256, first 16 hex chars).
 */
export function anonymize(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 16);
}

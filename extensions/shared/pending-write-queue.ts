/**
 * PendingWriteQueue — buffers failed Cortex writes for retry on recovery.
 *
 * When Cortex is unreachable, writes (createTriple, deleteTriple) are
 * enqueued. On recovery (HealthMonitor signals healthy), the queue is
 * drained by replaying writes in order.
 */

import { writeFile, readFile } from "node:fs/promises";

export type PendingWriteType = "createTriple" | "deleteTriple";

export type PendingWrite = {
  type: PendingWriteType;
  payload: unknown;
  timestamp: number;
  attempts: number;
};

export type PendingWriteQueueOptions = {
  /** Maximum queued writes. Oldest are dropped when full. Default: 200. */
  maxSize?: number;
  /** Retry interval in ms. Default: 30_000. */
  retryIntervalMs?: number;
  /** Optional disk persistence path for crash recovery. */
  persistPath?: string;
};

export type WriteExecutor = (write: PendingWrite) => Promise<void>;

export class PendingWriteQueue {
  private queue: PendingWrite[] = [];
  private retryTimer: ReturnType<typeof setInterval> | null = null;
  private readonly maxSize: number;
  private readonly retryIntervalMs: number;
  private readonly persistPath?: string;
  private executor: WriteExecutor | null = null;
  private draining = false;

  constructor(options?: PendingWriteQueueOptions) {
    this.maxSize = options?.maxSize ?? 200;
    this.retryIntervalMs = options?.retryIntervalMs ?? 30_000;
    this.persistPath = options?.persistPath;
  }

  /**
   * Enqueue a failed write for later retry.
   * Returns false if the queue is full (oldest entry is dropped to make room).
   */
  enqueue(write: PendingWrite): boolean {
    if (this.queue.length >= this.maxSize) {
      // Drop oldest to make room
      this.queue.shift();
    }
    this.queue.push(write);
    return true;
  }

  /**
   * Start the retry timer. The executor function is called for each write during drain.
   */
  start(executor: WriteExecutor): void {
    this.executor = executor;
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.drain();
    }, this.retryIntervalMs);
    if (this.retryTimer && typeof this.retryTimer === "object" && "unref" in this.retryTimer) {
      this.retryTimer.unref();
    }
  }

  /**
   * Stop the queue. Optionally persists remaining writes to disk.
   */
  async stop(): Promise<void> {
    if (this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
    if (this.persistPath && this.queue.length > 0) {
      try {
        await writeFile(this.persistPath, JSON.stringify(this.queue), "utf-8");
      } catch {
        // Disk persistence is best-effort
      }
    }
    this.executor = null;
  }

  /**
   * Attempt to replay all queued writes. Called on recovery or by the retry timer.
   */
  async drain(): Promise<number> {
    if (this.draining || !this.executor || this.queue.length === 0) return 0;

    this.draining = true;
    let replayed = 0;

    try {
      while (this.queue.length > 0) {
        const write = this.queue[0];
        write.attempts++;
        try {
          await this.executor(write);
          this.queue.shift(); // success — remove from queue
          replayed++;
        } catch {
          // Failed — stop draining, leave remaining writes in queue for next retry
          break;
        }
      }
    } finally {
      this.draining = false;
    }

    return replayed;
  }

  /**
   * Load persisted writes from disk (crash recovery).
   */
  async loadFromDisk(): Promise<number> {
    if (!this.persistPath) return 0;
    try {
      const data = await readFile(this.persistPath, "utf-8");
      const writes = JSON.parse(data) as PendingWrite[];
      if (!Array.isArray(writes)) return 0;
      for (const w of writes) {
        this.enqueue(w);
      }
      return writes.length;
    } catch {
      return 0;
    }
  }

  getStats(): { queued: number; maxSize: number } {
    return { queued: this.queue.length, maxSize: this.maxSize };
  }

  /** Visible for testing. */
  getQueue(): readonly PendingWrite[] {
    return this.queue;
  }
}

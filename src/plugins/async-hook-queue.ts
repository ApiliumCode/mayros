/**
 * Async Hook Queue
 *
 * Provides fire-and-forget background hook execution with configurable
 * concurrency, retry with exponential backoff, and dead-letter logging.
 * Used for hooks that should not block the main agent flow.
 */

export type AsyncHookEntry = {
  hookName: string;
  event: Record<string, unknown>;
  ctx: Record<string, unknown>;
  handler: (event: unknown, ctx: unknown) => Promise<void>;
  attempt: number;
  enqueuedAt: number;
};

export type AsyncHookQueueOptions = {
  /** Max concurrent hook executions (default: 4) */
  concurrency?: number;
  /** Max retry attempts per entry (default: 2) */
  maxRetries?: number;
  /** Base delay for exponential backoff in ms (default: 500) */
  baseDelayMs?: number;
  /** Max age before discarding in ms (default: 30000) */
  maxAgeMs?: number;
  /** Called when an entry fails all retries */
  onDeadLetter?: (entry: AsyncHookEntry, error: Error) => void;
  logger?: {
    debug?: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export class AsyncHookQueue {
  private queue: AsyncHookEntry[] = [];
  private active = 0;
  private readonly concurrency: number;
  private readonly maxRetries: number;
  private readonly baseDelayMs: number;
  private readonly maxAgeMs: number;
  private readonly onDeadLetter: AsyncHookQueueOptions["onDeadLetter"];
  private readonly logger: AsyncHookQueueOptions["logger"];
  private drainResolvers: Array<() => void> = [];
  private pendingRetries = 0;
  private _totalProcessed = 0;
  private _totalFailed = 0;

  constructor(opts: AsyncHookQueueOptions = {}) {
    this.concurrency = Math.max(1, Math.min(opts.concurrency ?? 4, 16));
    this.maxRetries = Math.max(0, Math.min(opts.maxRetries ?? 2, 10));
    this.baseDelayMs = Math.max(100, Math.min(opts.baseDelayMs ?? 500, 10_000));
    this.maxAgeMs = Math.max(1000, Math.min(opts.maxAgeMs ?? 30_000, 300_000));
    this.onDeadLetter = opts.onDeadLetter;
    this.logger = opts.logger;
  }

  /**
   * Enqueue a hook for background execution.
   */
  enqueue(
    hookName: string,
    event: Record<string, unknown>,
    ctx: Record<string, unknown>,
    handler: (event: unknown, ctx: unknown) => Promise<void>,
  ): void {
    this.queue.push({
      hookName,
      event,
      ctx,
      handler,
      attempt: 0,
      enqueuedAt: Date.now(),
    });
    this.processNext();
  }

  /** Current queue depth (waiting entries) */
  get pending(): number {
    return this.queue.length;
  }

  /** Number of currently executing hooks */
  get running(): number {
    return this.active;
  }

  /** Total hooks successfully processed */
  get totalProcessed(): number {
    return this._totalProcessed;
  }

  /** Total hooks that failed all retries */
  get totalFailed(): number {
    return this._totalFailed;
  }

  /**
   * Wait until the queue is empty and all active executions complete.
   */
  async drain(): Promise<void> {
    if (this.queue.length === 0 && this.active === 0 && this.pendingRetries === 0) return;
    return new Promise<void>((resolve) => {
      this.drainResolvers.push(resolve);
    });
  }

  private processNext(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const entry = this.queue.shift()!;

      // Discard expired entries
      if (Date.now() - entry.enqueuedAt > this.maxAgeMs) {
        this.logger?.debug?.(
          `[async-hooks] discarding expired ${entry.hookName} (age ${Date.now() - entry.enqueuedAt}ms)`,
        );
        this._totalFailed++;
        continue;
      }

      this.active++;
      void this.execute(entry);
    }

    // If nothing is running, queue is empty, and no pending retries, resolve drain waiters
    if (this.active === 0 && this.queue.length === 0 && this.pendingRetries === 0) {
      for (const resolve of this.drainResolvers) resolve();
      this.drainResolvers = [];
    }
  }

  private async execute(entry: AsyncHookEntry): Promise<void> {
    try {
      await entry.handler(entry.event, entry.ctx);
      this._totalProcessed++;
      this.logger?.debug?.(
        `[async-hooks] ${entry.hookName} completed (attempt ${entry.attempt + 1})`,
      );
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));

      if (entry.attempt < this.maxRetries) {
        // Re-queue with backoff
        entry.attempt++;
        const delay = this.baseDelayMs * 2 ** (entry.attempt - 1);
        this.logger?.debug?.(
          `[async-hooks] ${entry.hookName} failed (attempt ${entry.attempt}), retrying in ${delay}ms`,
        );
        this.pendingRetries++;
        setTimeout(() => {
          this.pendingRetries--;
          this.queue.push(entry);
          this.processNext();
        }, delay);
      } else {
        // Dead letter
        this._totalFailed++;
        this.logger?.error(
          `[async-hooks] ${entry.hookName} failed after ${entry.attempt + 1} attempts: ${error.message}`,
        );
        this.onDeadLetter?.(entry, error);
      }
    } finally {
      this.active--;
      this.processNext();
    }
  }
}

export function createAsyncHookQueue(opts?: AsyncHookQueueOptions): AsyncHookQueue {
  return new AsyncHookQueue(opts);
}

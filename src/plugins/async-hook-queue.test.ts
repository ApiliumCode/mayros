import { describe, expect, it, vi, beforeEach } from "vitest";
import { AsyncHookQueue, createAsyncHookQueue } from "./async-hook-queue.js";
import type { AsyncHookQueueOptions } from "./async-hook-queue.js";

type TestLogger = NonNullable<AsyncHookQueueOptions["logger"]>;

describe("AsyncHookQueue", () => {
  let logger: TestLogger;

  beforeEach(() => {
    logger = {
      debug: vi.fn<(msg: string) => void>(),
      warn: vi.fn<(msg: string) => void>(),
      error: vi.fn<(msg: string) => void>(),
    };
  });

  it("processes enqueued hooks", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = new AsyncHookQueue({ logger });

    queue.enqueue("test_hook", { key: "val" }, { agentId: "a" }, handler);
    await queue.drain();

    expect(handler).toHaveBeenCalledWith({ key: "val" }, { agentId: "a" });
    expect(queue.totalProcessed).toBe(1);
    expect(queue.totalFailed).toBe(0);
  });

  it("respects concurrency limit", async () => {
    let concurrent = 0;
    let maxConcurrent = 0;

    const handler = vi.fn().mockImplementation(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 50));
      concurrent--;
    });

    const queue = new AsyncHookQueue({ concurrency: 2, logger });

    for (let i = 0; i < 6; i++) {
      queue.enqueue(`hook_${i}`, {}, {}, handler);
    }

    await queue.drain();

    expect(maxConcurrent).toBeLessThanOrEqual(2);
    expect(handler).toHaveBeenCalledTimes(6);
    expect(queue.totalProcessed).toBe(6);
  });

  it("retries failed hooks with backoff", async () => {
    let calls = 0;
    const handler = vi.fn().mockImplementation(async () => {
      calls++;
      if (calls < 3) throw new Error("transient");
    });

    const queue = new AsyncHookQueue({
      maxRetries: 2,
      baseDelayMs: 100,
      logger,
    });

    queue.enqueue("retry_hook", {}, {}, handler);
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(3); // 1 initial + 2 retries
    expect(queue.totalProcessed).toBe(1);
    expect(queue.totalFailed).toBe(0);
  });

  it("sends to dead letter after max retries", async () => {
    const handler = vi.fn().mockRejectedValue(new Error("permanent"));
    const onDeadLetter = vi.fn();

    const queue = new AsyncHookQueue({
      maxRetries: 1,
      baseDelayMs: 100,
      onDeadLetter,
      logger,
    });

    queue.enqueue("fail_hook", { data: 1 }, {}, handler);
    await queue.drain();

    expect(handler).toHaveBeenCalledTimes(2); // 1 initial + 1 retry
    expect(onDeadLetter).toHaveBeenCalledOnce();
    expect(onDeadLetter.mock.calls[0]![0].hookName).toBe("fail_hook");
    expect(onDeadLetter.mock.calls[0]![1]).toBeInstanceOf(Error);
    expect(queue.totalFailed).toBe(1);
  });

  it("discards expired entries", async () => {
    const handler = vi.fn().mockResolvedValue(undefined);
    const queue = new AsyncHookQueue({ maxAgeMs: 1000, logger });

    // Manually create an expired entry
    const entry = {
      hookName: "expired_hook",
      event: {},
      ctx: {},
      handler,
      attempt: 0,
      enqueuedAt: Date.now() - 2000, // 2s ago, max is 1s
    };
    // Access internal queue
    (queue as unknown as { queue: (typeof entry)[] }).queue.push(entry);
    // Trigger processing
    queue.enqueue("fresh_hook", {}, {}, handler);
    await queue.drain();

    // fresh_hook should have run, expired_hook should be discarded
    expect(handler).toHaveBeenCalledOnce();
    expect(queue.totalFailed).toBe(1); // expired counts as failed
    expect(queue.totalProcessed).toBe(1);
  });

  it("reports pending and running counts", async () => {
    let resolveHandler: (() => void) | null = null;
    const handler = vi.fn().mockImplementation(
      () =>
        new Promise<void>((r) => {
          resolveHandler = r;
        }),
    );

    const queue = new AsyncHookQueue({ concurrency: 1, logger });

    queue.enqueue("slow_hook", {}, {}, handler);
    queue.enqueue("queued_hook", {}, {}, vi.fn().mockResolvedValue(undefined));

    // Give the first one time to start
    await new Promise((r) => setTimeout(r, 10));

    expect(queue.running).toBe(1);
    expect(queue.pending).toBe(1);

    (resolveHandler as (() => void) | null)?.();
    await queue.drain();

    expect(queue.running).toBe(0);
    expect(queue.pending).toBe(0);
  });

  it("drain resolves immediately when empty", async () => {
    const queue = new AsyncHookQueue();
    await queue.drain(); // Should not hang
  });

  it("createAsyncHookQueue factory works", () => {
    const queue = createAsyncHookQueue({ concurrency: 2 });
    expect(queue).toBeInstanceOf(AsyncHookQueue);
  });

  it("clamps options to safe ranges", () => {
    const queue = new AsyncHookQueue({
      concurrency: 100, // clamped to 16
      maxRetries: 50, // clamped to 10
      baseDelayMs: 0, // clamped to 100
      maxAgeMs: 0, // clamped to 1000
    });
    // Just verify it doesn't throw
    expect(queue).toBeInstanceOf(AsyncHookQueue);
  });
});

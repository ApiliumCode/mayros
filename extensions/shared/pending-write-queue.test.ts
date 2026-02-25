import { writeFile, readFile, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { PendingWriteQueue, type PendingWrite } from "./pending-write-queue.js";

function makeWrite(type: "createTriple" | "deleteTriple" = "createTriple"): PendingWrite {
  return {
    type,
    payload: { subject: "s", predicate: "p", object: "o" },
    timestamp: Date.now(),
    attempts: 0,
  };
}

describe("PendingWriteQueue", () => {
  it("enqueue and drain on recovery", async () => {
    const q = new PendingWriteQueue({ maxSize: 10 });
    const executor = vi.fn().mockResolvedValue(undefined);

    q.enqueue(makeWrite());
    q.enqueue(makeWrite());
    q.start(executor);

    const replayed = await q.drain();
    expect(replayed).toBe(2);
    expect(executor).toHaveBeenCalledTimes(2);
    expect(q.getStats().queued).toBe(0);

    await q.stop();
  });

  it("max size enforced — oldest dropped", () => {
    const q = new PendingWriteQueue({ maxSize: 2 });

    const w1 = makeWrite();
    w1.payload = { id: "first" };
    const w2 = makeWrite();
    w2.payload = { id: "second" };
    const w3 = makeWrite();
    w3.payload = { id: "third" };

    q.enqueue(w1);
    q.enqueue(w2);
    q.enqueue(w3); // drops w1

    expect(q.getStats().queued).toBe(2);
    const queue = q.getQueue();
    expect((queue[0].payload as Record<string, string>).id).toBe("second");
    expect((queue[1].payload as Record<string, string>).id).toBe("third");
  });

  it("drain stops on first failure and retains remaining", async () => {
    const q = new PendingWriteQueue();
    const executor = vi
      .fn()
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("fail"));

    q.enqueue(makeWrite());
    q.enqueue(makeWrite());
    q.enqueue(makeWrite());
    q.start(executor);

    const replayed = await q.drain();
    expect(replayed).toBe(1);
    expect(q.getStats().queued).toBe(2);

    await q.stop();
  });

  it("drain is no-op when no executor", async () => {
    const q = new PendingWriteQueue();
    q.enqueue(makeWrite());
    const replayed = await q.drain();
    expect(replayed).toBe(0);
  });

  it("drain is no-op when queue is empty", async () => {
    const q = new PendingWriteQueue();
    const executor = vi.fn();
    q.start(executor);
    const replayed = await q.drain();
    expect(replayed).toBe(0);
    expect(executor).not.toHaveBeenCalled();
    await q.stop();
  });

  it("retry timer fires and replays", async () => {
    vi.useFakeTimers();

    const q = new PendingWriteQueue({ retryIntervalMs: 1000 });
    const executor = vi.fn().mockResolvedValue(undefined);

    q.enqueue(makeWrite());
    q.start(executor);

    await vi.advanceTimersByTimeAsync(1000);
    expect(executor).toHaveBeenCalledTimes(1);
    expect(q.getStats().queued).toBe(0);

    await q.stop();
    vi.useRealTimers();
  });

  it("stats reporting", () => {
    const q = new PendingWriteQueue({ maxSize: 50 });
    q.enqueue(makeWrite());
    q.enqueue(makeWrite());

    const stats = q.getStats();
    expect(stats.queued).toBe(2);
    expect(stats.maxSize).toBe(50);
  });

  it("increments attempt count on drain", async () => {
    const q = new PendingWriteQueue();
    const w = makeWrite();
    q.enqueue(w);

    // First drain fails
    const failExecutor = vi.fn().mockRejectedValue(new Error("fail"));
    q.start(failExecutor);
    await q.drain();
    expect(q.getQueue()[0].attempts).toBe(1);

    // Second drain succeeds
    const okExecutor = vi.fn().mockResolvedValue(undefined);
    q.start(okExecutor);
    await q.drain();
    expect(q.getStats().queued).toBe(0);
    await q.stop();
  });
});

describe("PendingWriteQueue disk persistence", () => {
  const tmpPath = join(tmpdir(), `pending-writes-test-${Date.now()}.json`);

  afterEach(async () => {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore
    }
  });

  it("persists on stop and loads on start", async () => {
    const q1 = new PendingWriteQueue({ persistPath: tmpPath });
    q1.enqueue(makeWrite());
    q1.enqueue(makeWrite());
    q1.start(vi.fn());
    await q1.stop();

    // Verify file was written
    const data = JSON.parse(await readFile(tmpPath, "utf-8"));
    expect(data).toHaveLength(2);

    // Load into new queue
    const q2 = new PendingWriteQueue({ persistPath: tmpPath });
    const loaded = await q2.loadFromDisk();
    expect(loaded).toBe(2);
    expect(q2.getStats().queued).toBe(2);
  });

  it("loadFromDisk returns 0 when file does not exist", async () => {
    const q = new PendingWriteQueue({ persistPath: "/tmp/nonexistent-file-xxx.json" });
    const loaded = await q.loadFromDisk();
    expect(loaded).toBe(0);
  });
});

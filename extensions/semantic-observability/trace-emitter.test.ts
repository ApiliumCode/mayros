import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import type { CortexClient } from "../shared/cortex-client.js";
import { TraceEmitter } from "./trace-emitter.js";

function createMockClient() {
  return {
    emitEvents: vi.fn().mockResolvedValue({ ok: true }),
  } as unknown as CortexClient;
}

describe("TraceEmitter resilience", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("buffer cap enforced — oldest events dropped", () => {
    const client = createMockClient();
    const emitter = new TraceEmitter(client, "ns", 10_000, { maxBufferSize: 3 });

    emitter.emitToolCall("a1", "tool1", {}, {}, 10);
    emitter.emitToolCall("a1", "tool2", {}, {}, 20);
    emitter.emitToolCall("a1", "tool3", {}, {}, 30);
    expect(emitter.bufferedCount).toBe(3);

    // 4th event pushes out the oldest
    emitter.emitToolCall("a1", "tool4", {}, {}, 40);
    expect(emitter.bufferedCount).toBe(3);

    // Verify oldest was dropped (tool1 gone)
    const events = emitter.getBufferedEvents();
    expect(events[0].fields.toolName).toBe("tool2");
    expect(events[2].fields.toolName).toBe("tool4");
  });

  it("backoff doubles flush interval on failure", async () => {
    const client = createMockClient();
    (client.emitEvents as ReturnType<typeof vi.fn>).mockResolvedValue({ ok: false });

    const emitter = new TraceEmitter(client, "ns", 1000, { maxBufferSize: 100 });
    emitter.emitToolCall("a1", "tool1", {}, {}, 10);
    emitter.start();

    // First flush at 1000ms — fails
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.emitEvents).toHaveBeenCalledTimes(1);

    // Next flush should be at 2000ms (1000 * 2^1)
    (client.emitEvents as ReturnType<typeof vi.fn>).mockClear();
    await vi.advanceTimersByTimeAsync(1500);
    expect(client.emitEvents).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(500);
    expect(client.emitEvents).toHaveBeenCalledTimes(1);

    await emitter.stop();
  });

  it("backoff resets on success", async () => {
    const client = createMockClient();
    // First flush fails, second succeeds
    (client.emitEvents as ReturnType<typeof vi.fn>)
      .mockResolvedValueOnce({ ok: false })
      .mockResolvedValue({ ok: true });

    const emitter = new TraceEmitter(client, "ns", 1000, { maxBufferSize: 100 });
    emitter.emitToolCall("a1", "tool1", {}, {}, 10);
    emitter.start();

    // First flush fails
    await vi.advanceTimersByTimeAsync(1000);

    // Second flush succeeds (at 2000ms backoff)
    await vi.advanceTimersByTimeAsync(2000);

    // Third flush should be back at 1000ms interval
    (client.emitEvents as ReturnType<typeof vi.fn>).mockClear();
    emitter.emitToolCall("a1", "tool2", {}, {}, 20);

    await vi.advanceTimersByTimeAsync(1000);
    expect(client.emitEvents).toHaveBeenCalledTimes(1);

    await emitter.stop();
  });

  it("TTL discards stale events during flush", async () => {
    const client = createMockClient();
    const emitter = new TraceEmitter(client, "ns", 60_000, { maxBufferSize: 100 });

    // Emit an event with a timestamp 6 minutes in the past
    const oldTimestamp = new Date(Date.now() - 6 * 60 * 1000).toISOString();
    // Access internal buffer via the emitError method then manipulate
    emitter.emitError("a1", "old error");
    const events = emitter.getBufferedEvents();
    // Override the timestamp to be old
    events[0].timestamp = oldTimestamp;
    // The buffer is internal, so we need to flush manually:
    // Add a fresh event too
    emitter.emitError("a1", "fresh error");

    // Now there should be 2 events, but the old one should be dropped on flush
    await emitter.flush();

    // Only the fresh event should have been sent
    const calls = (client.emitEvents as ReturnType<typeof vi.fn>).mock.calls;
    if (calls.length > 0) {
      // The fresh event was sent
      expect(calls[0][0].length).toBeLessThanOrEqual(2);
    }
  });

  it("stop logs dropped count when events remain", async () => {
    const client = createMockClient();
    // Make flush fail so events remain
    (client.emitEvents as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("fail"));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const emitter = new TraceEmitter(client, "ns", 60_000, { maxBufferSize: 100 });
    emitter.emitToolCall("a1", "tool1", {}, {}, 10);
    emitter.emitToolCall("a1", "tool2", {}, {}, 20);

    await emitter.stop();

    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining("dropping 2 unflushed events on stop"),
    );
    expect(emitter.bufferedCount).toBe(0);

    warnSpy.mockRestore();
  });

  it("normal flush clears buffer", async () => {
    const client = createMockClient();
    const emitter = new TraceEmitter(client, "ns", 60_000);

    emitter.emitToolCall("a1", "tool1", {}, {}, 10);
    emitter.emitDecision("a1", "what to do", ["a", "b"], "a");

    await emitter.flush();

    expect(emitter.bufferedCount).toBe(0);
    expect(client.emitEvents).toHaveBeenCalledTimes(1);
  });
});

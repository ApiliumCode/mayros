import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createEvent, createBatch, type AnalyticsEvent } from "./event-schema.js";
import { EventQueue, anonymize } from "./event-queue.js";
import { parseAnalyticsConfig, isAnalyticsEnabled } from "./config.js";

// ============================================================================
// Event Schema
// ============================================================================

describe("createEvent", () => {
  // 1
  it("creates event with required fields", () => {
    const event = createEvent("command", "execute");
    expect(event.id).toMatch(/^[0-9a-f-]+$/);
    expect(event.category).toBe("command");
    expect(event.action).toBe("execute");
    expect(event.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  // 2
  it("includes optional fields when provided", () => {
    const event = createEvent("tool", "call", {
      label: "code_read",
      value: 150,
      sessionId: "sess-123",
      attributes: { success: true },
    });
    expect(event.label).toBe("code_read");
    expect(event.value).toBe(150);
    expect(event.sessionId).toBe("sess-123");
    expect(event.attributes?.success).toBe(true);
  });

  // 3
  it("generates unique IDs", () => {
    const e1 = createEvent("session", "start");
    const e2 = createEvent("session", "start");
    expect(e1.id).not.toBe(e2.id);
  });
});

describe("createBatch", () => {
  // 4
  it("creates batch with metadata", () => {
    const events = [createEvent("session", "start")];
    const batch = createBatch(events, "0.1.0");
    expect(batch.clientVersion).toBe("0.1.0");
    expect(batch.platform).toBe(process.platform);
    expect(batch.nodeVersion).toBe(process.version);
    expect(batch.events).toHaveLength(1);
    expect(batch.batchedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

// ============================================================================
// EventQueue
// ============================================================================

describe("EventQueue", () => {
  // 5
  it("enqueues events", () => {
    const queue = new EventQueue();
    queue.enqueue(createEvent("command", "execute"));
    expect(queue.getBufferSize()).toBe(1);
  });

  // 6
  it("flushes events via callback", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new EventQueue({ onFlush });
    queue.enqueue(createEvent("command", "execute"));
    queue.enqueue(createEvent("tool", "call"));
    await queue.flush();
    expect(onFlush).toHaveBeenCalledOnce();
    expect(onFlush.mock.calls[0][0].events).toHaveLength(2);
    expect(queue.getBufferSize()).toBe(0);
  });

  // 7
  it("does not flush empty buffer", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new EventQueue({ onFlush });
    await queue.flush();
    expect(onFlush).not.toHaveBeenCalled();
  });

  // 8
  it("re-buffers events on flush failure", async () => {
    const onFlush = vi.fn().mockRejectedValue(new Error("network error"));
    const queue = new EventQueue({ onFlush });
    queue.enqueue(createEvent("command", "execute"));
    await queue.flush();
    expect(queue.getBufferSize()).toBe(1);
    expect(queue.getFailureCount()).toBe(1);
  });

  // 9
  it("drops stale events on flush", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new EventQueue({ onFlush, eventTtlMs: 100 });
    const old: AnalyticsEvent = {
      ...createEvent("command", "old"),
      timestamp: new Date(Date.now() - 200).toISOString(),
    };
    queue.enqueue(old);
    await queue.flush();
    expect(onFlush).not.toHaveBeenCalled(); // All events were stale
  });

  // 10
  it("force-flushes at max buffer size", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new EventQueue({ onFlush, maxBufferSize: 3 });
    queue.enqueue(createEvent("command", "1"));
    queue.enqueue(createEvent("tool", "2"));
    // Wait for potential async flush trigger
    await new Promise((r) => setTimeout(r, 10));
    queue.enqueue(createEvent("session", "3")); // This triggers force-flush
    await new Promise((r) => setTimeout(r, 10));
    expect(onFlush).toHaveBeenCalled();
  });

  // 11
  it("stop flushes remaining events", async () => {
    const onFlush = vi.fn().mockResolvedValue(undefined);
    const queue = new EventQueue({ onFlush });
    queue.start();
    queue.enqueue(createEvent("session", "end"));
    await queue.stop();
    expect(onFlush).toHaveBeenCalled();
    expect(queue.getBufferSize()).toBe(0);
  });

  // 12
  it("does not enqueue after stop", async () => {
    const queue = new EventQueue();
    await queue.stop();
    queue.enqueue(createEvent("command", "late"));
    expect(queue.getBufferSize()).toBe(0);
  });
});

// ============================================================================
// anonymize
// ============================================================================

describe("anonymize", () => {
  // 13
  it("returns hex string of length 16", () => {
    const result = anonymize("test-session-id");
    expect(result).toMatch(/^[0-9a-f]{16}$/);
  });

  // 14
  it("is deterministic", () => {
    expect(anonymize("same")).toBe(anonymize("same"));
  });

  // 15
  it("differs for different inputs", () => {
    expect(anonymize("a")).not.toBe(anonymize("b"));
  });
});

// ============================================================================
// Config
// ============================================================================

describe("parseAnalyticsConfig", () => {
  // 16
  it("defaults to disabled", () => {
    const cfg = parseAnalyticsConfig({});
    expect(cfg.enabled).toBe(false);
    expect(cfg.privacyMode).toBe("anonymous");
  });

  // 17
  it("parses full config", () => {
    const cfg = parseAnalyticsConfig({
      enabled: true,
      privacyMode: "identified",
      maxBufferSize: 1000,
      flushIntervalMs: 60_000,
      eventTtlMs: 7_200_000,
    });
    expect(cfg.enabled).toBe(true);
    expect(cfg.privacyMode).toBe("identified");
    expect(cfg.maxBufferSize).toBe(1000);
    expect(cfg.flushIntervalMs).toBe(60_000);
  });

  // 18
  it("rejects unknown keys", () => {
    expect(() => parseAnalyticsConfig({ badKey: true })).toThrow("unknown keys");
  });

  // 19
  it("clamps maxBufferSize to 10000", () => {
    const cfg = parseAnalyticsConfig({ maxBufferSize: 99999 });
    expect(cfg.maxBufferSize).toBe(10_000);
  });

  // 20
  it("handles null/undefined gracefully", () => {
    const cfg = parseAnalyticsConfig(null);
    expect(cfg.enabled).toBe(false);
    expect(cfg.privacyMode).toBe("anonymous");
  });
});

describe("isAnalyticsEnabled", () => {
  // 21
  it("returns false when disabled", () => {
    expect(isAnalyticsEnabled(parseAnalyticsConfig({}))).toBe(false);
  });

  // 22
  it("returns true when enabled with anonymous mode", () => {
    expect(isAnalyticsEnabled(parseAnalyticsConfig({ enabled: true }))).toBe(true);
  });

  // 23
  it("returns false when privacyMode is off", () => {
    expect(isAnalyticsEnabled(parseAnalyticsConfig({ enabled: true, privacyMode: "off" }))).toBe(
      false,
    );
  });
});

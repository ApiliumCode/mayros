import { describe, it, expect, beforeEach } from "vitest";
import { McpMetricsCollector } from "./metrics-collector.js";

describe("McpMetricsCollector", () => {
  let collector: McpMetricsCollector;

  beforeEach(() => {
    collector = new McpMetricsCollector();
  });

  it("starts with empty snapshot", () => {
    const snap = collector.snapshot();
    expect(snap.totalCalls).toBe(0);
    expect(snap.totalErrors).toBe(0);
    expect(snap.tools).toEqual([]);
    expect(snap.recentCalls).toEqual([]);
    expect(snap.startedAt).toBeGreaterThan(0);
  });

  it("records a successful call", () => {
    collector.recordCall("mayros_recall", 42, false);
    const snap = collector.snapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.totalErrors).toBe(0);
    expect(snap.tools).toHaveLength(1);
    expect(snap.tools[0].toolName).toBe("mayros_recall");
    expect(snap.tools[0].callCount).toBe(1);
    expect(snap.tools[0].errorCount).toBe(0);
    expect(snap.tools[0].totalDurationMs).toBe(42);
    expect(snap.recentCalls).toHaveLength(1);
    expect(snap.recentCalls[0].status).toBe("ok");
  });

  it("records an error call", () => {
    collector.recordCall("mayros_recall", 100, true);
    const snap = collector.snapshot();
    expect(snap.totalCalls).toBe(1);
    expect(snap.totalErrors).toBe(1);
    expect(snap.tools[0].errorCount).toBe(1);
    expect(snap.recentCalls[0].status).toBe("error");
  });

  it("aggregates per-tool metrics across multiple calls", () => {
    collector.recordCall("toolA", 10, false);
    collector.recordCall("toolA", 20, true);
    collector.recordCall("toolB", 5, false);
    const snap = collector.snapshot();
    expect(snap.totalCalls).toBe(3);
    expect(snap.totalErrors).toBe(1);
    expect(snap.tools).toHaveLength(2);

    const toolA = snap.tools.find((t) => t.toolName === "toolA");
    expect(toolA?.callCount).toBe(2);
    expect(toolA?.errorCount).toBe(1);
    expect(toolA?.totalDurationMs).toBe(30);
  });

  it("returns recent calls newest-first", () => {
    collector.recordCall("a", 1, false);
    collector.recordCall("b", 2, false);
    collector.recordCall("c", 3, false);
    const snap = collector.snapshot();
    expect(snap.recentCalls).toHaveLength(3);
    expect(snap.recentCalls[0].toolName).toBe("c");
    expect(snap.recentCalls[1].toolName).toBe("b");
    expect(snap.recentCalls[2].toolName).toBe("a");
  });

  it("ring buffer wraps at 100 entries", () => {
    for (let i = 0; i < 120; i++) {
      collector.recordCall(`tool-${i}`, i, false);
    }
    const snap = collector.snapshot();
    expect(snap.recentCalls).toHaveLength(100);
    expect(snap.totalCalls).toBe(120);
    // The most recent should be tool-119
    expect(snap.recentCalls[0].toolName).toBe("tool-119");
    // The oldest in the buffer should be tool-20
    expect(snap.recentCalls[99].toolName).toBe("tool-20");
  });

  it("truncates params beyond 200 chars", () => {
    const longParams = "x".repeat(300);
    collector.recordCall("toolA", 10, false, longParams);
    const snap = collector.snapshot();
    const params = snap.recentCalls[0].params;
    expect(params).toBeDefined();
    expect(params!.length).toBe(203); // 200 + "..."
    expect(params!.endsWith("...")).toBe(true);
  });

  it("stores short params as-is", () => {
    collector.recordCall("toolA", 10, false, '{"key":"val"}');
    const snap = collector.snapshot();
    expect(snap.recentCalls[0].params).toBe('{"key":"val"}');
  });

  it("reset clears all metrics", () => {
    collector.recordCall("a", 1, false);
    collector.recordCall("b", 2, true);
    collector.reset();
    const snap = collector.snapshot();
    expect(snap.totalCalls).toBe(0);
    expect(snap.totalErrors).toBe(0);
    expect(snap.tools).toEqual([]);
    expect(snap.recentCalls).toEqual([]);
  });
});

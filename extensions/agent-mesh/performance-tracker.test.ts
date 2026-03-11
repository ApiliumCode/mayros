import { describe, it, expect } from "vitest";
import { PerformanceTracker } from "./performance-tracker.js";

describe("PerformanceTracker", () => {
  it("starts with no records", async () => {
    const tracker = new PerformanceTracker(null, "test");
    const record = await tracker.getPerformance("agent-a");
    expect(record).toBeNull();
  });

  it("getScore returns 0.5 for unknown agent", async () => {
    const tracker = new PerformanceTracker(null, "test");
    const score = await tracker.getScore("unknown");
    expect(score).toBe(0.5);
  });

  it("records outcome and updates EMA", async () => {
    const tracker = new PerformanceTracker(null, "test");

    // Record a successful outcome
    await tracker.recordOutcome({
      agentId: "agent-a",
      completed: true,
      durationMs: 5000,
      costUsd: 0.01,
      findings: 3,
      conflicts: 0,
    });

    const record = await tracker.getPerformance("agent-a");
    expect(record).not.toBeNull();
    expect(record!.totalTasks).toBe(1);
    expect(record!.completedTasks).toBe(1);
    expect(record!.scoreEma).toBeGreaterThan(0.5); // EMA moved up from success
  });

  it("EMA decreases on failure", async () => {
    const tracker = new PerformanceTracker(null, "test");

    // Record a failed outcome
    await tracker.recordOutcome({
      agentId: "agent-b",
      completed: false,
      durationMs: 30000,
      costUsd: 0.05,
      findings: 0,
      conflicts: 2,
    });

    const record = await tracker.getPerformance("agent-b");
    expect(record!.scoreEma).toBeLessThan(0.5); // EMA moved down from failure
  });

  it("tracks multiple outcomes for same agent", async () => {
    const tracker = new PerformanceTracker(null, "test");

    for (let i = 0; i < 5; i++) {
      await tracker.recordOutcome({
        agentId: "agent-c",
        completed: true,
        durationMs: 3000 + i * 1000,
        costUsd: 0.01,
        findings: 2,
        conflicts: 0,
      });
    }

    const record = await tracker.getPerformance("agent-c");
    expect(record!.totalTasks).toBe(5);
    expect(record!.completedTasks).toBe(5);
    expect(record!.avgDurationMs).toBeGreaterThan(3000);
  });

  it("getAllCached returns all tracked agents", async () => {
    const tracker = new PerformanceTracker(null, "test");

    await tracker.recordOutcome({
      agentId: "a1",
      completed: true,
      durationMs: 1000,
      costUsd: 0,
      findings: 0,
      conflicts: 0,
    });
    await tracker.recordOutcome({
      agentId: "a2",
      completed: true,
      durationMs: 1000,
      costUsd: 0,
      findings: 0,
      conflicts: 0,
    });

    const all = tracker.getAllCached();
    expect(all.length).toBe(2);
  });
});

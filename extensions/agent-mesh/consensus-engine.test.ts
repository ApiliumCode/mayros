import { describe, it, expect } from "vitest";
import { ConsensusEngine } from "./consensus-engine.js";
import { PerformanceTracker } from "./performance-tracker.js";
import type { Conflict } from "./mesh-protocol.js";

const perfTracker = new PerformanceTracker(null, "test");

describe("ConsensusEngine", () => {
  const conflicts: Conflict[] = [
    {
      subject: "test:entity",
      predicate: "test:status",
      values: ["active", "inactive", "active"],
      namespaces: ["ns-a", "ns-b", "ns-c"],
    },
  ];

  it("majority vote picks most common value", async () => {
    const engine = new ConsensusEngine(null, "test", perfTracker);

    const result = await engine.resolve({
      id: "test-1",
      conflicts,
      agentIds: ["agent-a", "agent-b", "agent-c"],
      strategy: "majority",
    });

    expect(result.resolved).toBe(true);
    expect(result.resolutions[0]!.resolvedValue).toBe("active"); // 2 vs 1
  });

  it("weighted vote uses agent scores", async () => {
    // Set up different scores
    await perfTracker.recordOutcome({
      agentId: "agent-a",
      completed: true,
      durationMs: 1000,
      costUsd: 0,
      findings: 10,
      conflicts: 0,
    });

    const engine = new ConsensusEngine(null, "test", perfTracker);

    const result = await engine.resolve({
      id: "test-2",
      conflicts: [
        {
          subject: "test:entity",
          predicate: "test:value",
          values: ["x", "y"],
          namespaces: ["ns-a", "ns-b"],
        },
      ],
      agentIds: ["agent-a", "agent-b"],
      strategy: "weighted",
    });

    expect(result.resolved).toBe(true);
    expect(result.strategy).toBe("weighted");
    expect(result.resolutions.length).toBe(1);
  });

  it("resolvePhaseConflicts returns empty for no conflicts", async () => {
    const engine = new ConsensusEngine(null, "test", perfTracker);
    const results = await engine.resolvePhaseConflicts([], {}, "majority");
    expect(results.length).toBe(0);
  });

  it("resolvePhaseConflicts processes conflicts", async () => {
    const engine = new ConsensusEngine(null, "test", perfTracker);
    const results = await engine.resolvePhaseConflicts(
      conflicts,
      { "ns-a": "agent-a", "ns-b": "agent-b" },
      "weighted",
    );

    expect(results.length).toBe(1);
    expect(results[0]!.breakdown.totalConflicts).toBe(1);
  });

  it("arbitrate falls back to weighted when no LLM", async () => {
    const engine = new ConsensusEngine(null, "test", perfTracker);

    const result = await engine.resolve({
      id: "test-3",
      conflicts,
      agentIds: ["agent-a", "agent-b", "agent-c"],
      strategy: "arbitrate",
    });

    // Without LLM, should still resolve via weighted fallback
    expect(result.resolved).toBe(true);
  });
});

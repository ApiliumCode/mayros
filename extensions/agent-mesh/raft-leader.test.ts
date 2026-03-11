import { describe, it, expect } from "vitest";
import { RaftLeader } from "./raft-leader.js";
import { PerformanceTracker } from "./performance-tracker.js";

const perfTracker = new PerformanceTracker(null, "test");

describe("RaftLeader", () => {
  it("elects leader with highest EMA score", async () => {
    // Give agent-a a high score
    await perfTracker.recordOutcome({
      agentId: "agent-a",
      completed: true,
      durationMs: 1000,
      costUsd: 0,
      findings: 10,
      conflicts: 0,
    });

    const raft = new RaftLeader(perfTracker);
    const result = await raft.electLeader(["agent-a", "agent-b", "agent-c"]);

    expect(result.leaderId).toBe("agent-a");
    expect(result.leaderScore).toBeGreaterThan(0.5);
    expect(result.candidates.length).toBe(3);
    expect(result.term).toBe(1);
  });

  it("increments term on each election", async () => {
    const raft = new RaftLeader(perfTracker);
    await raft.electLeader(["agent-a", "agent-b"]);
    expect(raft.getCurrentTerm()).toBe(1);

    await raft.electLeader(["agent-a", "agent-b"]);
    expect(raft.getCurrentTerm()).toBe(2);
  });

  it("excludes agent from re-election", async () => {
    const raft = new RaftLeader(perfTracker);
    const result = await raft.reElect(["agent-a", "agent-b", "agent-c"], "agent-a");

    expect(result.leaderId).not.toBe("agent-a");
    expect(result.candidates.every((c) => c.agentId !== "agent-a")).toBe(true);
  });

  it("proposes resolution with majority confirmation", async () => {
    const raft = new RaftLeader(perfTracker);
    await raft.electLeader(["agent-a", "agent-b", "agent-c"]);

    const result = await raft.proposeResolution({
      leaderId: "agent-a",
      value: "yes",
      followerIds: ["agent-b", "agent-c"],
      followerValues: { "agent-b": "yes", "agent-c": "no" },
    });

    // Leader (yes) + agent-b (yes) = 2 out of 3, majority
    expect(result.success).toBe(true);
    expect(result.confirmations).toBe(2);
    expect(result.required).toBe(2);
  });

  it("fails resolution without majority", async () => {
    const raft = new RaftLeader(perfTracker);
    await raft.electLeader(["a", "b", "c", "d", "e"]);

    const result = await raft.proposeResolution({
      leaderId: "a",
      value: "yes",
      followerIds: ["b", "c", "d", "e"],
      followerValues: { b: "no", c: "no", d: "no", e: "no" },
    });

    // Only leader confirms = 1 out of 5, need 3
    expect(result.success).toBe(false);
    expect(result.confirmations).toBe(1);
  });

  it("throws with no agents", async () => {
    const raft = new RaftLeader(perfTracker);
    await expect(raft.electLeader([])).rejects.toThrow("No agents");
  });
});

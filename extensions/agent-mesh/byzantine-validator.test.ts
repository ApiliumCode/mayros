import { describe, it, expect } from "vitest";
import { ByzantineValidator } from "./byzantine-validator.js";

describe("ByzantineValidator", () => {
  it("requires at least 4 agents for byzantine consensus", () => {
    const bv = new ByzantineValidator();
    expect(bv.canRunByzantine(3)).toBe(false);
    expect(bv.canRunByzantine(4)).toBe(true);
    expect(bv.canRunByzantine(7)).toBe(true);
  });

  it("generates session keys and signs votes", () => {
    const bv = new ByzantineValidator();
    const key = bv.generateSessionKey("agent-a");
    expect(key.agentId).toBe("agent-a");
    expect(key.key.length).toBe(32);

    const vote = bv.signVote("agent-a", "value-x");
    expect(vote.agentId).toBe("agent-a");
    expect(vote.value).toBe("value-x");
    expect(vote.signature).toBeTruthy();
  });

  it("verifies valid votes", () => {
    const bv = new ByzantineValidator();
    bv.generateSessionKey("agent-a");
    const vote = bv.signVote("agent-a", "value-x");
    expect(bv.verifyVote(vote)).toBe(true);
  });

  it("rejects tampered votes", () => {
    const bv = new ByzantineValidator();
    bv.generateSessionKey("agent-a");
    const vote = bv.signVote("agent-a", "value-x");
    vote.value = "tampered";
    expect(bv.verifyVote(vote)).toBe(false);
  });

  it("rejects votes from unknown agents", () => {
    const bv = new ByzantineValidator();
    const vote = {
      agentId: "unknown",
      value: "x",
      timestamp: Date.now(),
      signature: "fake",
    };
    expect(bv.verifyVote(vote)).toBe(false);
  });

  it("computes quorum correctly", () => {
    const bv = new ByzantineValidator();
    // n=4: f=1, need 2f+1=3
    const q4 = bv.checkQuorum(4, 3);
    expect(q4.reached).toBe(true);
    expect(q4.faultTolerance).toBe(1);
    expect(q4.requiredCount).toBe(3);

    // n=4, only 2 agree
    const q4low = bv.checkQuorum(4, 2);
    expect(q4low.reached).toBe(false);

    // n=7: f=2, need 2f+1=5
    const q7 = bv.checkQuorum(7, 5);
    expect(q7.reached).toBe(true);
    expect(q7.faultTolerance).toBe(2);
  });

  it("runs PBFT successfully with 4 agents agreeing", async () => {
    const bv = new ByzantineValidator();
    const result = await bv.runPBFT({
      agentIds: ["a", "b", "c", "d"],
      values: ["yes", "yes", "yes", "no"],
      agentValues: { a: "yes", b: "yes", c: "yes", d: "no" },
    });

    expect(result.success).toBe(true);
    expect(result.resolvedValue).toBe("yes");
    expect(result.phase).toBe("complete");
  });

  it("fails PBFT when insufficient agents", async () => {
    const bv = new ByzantineValidator();
    const result = await bv.runPBFT({
      agentIds: ["a", "b", "c"],
      values: ["yes", "no", "maybe"],
      agentValues: { a: "yes", b: "no", c: "maybe" },
    });

    expect(result.success).toBe(false);
  });

  it("clears session keys", () => {
    const bv = new ByzantineValidator();
    bv.generateSessionKey("agent-a");
    const vote = bv.signVote("agent-a", "x");
    expect(bv.verifyVote(vote)).toBe(true);

    bv.clearKeys();
    expect(bv.verifyVote(vote)).toBe(false);
  });

  // --- Timing-safe HMAC comparison tests ---

  it("rejects a tampered signature of the same length", () => {
    const bv = new ByzantineValidator();
    bv.generateSessionKey("agent-a");
    const vote = bv.signVote("agent-a", "value-x");

    // Flip last hex char to produce a same-length but different signature
    const lastChar = vote.signature[vote.signature.length - 1];
    const flipped = lastChar === "0" ? "1" : "0";
    vote.signature = vote.signature.slice(0, vote.signature.length - 1) + flipped;

    expect(bv.verifyVote(vote)).toBe(false);
  });

  it("rejects a signature of different length", () => {
    const bv = new ByzantineValidator();
    bv.generateSessionKey("agent-a");
    const vote = bv.signVote("agent-a", "value-x");

    // Truncate signature to make it shorter
    vote.signature = vote.signature.slice(0, 8);
    expect(bv.verifyVote(vote)).toBe(false);
  });

  it("still accepts valid signatures after timing-safe fix", () => {
    const bv = new ByzantineValidator();
    bv.generateSessionKey("agent-b");
    const vote = bv.signVote("agent-b", "some-value");
    expect(bv.verifyVote(vote)).toBe(true);
  });
});

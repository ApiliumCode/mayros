import { describe, it, expect } from "vitest";
import { QTable, stateKey, computeReward, type QState, type RewardSignal } from "./q-learning.js";

describe("stateKey", () => {
  it("builds correct key from state", () => {
    const state: QState = { taskType: "code", budgetLevel: "mid", timeSlot: "peak" };
    expect(stateKey(state)).toBe("code:mid:peak");
  });
});

describe("computeReward", () => {
  it("computes sum of all signal components", () => {
    const signal: RewardSignal = {
      success: 1.0,
      costEfficiency: 0.3,
      qualityProxy: 0.2,
      latencyPenalty: 0,
      rateLimitPenalty: 0,
    };
    expect(computeReward(signal)).toBeCloseTo(1.5);
  });

  it("handles negative penalties", () => {
    const signal: RewardSignal = {
      success: -1.0,
      costEfficiency: 0,
      qualityProxy: 0,
      latencyPenalty: -0.2,
      rateLimitPenalty: -0.8,
    };
    expect(computeReward(signal)).toBeCloseTo(-2.0);
  });
});

describe("QTable", () => {
  const config = {
    alpha: 0.1,
    gamma: 0.9,
    epsilon: 0.15,
    epsilonDecay: 0.995,
    minEpsilon: 0.05,
  };

  it("get/set Q-values", () => {
    const qt = new QTable(config);
    expect(qt.getQ("s1", "a1")).toBe(0);

    qt.setQ("s1", "a1", 1.5);
    expect(qt.getQ("s1", "a1")).toBe(1.5);
  });

  it("maxQ returns highest value for state", () => {
    const qt = new QTable(config);
    qt.setQ("s1", "a1", 0.5);
    qt.setQ("s1", "a2", 1.2);
    qt.setQ("s1", "a3", 0.8);

    expect(qt.maxQ("s1")).toBeCloseTo(1.2);
    expect(qt.maxQ("s_unknown")).toBe(0);
  });

  it("update applies Q-learning formula", () => {
    const qt = new QTable(config);
    qt.setQ("s1", "a1", 0.0);
    qt.setQ("s2", "a1", 1.0);

    // Q(s,a) += α(r + γ·max Q(s',a') - Q(s,a))
    // Q(s1,a1) += 0.1 * (0.5 + 0.9 * 1.0 - 0.0) = 0.1 * 1.4 = 0.14
    qt.update("s1", "a1", 0.5, "s2");
    expect(qt.getQ("s1", "a1")).toBeCloseTo(0.14);
  });

  it("epsilon decays after update", () => {
    const qt = new QTable({ ...config, epsilon: 0.5 });
    const before = qt.getEpsilon();
    qt.update("s1", "a1", 1.0, "s1");
    expect(qt.getEpsilon()).toBeLessThan(before);
  });

  it("epsilon floor is respected", () => {
    const qt = new QTable({ ...config, epsilon: 0.05, epsilonDecay: 0.5 });
    qt.update("s1", "a1", 1.0, "s1");
    expect(qt.getEpsilon()).toBeGreaterThanOrEqual(config.minEpsilon);
  });

  it("selectAction returns action from available list", () => {
    const qt = new QTable({ ...config, epsilon: 0 }); // no exploration
    qt.setQ("s1", "a1", 0.5);
    qt.setQ("s1", "a2", 1.5);

    const action = qt.selectAction("s1", ["a1", "a2", "a3"]);
    expect(action).toBe("a2"); // highest Q-value
  });

  it("selectAction returns null for empty actions", () => {
    const qt = new QTable(config);
    expect(qt.selectAction("s1", [])).toBeNull();
  });

  it("export/import roundtrip", () => {
    const qt = new QTable(config);
    qt.setQ("s1", "a1", 0.5);
    qt.setQ("s1", "a2", 1.0);
    qt.setQ("s2", "a1", 0.3);

    const exported = qt.export();
    expect(exported["s1"]?.["a1"]).toBeCloseTo(0.5);
    expect(exported["s1"]?.["a2"]).toBeCloseTo(1.0);

    const qt2 = new QTable(config);
    qt2.import(exported);
    expect(qt2.getQ("s1", "a1")).toBeCloseTo(0.5);
    expect(qt2.getQ("s2", "a1")).toBeCloseTo(0.3);
    expect(qt2.size()).toBe(3);
  });

  it("clear removes all entries", () => {
    const qt = new QTable(config);
    qt.setQ("s1", "a1", 1.0);
    expect(qt.size()).toBe(1);
    qt.clear();
    expect(qt.size()).toBe(0);
  });
});

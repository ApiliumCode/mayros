import { describe, it, expect } from "vitest";
import { LoopBreaker } from "./loop-breaker.js";
import type { TomeruConfig } from "./config.js";

function makeConfig(overrides?: Partial<TomeruConfig>): TomeruConfig {
  return {
    mode: "enforce",
    defaultLimit: { maxCallsPerWindow: 60, windowMs: 60000 },
    burstLimit: { maxCallsPerSecond: 10 },
    perToolLimits: {},
    loopBreaker: { enabled: true, maxIdenticalCalls: 5, maxTotalCallsPerMinute: 20 },
    exemptTools: [],
    ...overrides,
  };
}

describe("LoopBreaker", () => {
  it("allows non-repeated calls", () => {
    const lb = new LoopBreaker(makeConfig());
    const result = lb.checkBeforeCall("tool_a", { query: "hello" });
    expect(result.action).toBe("allow");
  });

  it("detects identical-call sequences", () => {
    const lb = new LoopBreaker(makeConfig());
    const params = { query: "same" };

    // Record 5 identical calls (matches limit of 5)
    for (let i = 0; i < 5; i++) {
      lb.recordAfterCall("tool_a", params, { result: "ok" });
    }

    // 6th call should be blocked (5 consecutive identical in buffer >= maxIdenticalCalls)
    const check = lb.checkBeforeCall("tool_a", params);
    expect(check.action).toBe("block");
    expect(check.message).toContain("Loop detected");
  });

  it("warns before blocking", () => {
    const lb = new LoopBreaker(makeConfig());
    const params = { query: "same" };

    // Record 2 calls (70% of 5 = 3.5, floor = 3)
    for (let i = 0; i < 3; i++) {
      lb.recordAfterCall("tool_a", params, { result: "ok" });
    }

    const check = lb.checkBeforeCall("tool_a", params);
    expect(check.action).toBe("warn");
    expect(check.message).toContain("Possible loop");
  });

  it("resets sequence when params change", () => {
    const lb = new LoopBreaker(makeConfig());

    for (let i = 0; i < 3; i++) {
      lb.recordAfterCall("tool_a", { q: "same" }, { r: "ok" });
    }

    // Different params break the sequence
    lb.recordAfterCall("tool_a", { q: "different" }, { r: "ok" });

    // This should be fine now (only 1 of "same" after the break)
    const check = lb.checkBeforeCall("tool_a", { q: "same" });
    expect(check.action).toBe("allow");
  });

  it("velocity circuit breaker", () => {
    const lb = new LoopBreaker(
      makeConfig({
        loopBreaker: { enabled: true, maxIdenticalCalls: 100, maxTotalCallsPerMinute: 5 },
      }),
    );

    // Make 5 unique calls
    for (let i = 0; i < 5; i++) {
      lb.checkBeforeCall(`tool_${i}`, { i });
      lb.recordAfterCall(`tool_${i}`, { i }, { ok: true });
    }

    // 6th call exceeds velocity limit
    const check = lb.checkBeforeCall("tool_extra", { extra: true });
    expect(check.action).toBe("block");
    expect(check.message).toContain("Velocity circuit breaker");
  });

  it("disabled loop breaker allows everything", () => {
    const lb = new LoopBreaker(
      makeConfig({
        loopBreaker: { enabled: false, maxIdenticalCalls: 1, maxTotalCallsPerMinute: 1 },
      }),
    );

    for (let i = 0; i < 10; i++) {
      lb.recordAfterCall("tool", { same: true }, { same: true });
    }

    const check = lb.checkBeforeCall("tool", { same: true });
    expect(check.action).toBe("allow");
  });

  it("same-result detection", () => {
    const lb = new LoopBreaker(makeConfig());

    // Record multiple calls with identical results
    for (let i = 0; i < 5; i++) {
      lb.recordAfterCall("tool_b", { query: `q${i}` }, { result: "same" });
    }

    const check = lb.checkSameResult("tool_b");
    expect(check.action).toBe("block");
    expect(check.message).toContain("Same-result loop");
  });

  it("getStats returns buffer info", () => {
    const lb = new LoopBreaker(makeConfig());
    lb.recordAfterCall("tool", {}, {});
    lb.recordAfterCall("tool", {}, {});

    const stats = lb.getStats();
    expect(stats.bufferSize).toBe(2);
  });

  it("reset clears state", () => {
    const lb = new LoopBreaker(makeConfig());
    lb.recordAfterCall("tool", {}, {});
    lb.reset();
    expect(lb.getStats().bufferSize).toBe(0);
  });
});

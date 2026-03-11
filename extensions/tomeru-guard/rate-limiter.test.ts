import { describe, it, expect } from "vitest";
import { ToolRateLimiter } from "./rate-limiter.js";
import type { TomeruConfig } from "./config.js";

function makeConfig(overrides?: Partial<TomeruConfig>): TomeruConfig {
  return {
    mode: "enforce",
    defaultLimit: { maxCallsPerWindow: 5, windowMs: 1000 },
    burstLimit: { maxCallsPerSecond: 10 },
    perToolLimits: {},
    loopBreaker: { enabled: false, maxIdenticalCalls: 15, maxTotalCallsPerMinute: 120 },
    exemptTools: [],
    ...overrides,
  };
}

describe("ToolRateLimiter", () => {
  it("allows calls within limit", () => {
    const limiter = new ToolRateLimiter(makeConfig());
    for (let i = 0; i < 5; i++) {
      const check = limiter.check("test_tool");
      expect(check.allowed).toBe(true);
      limiter.record("test_tool");
    }
  });

  it("rejects calls exceeding window limit", () => {
    const limiter = new ToolRateLimiter(makeConfig());
    for (let i = 0; i < 5; i++) {
      limiter.check("test_tool");
      limiter.record("test_tool");
    }

    const check = limiter.check("test_tool");
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Rate limit");
    expect(check.retryAfterMs).toBeGreaterThanOrEqual(0);
  });

  it("respects per-tool limits", () => {
    const limiter = new ToolRateLimiter(
      makeConfig({
        perToolLimits: {
          special_tool: { maxCallsPerWindow: 2, windowMs: 1000 },
        },
      }),
    );

    limiter.check("special_tool");
    limiter.record("special_tool");
    limiter.check("special_tool");
    limiter.record("special_tool");

    const check = limiter.check("special_tool");
    expect(check.allowed).toBe(false);

    // Default tool still has its own limit
    const defaultCheck = limiter.check("other_tool");
    expect(defaultCheck.allowed).toBe(true);
  });

  it("exempt tools always pass", () => {
    const limiter = new ToolRateLimiter(makeConfig({ exemptTools: ["safe_tool"] }));

    // Fill up the window
    for (let i = 0; i < 10; i++) {
      limiter.record("safe_tool");
    }

    const check = limiter.check("safe_tool");
    expect(check.allowed).toBe(true);
  });

  it("burst limit rejects rapid calls", () => {
    const limiter = new ToolRateLimiter(makeConfig({ burstLimit: { maxCallsPerSecond: 2 } }));

    limiter.check("t1");
    limiter.record("t1");
    limiter.check("t2");
    limiter.record("t2");

    // Third call within same instant should fail burst
    const check = limiter.check("t3");
    expect(check.allowed).toBe(false);
    expect(check.reason).toContain("Burst limit");
  });

  it("getStats tracks calls and rejections", () => {
    const limiter = new ToolRateLimiter(makeConfig());

    limiter.check("a");
    limiter.record("a");
    limiter.check("b");
    limiter.record("b");

    const stats = limiter.getStats();
    expect(stats.totalChecks).toBe(2);
    expect(stats.totalRejected).toBe(0);
    expect(stats.perTool["a"]?.calls).toBe(1);
  });

  it("reset clears all state", () => {
    const limiter = new ToolRateLimiter(makeConfig());

    for (let i = 0; i < 5; i++) {
      limiter.check("t");
      limiter.record("t");
    }

    limiter.reset();
    const check = limiter.check("t");
    expect(check.allowed).toBe(true);

    const stats = limiter.getStats();
    expect(stats.totalChecks).toBe(1);
  });
});

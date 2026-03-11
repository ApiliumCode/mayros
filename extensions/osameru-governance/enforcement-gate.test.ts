import { describe, it, expect } from "vitest";
import { EnforcementGate } from "./enforcement-gate.js";
import type { PolicyBundle } from "./policy-compiler.js";

function makeBundle(rules: PolicyBundle["rules"]): PolicyBundle {
  return {
    version: "1.0",
    compiledAt: new Date().toISOString(),
    rules,
    globalDefaults: { defaultAction: "allow" },
  };
}

describe("EnforcementGate", () => {
  it("allows by default when no rules match", () => {
    const gate = new EnforcementGate(makeBundle([]));
    const decision = gate.evaluate({ kind: "tool", toolName: "ls" });
    expect(decision.action).toBe("allow");
  });

  it("denies tool matching deny rule", () => {
    const gate = new EnforcementGate(
      makeBundle([
        {
          id: "r1",
          source: "test",
          category: "tool",
          action: "deny",
          toolPatterns: ["rm*"],
          priority: 100,
        },
      ]),
    );
    const decision = gate.evaluate({ kind: "tool", toolName: "rm" });
    expect(decision.action).toBe("deny");
  });

  it("matches wildcard patterns", () => {
    const gate = new EnforcementGate(
      makeBundle([
        {
          id: "r1",
          source: "test",
          category: "tool",
          action: "deny",
          toolPatterns: ["dangerous_*"],
          priority: 100,
        },
      ]),
    );
    expect(gate.evaluate({ kind: "tool", toolName: "dangerous_tool" }).action).toBe("deny");
    expect(gate.evaluate({ kind: "tool", toolName: "safe_tool" }).action).toBe("allow");
  });

  it("matches agent rules", () => {
    const gate = new EnforcementGate(
      makeBundle([
        {
          id: "r1",
          source: "test",
          category: "agent",
          action: "deny",
          agentIds: ["untrusted-*"],
          priority: 100,
        },
      ]),
    );
    expect(gate.evaluate({ kind: "agent", agentId: "untrusted-bot" }).action).toBe("deny");
    expect(gate.evaluate({ kind: "agent", agentId: "trusted-bot" }).action).toBe("allow");
  });

  it("higher priority rules are checked first", () => {
    const gate = new EnforcementGate(
      makeBundle([
        {
          id: "r1",
          source: "test",
          category: "tool",
          action: "allow",
          toolPatterns: ["rm"],
          priority: 10,
        },
        {
          id: "r2",
          source: "test",
          category: "tool",
          action: "deny",
          toolPatterns: ["rm"],
          priority: 100,
        },
      ]),
    );
    expect(gate.evaluate({ kind: "tool", toolName: "rm" }).action).toBe("deny");
  });
});

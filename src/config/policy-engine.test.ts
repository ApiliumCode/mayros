import { describe, it, expect } from "vitest";
import { PolicyEngine } from "./policy-engine.js";
import type { PolicyRule } from "./policy-engine.js";

const SAMPLE_POLICY = `
# Mayros Policy File

[rule.allow-read-tools]
description = "Allow read-only tools without confirmation"
action = allow
priority = 100
match.tool = code_read
match.tool = code_glob
match.tool = code_grep

[rule.deny-rm-rf]
description = "Block dangerous rm commands"
action = deny
priority = 200
match.command = rm -rf *

[rule.warn-env-files]
description = "Warn on .env file access"
action = warn
priority = 150
match.path = **/.env*

[rule.ask-shell]
description = "Ask before shell commands"
action = ask
priority = 50
match.tool = code_shell
`;

describe("PolicyEngine", () => {
  // 1
  it("parse() extracts rules from policy file content", () => {
    const rules = PolicyEngine.parse(SAMPLE_POLICY);
    expect(rules).toHaveLength(4);

    const ruleIds = rules.map((r) => r.id);
    expect(ruleIds).toContain("allow-read-tools");
    expect(ruleIds).toContain("deny-rm-rf");
    expect(ruleIds).toContain("warn-env-files");
    expect(ruleIds).toContain("ask-shell");
  });

  // 2
  it("parse() handles multiple matchers per rule", () => {
    const rules = PolicyEngine.parse(SAMPLE_POLICY);
    const readRule = rules.find((r) => r.id === "allow-read-tools");
    expect(readRule).toBeDefined();
    expect(readRule!.matchers).toHaveLength(3);
    expect(readRule!.matchers[0]).toEqual({ type: "tool", name: "code_read" });
    expect(readRule!.matchers[1]).toEqual({ type: "tool", name: "code_glob" });
    expect(readRule!.matchers[2]).toEqual({ type: "tool", name: "code_grep" });
  });

  // 3
  it("parse() ignores comments", () => {
    const content = `
# This is a comment
[rule.test-rule]
description = "A test rule"
action = deny
priority = 10
# Another comment
match.tool = dangerous_tool
`;
    const rules = PolicyEngine.parse(content);
    expect(rules).toHaveLength(1);
    expect(rules[0]!.id).toBe("test-rule");
    expect(rules[0]!.matchers).toHaveLength(1);
  });

  // 4
  it("evaluateToolCall matches exact tool name", () => {
    const engine = new PolicyEngine(PolicyEngine.parse(SAMPLE_POLICY));
    const result = engine.evaluateToolCall("code_read");
    expect(result.action).toBe("allow");
    expect(result.rule).not.toBeNull();
    expect(result.rule!.id).toBe("allow-read-tools");
  });

  // 5
  it("evaluateToolCall returns allow for non-matching", () => {
    const engine = new PolicyEngine(PolicyEngine.parse(SAMPLE_POLICY));
    const result = engine.evaluateToolCall("some_unknown_tool");
    expect(result.action).toBe("allow");
    expect(result.rule).toBeNull();
    expect(result.reason).toBe("no matching policy");
  });

  // 6
  it("evaluateCommand matches command pattern", () => {
    const engine = new PolicyEngine(PolicyEngine.parse(SAMPLE_POLICY));
    const result = engine.evaluateCommand("rm -rf /tmp/test");
    expect(result.action).toBe("deny");
    expect(result.rule!.id).toBe("deny-rm-rf");
  });

  // 7
  it("evaluateCommand with wildcard glob", () => {
    const rules: PolicyRule[] = [
      {
        id: "block-curl",
        description: "Block curl commands",
        action: "deny",
        priority: 100,
        matchers: [{ type: "command", pattern: "curl *" }],
      },
    ];
    const engine = new PolicyEngine(rules);
    const result = engine.evaluateCommand("curl https://example.com");
    expect(result.action).toBe("deny");
    expect(result.rule!.id).toBe("block-curl");
  });

  // 8
  it("evaluateFilePath matches glob pattern", () => {
    const engine = new PolicyEngine(PolicyEngine.parse(SAMPLE_POLICY));
    const result = engine.evaluateFilePath("src/.env.local");
    expect(result.action).toBe("warn");
    expect(result.rule!.id).toBe("warn-env-files");
  });

  // 9
  it("higher priority rules evaluated first", () => {
    const rules: PolicyRule[] = [
      {
        id: "low-priority",
        description: "Low priority allow",
        action: "allow",
        priority: 10,
        matchers: [{ type: "tool", name: "code_shell" }],
      },
      {
        id: "high-priority",
        description: "High priority deny",
        action: "deny",
        priority: 100,
        matchers: [{ type: "tool", name: "code_shell" }],
      },
    ];
    const engine = new PolicyEngine(rules);
    const result = engine.evaluateToolCall("code_shell");
    expect(result.action).toBe("deny");
    expect(result.rule!.id).toBe("high-priority");
  });

  // 10
  it("addRule and removeRule", () => {
    const engine = new PolicyEngine();
    const rule: PolicyRule = {
      id: "test-add",
      description: "Test adding",
      action: "warn",
      priority: 50,
      matchers: [{ type: "tool", name: "test_tool" }],
    };
    engine.addRule(rule);
    expect(engine.listRules()).toHaveLength(1);
    expect(engine.listRules()[0]!.id).toBe("test-add");

    const removed = engine.removeRule("test-add");
    expect(removed).toBe(true);
    expect(engine.listRules()).toHaveLength(0);

    const removedAgain = engine.removeRule("test-add");
    expect(removedAgain).toBe(false);
  });

  // 11
  it("listRules sorted by priority", () => {
    const rules: PolicyRule[] = [
      {
        id: "low",
        description: "Low",
        action: "allow",
        priority: 10,
        matchers: [{ type: "any" }],
      },
      {
        id: "high",
        description: "High",
        action: "deny",
        priority: 200,
        matchers: [{ type: "any" }],
      },
      {
        id: "medium",
        description: "Medium",
        action: "warn",
        priority: 100,
        matchers: [{ type: "any" }],
      },
    ];
    const engine = new PolicyEngine(rules);
    const sorted = engine.listRules();
    expect(sorted[0]!.id).toBe("high");
    expect(sorted[1]!.id).toBe("medium");
    expect(sorted[2]!.id).toBe("low");
  });

  // 12
  it("empty policy allows everything", () => {
    const engine = new PolicyEngine();
    expect(engine.evaluateToolCall("anything").action).toBe("allow");
    expect(engine.evaluateCommand("rm -rf /").action).toBe("allow");
    expect(engine.evaluateFilePath("/etc/passwd").action).toBe("allow");
  });
});

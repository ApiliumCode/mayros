import { describe, it, expect, vi } from "vitest";
import type { LlmHookDefinition } from "./hook-loader.js";
import { evaluateCondition, evaluateHook, type EvalContext } from "./llm-evaluator.js";

// ============================================================================
// Helper
// ============================================================================

function makeHook(overrides: Partial<LlmHookDefinition> = {}): LlmHookDefinition {
  return {
    name: "test-hook",
    description: "Test hook",
    events: ["before_tool_call"],
    timeoutMs: 5000,
    cache: "none",
    priority: 100,
    enabled: true,
    body: 'Analyze and respond with JSON: { "decision": "approve", "reason": "ok" }',
    sourcePath: "/test.md",
    origin: "project",
    ...overrides,
  };
}

// ============================================================================
// evaluateCondition
// ============================================================================

describe("evaluateCondition", () => {
  it("returns true for empty condition", () => {
    expect(evaluateCondition("", {})).toBe(true);
  });

  it("returns true for whitespace-only condition", () => {
    expect(evaluateCondition("   ", {})).toBe(true);
  });

  it("evaluates simple equality — true", () => {
    const ctx: EvalContext = { toolName: "exec" };
    expect(evaluateCondition('toolName == "exec"', ctx)).toBe(true);
  });

  it("evaluates simple equality — false", () => {
    const ctx: EvalContext = { toolName: "read" };
    expect(evaluateCondition('toolName == "exec"', ctx)).toBe(false);
  });

  it("evaluates inequality — true", () => {
    const ctx: EvalContext = { toolName: "read" };
    expect(evaluateCondition('toolName != "exec"', ctx)).toBe(true);
  });

  it("evaluates inequality — false", () => {
    const ctx: EvalContext = { toolName: "exec" };
    expect(evaluateCondition('toolName != "exec"', ctx)).toBe(false);
  });

  it("evaluates .includes() — true", () => {
    const ctx: EvalContext = { params: { command: "git push --force" } };
    expect(evaluateCondition('params.command.includes("git push")', ctx)).toBe(true);
  });

  it("evaluates .includes() — false", () => {
    const ctx: EvalContext = { params: { command: "git pull" } };
    expect(evaluateCondition('params.command.includes("git push")', ctx)).toBe(false);
  });

  it("evaluates .startsWith() — true", () => {
    const ctx: EvalContext = { params: { command: "git push origin main" } };
    expect(evaluateCondition('params.command.startsWith("git")', ctx)).toBe(true);
  });

  it("evaluates .startsWith() — false", () => {
    const ctx: EvalContext = { params: { command: "npm install" } };
    expect(evaluateCondition('params.command.startsWith("git")', ctx)).toBe(false);
  });

  it("evaluates .endsWith() — true", () => {
    const ctx: EvalContext = { params: { file: "test.ts" } };
    expect(evaluateCondition('params.file.endsWith(".ts")', ctx)).toBe(true);
  });

  it("evaluates .endsWith() — false", () => {
    const ctx: EvalContext = { params: { file: "test.js" } };
    expect(evaluateCondition('params.file.endsWith(".ts")', ctx)).toBe(false);
  });

  it("evaluates logical AND — both true", () => {
    const ctx: EvalContext = { toolName: "exec", params: { command: "git push" } };
    expect(evaluateCondition('toolName == "exec" && params.command.includes("git")', ctx)).toBe(
      true,
    );
  });

  it("evaluates logical AND — one false", () => {
    const ctx: EvalContext = { toolName: "read", params: { command: "git push" } };
    expect(evaluateCondition('toolName == "exec" && params.command.includes("git")', ctx)).toBe(
      false,
    );
  });

  it("evaluates logical OR — one true", () => {
    const ctx: EvalContext = { toolName: "exec" };
    expect(evaluateCondition('toolName == "exec" || toolName == "write"', ctx)).toBe(true);
  });

  it("evaluates logical OR — both false", () => {
    const ctx: EvalContext = { toolName: "read" };
    expect(evaluateCondition('toolName == "exec" || toolName == "write"', ctx)).toBe(false);
  });

  it("evaluates NOT operator", () => {
    const ctx: EvalContext = { toolName: "read" };
    expect(evaluateCondition('!toolName == "exec"', ctx)).toBe(true);
  });

  it("evaluates boolean literal true", () => {
    expect(evaluateCondition("true", {})).toBe(true);
  });

  it("evaluates boolean literal false", () => {
    expect(evaluateCondition("false", {})).toBe(false);
  });

  it("evaluates nested property access", () => {
    const ctx: EvalContext = { params: { command: "git push --force" } };
    expect(evaluateCondition('params.command.includes("--force")', ctx)).toBe(true);
  });

  it("evaluates parenthesized expression", () => {
    const ctx: EvalContext = { toolName: "exec", agentId: "agent-1" };
    expect(
      evaluateCondition('(toolName == "exec" || toolName == "write") && agentId == "agent-1"', ctx),
    ).toBe(true);
  });

  it("returns false for parenthesized expression when outer condition fails", () => {
    const ctx: EvalContext = { toolName: "exec", agentId: "agent-2" };
    expect(
      evaluateCondition('(toolName == "exec" || toolName == "write") && agentId == "agent-1"', ctx),
    ).toBe(false);
  });

  it("returns true for invalid/unparseable condition (safe default)", () => {
    expect(evaluateCondition("@@@ invalid syntax @@@", {})).toBe(true);
  });

  it("returns true when property is undefined in context", () => {
    const ctx: EvalContext = {};
    // toolName is undefined, so equality check with "exec" is false,
    // but an undefined property access in .includes() on non-string returns false
    expect(evaluateCondition('toolName == "exec"', ctx)).toBe(false);
  });

  it("handles .includes() on undefined property gracefully (returns false)", () => {
    const ctx: EvalContext = {};
    expect(evaluateCondition('params.command.includes("git")', ctx)).toBe(false);
  });

  it("handles deeply nested property access", () => {
    const ctx: EvalContext = { params: { nested: { deep: "value" } } };
    expect(evaluateCondition('params.nested.deep == "value"', ctx)).toBe(true);
  });

  it("handles escaped quotes in string literals", () => {
    const ctx: EvalContext = { params: { command: 'echo "hello"' } };
    expect(evaluateCondition('params.command.includes("hello")', ctx)).toBe(true);
  });

  it("evaluates complex combined expression", () => {
    const ctx: EvalContext = {
      toolName: "exec",
      params: { command: "git push --force origin main" },
      agentId: "agent-1",
    };

    expect(
      evaluateCondition(
        'toolName == "exec" && params.command.includes("git push") && params.command.includes("--force")',
        ctx,
      ),
    ).toBe(true);
  });

  it("evaluates NOT with parentheses", () => {
    const ctx: EvalContext = { toolName: "read" };
    expect(evaluateCondition('!(toolName == "exec")', ctx)).toBe(true);
  });

  it("evaluates NOT with parentheses — negated true", () => {
    const ctx: EvalContext = { toolName: "exec" };
    expect(evaluateCondition('!(toolName == "exec")', ctx)).toBe(false);
  });
});

// ============================================================================
// evaluateHook
// ============================================================================

describe("evaluateHook", () => {
  it("returns approve when LLM returns approve JSON", async () => {
    const hook = makeHook();
    const llmCall = vi.fn().mockResolvedValue('{ "decision": "approve", "reason": "Looks safe" }');

    const result = await evaluateHook(hook, { toolName: "exec" }, { llmCall });

    expect(result.decision).toBe("approve");
    expect(result.reason).toBe("Looks safe");
    expect(result.hookName).toBe("test-hook");
    expect(result.cached).toBe(false);
  });

  it("returns deny when LLM returns deny JSON", async () => {
    const hook = makeHook();
    const llmCall = vi
      .fn()
      .mockResolvedValue('{ "decision": "deny", "reason": "Force push detected" }');

    const result = await evaluateHook(hook, { toolName: "exec" }, { llmCall });

    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("Force push detected");
  });

  it("returns warn when LLM returns warn JSON", async () => {
    const hook = makeHook();
    const llmCall = vi
      .fn()
      .mockResolvedValue('{ "decision": "warn", "reason": "Potentially risky" }');

    const result = await evaluateHook(hook, { toolName: "exec" }, { llmCall });

    expect(result.decision).toBe("warn");
    expect(result.reason).toBe("Potentially risky");
  });

  it("defaults to approve when LLM returns invalid JSON", async () => {
    const hook = makeHook();
    const llmCall = vi.fn().mockResolvedValue("This is not JSON at all");

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("non-JSON response");
  });

  it("defaults to approve on LLM timeout", async () => {
    const hook = makeHook({ timeoutMs: 100 });
    const llmCall = vi
      .fn()
      .mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve("late"), 500)));

    const result = await evaluateHook(hook, {}, { llmCall, timeoutMs: 100 });

    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("timed out");
  });

  it("defaults to approve when no LLM call function provided", async () => {
    const hook = makeHook();

    const result = await evaluateHook(hook, {}, {});

    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("No LLM call function");
  });

  it("tracks evaluation duration", async () => {
    const hook = makeHook();
    const llmCall = vi
      .fn()
      .mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(() => resolve('{ "decision": "approve", "reason": "ok" }'), 50),
          ),
      );

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(result.durationMs).toBeGreaterThanOrEqual(40);
  });

  it("uses hook model when no override provided", async () => {
    const hook = makeHook({ model: "custom/model-v1" });
    const llmCall = vi.fn().mockResolvedValue('{ "decision": "approve", "reason": "ok" }');

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(llmCall).toHaveBeenCalledWith(expect.any(String), "custom/model-v1");
    expect(result.model).toBe("custom/model-v1");
  });

  it("uses option model override when provided", async () => {
    const hook = makeHook({ model: "custom/model-v1" });
    const llmCall = vi.fn().mockResolvedValue('{ "decision": "approve", "reason": "ok" }');

    const result = await evaluateHook(hook, {}, { model: "override/model", llmCall });

    expect(llmCall).toHaveBeenCalledWith(expect.any(String), "override/model");
    expect(result.model).toBe("override/model");
  });

  it("includes context in the prompt sent to LLM", async () => {
    const hook = makeHook();
    const llmCall = vi.fn().mockResolvedValue('{ "decision": "approve", "reason": "ok" }');

    await evaluateHook(
      hook,
      { toolName: "exec", params: { command: "ls -la" }, agentId: "agent-1" },
      { llmCall },
    );

    const prompt = llmCall.mock.calls[0][0] as string;
    expect(prompt).toContain("Tool: exec");
    expect(prompt).toContain("ls -la");
    expect(prompt).toContain("Agent: agent-1");
  });

  it("handles JSON wrapped in markdown code blocks", async () => {
    const hook = makeHook();
    const llmCall = vi
      .fn()
      .mockResolvedValue('```json\n{ "decision": "deny", "reason": "Blocked" }\n```');

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(result.decision).toBe("deny");
    expect(result.reason).toBe("Blocked");
  });

  it("handles LLM error gracefully", async () => {
    const hook = makeHook();
    const llmCall = vi.fn().mockRejectedValue(new Error("API rate limited"));

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(result.decision).toBe("approve");
    expect(result.reason).toContain("API rate limited");
  });

  it("defaults to approve when decision field is missing from JSON", async () => {
    const hook = makeHook();
    const llmCall = vi.fn().mockResolvedValue('{ "reason": "Some reason" }');

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(result.decision).toBe("approve");
    expect(result.reason).toBe("Some reason");
  });

  it("defaults to approve when decision value is invalid", async () => {
    const hook = makeHook();
    const llmCall = vi
      .fn()
      .mockResolvedValue('{ "decision": "block", "reason": "Invalid decision" }');

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(result.decision).toBe("approve");
  });

  it("handles JSON embedded in text response", async () => {
    const hook = makeHook();
    const llmCall = vi
      .fn()
      .mockResolvedValue(
        'I think this is fine. { "decision": "approve", "reason": "No issues found" } End.',
      );

    const result = await evaluateHook(hook, {}, { llmCall });

    expect(result.decision).toBe("approve");
    expect(result.reason).toBe("No issues found");
  });
});

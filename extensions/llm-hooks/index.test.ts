import { describe, it, expect, vi } from "vitest";
import { llmHooksConfigSchema } from "./config.js";
import { evaluateCondition } from "./llm-evaluator.js";
import { HookCache } from "./cache.js";
import { parseHookMarkdown } from "./hook-loader.js";
import llmHooksPlugin from "./index.js";

// ============================================================================
// Config Parsing
// ============================================================================

describe("llmHooksConfigSchema.parse", () => {
  it("returns defaults when called with empty object", () => {
    const cfg = llmHooksConfigSchema.parse({});

    expect(cfg.enabled).toBe(true);
    expect(cfg.projectHooksDir).toBe(".mayros/hooks");
    expect(cfg.userHooksDir).toBe("~/.mayros/hooks");
    expect(cfg.defaultModel).toBe("anthropic/claude-sonnet-4-20250514");
    expect(cfg.defaultTimeoutMs).toBe(15000);
    expect(cfg.defaultCache).toBe("session");
    expect(cfg.maxConcurrentEvals).toBe(3);
    expect(cfg.globalCacheTtlMs).toBe(300000);
  });

  it("parses a fully configured object", () => {
    const cfg = llmHooksConfigSchema.parse({
      enabled: false,
      projectHooksDir: "custom/hooks",
      userHooksDir: "~/custom/hooks",
      defaultModel: "openai/gpt-4o",
      defaultTimeoutMs: 30000,
      defaultCache: "global",
      maxConcurrentEvals: 5,
      globalCacheTtlMs: 600000,
    });

    expect(cfg.enabled).toBe(false);
    expect(cfg.projectHooksDir).toBe("custom/hooks");
    expect(cfg.userHooksDir).toBe("~/custom/hooks");
    expect(cfg.defaultModel).toBe("openai/gpt-4o");
    expect(cfg.defaultTimeoutMs).toBe(30000);
    expect(cfg.defaultCache).toBe("global");
    expect(cfg.maxConcurrentEvals).toBe(5);
    expect(cfg.globalCacheTtlMs).toBe(600000);
  });

  it("throws on unknown keys", () => {
    expect(() => llmHooksConfigSchema.parse({ unknownKey: true })).toThrow("unknown keys");
  });

  it("throws when defaultTimeoutMs is below minimum", () => {
    expect(() => llmHooksConfigSchema.parse({ defaultTimeoutMs: 500 })).toThrow("at least 1000");
  });

  it("throws when defaultTimeoutMs is above maximum", () => {
    expect(() => llmHooksConfigSchema.parse({ defaultTimeoutMs: 200000 })).toThrow(
      "at most 120000",
    );
  });

  it("throws when maxConcurrentEvals is below minimum", () => {
    expect(() => llmHooksConfigSchema.parse({ maxConcurrentEvals: 0 })).toThrow("at least 1");
  });

  it("throws when maxConcurrentEvals is above maximum", () => {
    expect(() => llmHooksConfigSchema.parse({ maxConcurrentEvals: 20 })).toThrow("at most 10");
  });

  it("throws when globalCacheTtlMs is below minimum", () => {
    expect(() => llmHooksConfigSchema.parse({ globalCacheTtlMs: 1000 })).toThrow("at least 10000");
  });

  it("falls back to default for invalid cache scope", () => {
    const cfg = llmHooksConfigSchema.parse({ defaultCache: "invalid" });
    expect(cfg.defaultCache).toBe("session");
  });

  it("falls back to default for empty model string", () => {
    const cfg = llmHooksConfigSchema.parse({ defaultModel: "" });
    expect(cfg.defaultModel).toBe("anthropic/claude-sonnet-4-20250514");
  });

  it("accepts null/undefined input and returns defaults", () => {
    const cfg = llmHooksConfigSchema.parse(null);
    expect(cfg.enabled).toBe(true);
    expect(cfg.projectHooksDir).toBe(".mayros/hooks");
  });
});

// ============================================================================
// Plugin Shape
// ============================================================================

describe("llmHooksPlugin shape", () => {
  it("exports plugin with correct id", () => {
    expect(llmHooksPlugin.id).toBe("llm-hooks");
  });

  it("exports plugin with correct name", () => {
    expect(llmHooksPlugin.name).toBe("LLM Hooks");
  });

  it("exports plugin with correct kind", () => {
    expect(llmHooksPlugin.kind).toBe("security");
  });

  it("has a register function", () => {
    expect(typeof llmHooksPlugin.register).toBe("function");
  });

  it("has a configSchema with parse method", () => {
    expect(typeof llmHooksPlugin.configSchema.parse).toBe("function");
  });
});

// ============================================================================
// Integration: Condition + Cache
// ============================================================================

describe("condition evaluation integration", () => {
  it("condition matches context and cache stores result", () => {
    // Condition evaluates to true
    const ctx = { toolName: "exec", params: { command: "git push --force" } };
    const conditionMet = evaluateCondition(
      'toolName == "exec" && params.command.includes("--force")',
      ctx,
    );
    expect(conditionMet).toBe(true);

    // Cache the evaluation result
    const cache = new HookCache();
    const bodyHash = cache.hashBody("Check for force push");
    const contextHash = cache.hashContext(ctx);
    const key = cache.buildKey("no-force-push", bodyHash, contextHash);

    cache.set("session", key, {
      decision: "deny",
      reason: "Force push detected",
      hookName: "no-force-push",
      model: "test-model",
      durationMs: 200,
      cached: false,
    });

    const cached = cache.get("session", key);
    expect(cached).toBeDefined();
    expect(cached?.decision).toBe("deny");
  });

  it("condition does not match — cache is not consulted", () => {
    const ctx = { toolName: "read" };
    const conditionMet = evaluateCondition('toolName == "exec"', ctx);
    expect(conditionMet).toBe(false);
    // When condition is false, the hook pipeline skips LLM eval and caching
  });
});

// ============================================================================
// Integration: Full Hook Pipeline
// ============================================================================

describe("hook pipeline integration", () => {
  it("parses a hook, evaluates condition, and returns correct structure", () => {
    const hookMd = `---
name: deny-rm-rf
description: Block rm -rf commands
events: before_tool_call
condition: toolName == "exec" && params.command.includes("rm -rf")
cache: session
priority: 200
---

If the command contains rm -rf, DENY.

Respond with JSON: { "decision": "deny" | "approve", "reason": "..." }`;

    const hook = parseHookMarkdown(hookMd, "/hooks/deny-rm.md", "project");
    expect(hook.name).toBe("deny-rm-rf");
    expect(hook.priority).toBe(200);

    // Test condition against matching context
    const matchCtx = { toolName: "exec", params: { command: "rm -rf /" } };
    expect(evaluateCondition(hook.condition!, matchCtx)).toBe(true);

    // Test condition against non-matching context
    const noMatchCtx = { toolName: "exec", params: { command: "ls -la" } };
    expect(evaluateCondition(hook.condition!, noMatchCtx)).toBe(false);
  });

  it("hook with no condition always matches", () => {
    const hookMd = `---
name: audit-all
description: Audit all tool calls
events: after_tool_call
cache: none
---

Log this tool call for audit.

Respond with JSON: { "decision": "approve", "reason": "Logged" }`;

    const hook = parseHookMarkdown(hookMd, "/hooks/audit.md", "user");
    expect(hook.condition).toBeUndefined();

    // No condition means always evaluate
    const conditionMet = evaluateCondition(hook.condition ?? "", {});
    expect(conditionMet).toBe(true);
  });
});

// ============================================================================
// CLI Registration (Mock API)
// ============================================================================

describe("plugin registration with mock API", () => {
  it("registers without error when disabled", async () => {
    const mockApi = {
      pluginConfig: { enabled: false },
      id: "test-agent",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      registerService: vi.fn(),
    };

    await llmHooksPlugin.register(mockApi as never);

    // When disabled, no tools/cli/services should be registered
    expect(mockApi.registerCli).not.toHaveBeenCalled();
    expect(mockApi.registerService).not.toHaveBeenCalled();
    expect(mockApi.logger.info).toHaveBeenCalledWith("llm-hooks: plugin disabled by config");
  });

  it("registers CLI and service when enabled", async () => {
    const mockApi = {
      pluginConfig: {},
      id: "test-agent",
      logger: {
        info: vi.fn(),
        warn: vi.fn(),
        error: vi.fn(),
      },
      on: vi.fn(),
      registerTool: vi.fn(),
      registerCli: vi.fn(),
      registerService: vi.fn(),
    };

    await llmHooksPlugin.register(mockApi as never);

    expect(mockApi.registerCli).toHaveBeenCalledTimes(1);
    expect(mockApi.registerCli).toHaveBeenCalledWith(expect.any(Function), {
      commands: ["llm-hooks"],
    });

    expect(mockApi.registerService).toHaveBeenCalledTimes(1);
    expect(mockApi.registerService).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "llm-hooks",
        start: expect.any(Function),
        stop: expect.any(Function),
      }),
    );
  });
});

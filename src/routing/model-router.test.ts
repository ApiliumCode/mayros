import { describe, it, expect } from "vitest";
import { ModelRouter } from "./model-router.js";
import type { ModelCandidate } from "./model-router.js";

const MOCK_MODELS: ModelCandidate[] = [
  {
    id: "anthropic/claude-opus",
    provider: "anthropic",
    costPer1kInput: 0.015,
    costPer1kOutput: 0.075,
    capabilities: ["vision", "code", "long-context"],
    maxContext: 200000,
    available: true,
  },
  {
    id: "anthropic/claude-sonnet",
    provider: "anthropic",
    costPer1kInput: 0.003,
    costPer1kOutput: 0.015,
    capabilities: ["vision", "code"],
    maxContext: 200000,
    available: true,
  },
  {
    id: "anthropic/claude-haiku",
    provider: "anthropic",
    costPer1kInput: 0.00025,
    costPer1kOutput: 0.00125,
    capabilities: ["code"],
    maxContext: 200000,
    available: true,
  },
  {
    id: "google/gemini-flash",
    provider: "google",
    costPer1kInput: 0.0001,
    costPer1kOutput: 0.0004,
    capabilities: ["vision", "code", "long-context"],
    maxContext: 1000000,
    available: true,
  },
];

function createRouter(overrides?: {
  defaultModel?: string;
  fallbackOrder?: string[];
}): ModelRouter {
  return new ModelRouter({
    models: MOCK_MODELS.map((m) => ({ ...m })),
    defaultModel: overrides?.defaultModel ?? "anthropic/claude-sonnet",
    fallbackOrder: overrides?.fallbackOrder,
  });
}

describe("ModelRouter", () => {
  // 1
  it("default strategy returns configured default model", () => {
    const router = createRouter();
    const decision = router.route("default");
    expect(decision.model.id).toBe("anthropic/claude-sonnet");
    expect(decision.strategy).toBe("default");
    expect(decision.reason).toContain("Default model");
  });

  // 2
  it("default strategy falls back when default unavailable", () => {
    const router = createRouter({
      fallbackOrder: [
        "anthropic/claude-sonnet",
        "anthropic/claude-opus",
        "anthropic/claude-haiku",
        "google/gemini-flash",
      ],
    });
    router.markUnavailable("anthropic/claude-sonnet");
    const decision = router.route("default");
    expect(decision.model.id).toBe("anthropic/claude-opus");
    expect(decision.reason).toContain("unavailable");
    expect(decision.fallbackChain).toContain("anthropic/claude-sonnet");
  });

  // 3
  it("fallback strategy walks the chain", () => {
    const router = createRouter({
      fallbackOrder: [
        "anthropic/claude-opus",
        "anthropic/claude-sonnet",
        "anthropic/claude-haiku",
        "google/gemini-flash",
      ],
    });
    const decision = router.route("fallback");
    expect(decision.model.id).toBe("anthropic/claude-opus");
    expect(decision.strategy).toBe("fallback");
  });

  // 4
  it("fallback strategy skips unavailable models", () => {
    const router = createRouter({
      fallbackOrder: [
        "anthropic/claude-opus",
        "anthropic/claude-sonnet",
        "anthropic/claude-haiku",
        "google/gemini-flash",
      ],
    });
    router.markUnavailable("anthropic/claude-opus");
    router.markUnavailable("anthropic/claude-sonnet");
    const decision = router.route("fallback");
    expect(decision.model.id).toBe("anthropic/claude-haiku");
    expect(decision.fallbackChain).toEqual([
      "anthropic/claude-opus",
      "anthropic/claude-sonnet",
      "anthropic/claude-haiku",
    ]);
  });

  // 5
  it("cost-optimized returns cheapest available", () => {
    const router = createRouter();
    const decision = router.route("cost-optimized");
    expect(decision.model.id).toBe("google/gemini-flash");
    expect(decision.strategy).toBe("cost-optimized");
    expect(decision.reason).toContain("Cheapest");
  });

  // 6
  it("cost-optimized filters by vision requirement", () => {
    const router = createRouter();
    const decision = router.route("cost-optimized", { requiresVision: true });
    // haiku has no vision, so cheapest with vision is gemini-flash
    expect(decision.model.id).toBe("google/gemini-flash");
    // Verify haiku (no vision) is excluded from chain
    expect(decision.fallbackChain).not.toContain("anthropic/claude-haiku");
  });

  // 7
  it("capability strategy matches vision requirement", () => {
    const router = createRouter();
    const decision = router.route("capability", { requiresVision: true });
    expect(decision.model.capabilities).toContain("vision");
    expect(decision.strategy).toBe("capability");
    expect(decision.reason).toContain("vision");
  });

  // 8
  it("capability strategy matches long-context", () => {
    const router = createRouter();
    const decision = router.route("capability", {
      inputTokenEstimate: 500_000,
    });
    // Only gemini-flash has long-context + 1M context window
    expect(decision.model.id).toBe("google/gemini-flash");
    expect(decision.model.capabilities).toContain("long-context");
    expect(decision.reason).toContain("long-context");
  });

  // 9
  it("markUnavailable removes model from selection", () => {
    const router = createRouter({ defaultModel: "anthropic/claude-opus" });
    router.markUnavailable("anthropic/claude-opus");
    const models = router.listModels();
    const opus = models.find((m) => m.id === "anthropic/claude-opus");
    expect(opus?.available).toBe(false);
  });

  // 10
  it("markAvailable restores model", () => {
    const router = createRouter({ defaultModel: "anthropic/claude-opus" });
    router.markUnavailable("anthropic/claude-opus");
    router.markAvailable("anthropic/claude-opus");
    const models = router.listModels();
    const opus = models.find((m) => m.id === "anthropic/claude-opus");
    expect(opus?.available).toBe(true);
  });

  // 11
  it("registerModel adds new model", () => {
    const router = createRouter();
    expect(router.listModels()).toHaveLength(4);
    router.registerModel({
      id: "openai/gpt-4o",
      provider: "openai",
      costPer1kInput: 0.005,
      costPer1kOutput: 0.015,
      capabilities: ["vision", "code"],
      maxContext: 128000,
      available: true,
    });
    expect(router.listModels()).toHaveLength(5);
    const gpt = router.listModels().find((m) => m.id === "openai/gpt-4o");
    expect(gpt).toBeDefined();
    expect(gpt?.provider).toBe("openai");
  });

  // 12
  it("returns fallbackChain in decision", () => {
    const router = createRouter({
      fallbackOrder: [
        "anthropic/claude-opus",
        "anthropic/claude-sonnet",
        "anthropic/claude-haiku",
        "google/gemini-flash",
      ],
    });
    router.markUnavailable("anthropic/claude-opus");
    const decision = router.route("fallback");
    expect(Array.isArray(decision.fallbackChain)).toBe(true);
    expect(decision.fallbackChain.length).toBeGreaterThanOrEqual(1);
    // Chain should include tried models up to and including the selected one
    expect(decision.fallbackChain[0]).toBe("anthropic/claude-opus");
    expect(decision.fallbackChain[1]).toBe("anthropic/claude-sonnet");
  });
});

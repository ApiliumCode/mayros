import { describe, it, expect } from "vitest";
import {
  lookupBuiltinPricing,
  resolveModelCostWithFallback,
  getModelDisplayName,
  listCatalogModels,
} from "./model-pricing.js";

// ============================================================================
// lookupBuiltinPricing
// ============================================================================

describe("lookupBuiltinPricing", () => {
  // 1
  it("finds anthropic claude-opus-4-6 by exact match", () => {
    const entry = lookupBuiltinPricing("anthropic", "claude-opus-4-6");
    expect(entry).toBeDefined();
    expect(entry!.input).toBe(15);
    expect(entry!.output).toBe(75);
    expect(entry!.displayName).toBe("Claude Opus 4.6");
  });

  // 2
  it("finds openai gpt-4o by exact match", () => {
    const entry = lookupBuiltinPricing("openai", "gpt-4o");
    expect(entry).toBeDefined();
    expect(entry!.input).toBe(2.5);
    expect(entry!.output).toBe(10);
    expect(entry!.displayName).toBe("GPT-4o");
  });

  // 3
  it("finds google gemini-2.0-flash by exact match", () => {
    const entry = lookupBuiltinPricing("google", "gemini-2.0-flash");
    expect(entry).toBeDefined();
    expect(entry!.input).toBe(0.1);
  });

  // 4
  it("matches by prefix for versioned model IDs", () => {
    const entry = lookupBuiltinPricing("anthropic", "claude-sonnet-4-6-20260301");
    expect(entry).toBeDefined();
    expect(entry!.displayName).toBe("Claude Sonnet 4.6");
  });

  // 5
  it("returns undefined for unknown provider", () => {
    expect(lookupBuiltinPricing("unknown-provider", "some-model")).toBeUndefined();
  });

  // 6
  it("returns undefined for unknown model", () => {
    expect(lookupBuiltinPricing("anthropic", "nonexistent-model")).toBeUndefined();
  });

  // 7
  it("is case-insensitive for provider", () => {
    const entry = lookupBuiltinPricing("Anthropic", "claude-opus-4-6");
    expect(entry).toBeDefined();
    expect(entry!.displayName).toBe("Claude Opus 4.6");
  });

  // 8
  it("includes context window and max output", () => {
    const entry = lookupBuiltinPricing("anthropic", "claude-opus-4-6");
    expect(entry!.contextWindow).toBe(200_000);
    expect(entry!.maxOutput).toBe(32_000);
  });

  // 9
  it("includes cache pricing", () => {
    const entry = lookupBuiltinPricing("anthropic", "claude-sonnet-4-6");
    expect(entry!.cacheRead).toBe(0.3);
    expect(entry!.cacheWrite).toBe(3.75);
  });
});

// ============================================================================
// resolveModelCostWithFallback
// ============================================================================

describe("resolveModelCostWithFallback", () => {
  // 10
  it("returns user config cost when provided", () => {
    const userCost = { input: 100, output: 200, cacheRead: 50, cacheWrite: 150 };
    const result = resolveModelCostWithFallback({
      provider: "anthropic",
      model: "claude-opus-4-6",
      configCost: userCost,
    });
    expect(result).toBe(userCost); // Same reference
  });

  // 11
  it("falls back to catalog when no config cost", () => {
    const result = resolveModelCostWithFallback({
      provider: "anthropic",
      model: "claude-opus-4-6",
    });
    expect(result).toBeDefined();
    expect(result!.input).toBe(15);
  });

  // 12
  it("returns undefined for unknown model without config", () => {
    const result = resolveModelCostWithFallback({
      provider: "unknown",
      model: "unknown-model",
    });
    expect(result).toBeUndefined();
  });

  // 13
  it("returns undefined when provider/model missing", () => {
    expect(resolveModelCostWithFallback({})).toBeUndefined();
    expect(resolveModelCostWithFallback({ provider: "anthropic" })).toBeUndefined();
  });
});

// ============================================================================
// getModelDisplayName
// ============================================================================

describe("getModelDisplayName", () => {
  // 14
  it("returns display name for known model", () => {
    expect(getModelDisplayName("anthropic", "claude-opus-4-6")).toBe("Claude Opus 4.6");
  });

  // 15
  it("returns model ID for unknown model", () => {
    expect(getModelDisplayName("anthropic", "unknown-model")).toBe("unknown-model");
  });
});

// ============================================================================
// listCatalogModels
// ============================================================================

describe("listCatalogModels", () => {
  // 16
  it("returns non-empty catalog", () => {
    const models = listCatalogModels();
    expect(models.length).toBeGreaterThan(10);
  });

  // 17
  it("includes all three providers", () => {
    const models = listCatalogModels();
    const providers = new Set(models.map((m) => m.provider));
    expect(providers.has("anthropic")).toBe(true);
    expect(providers.has("openai")).toBe(true);
    expect(providers.has("google")).toBe(true);
  });

  // 18
  it("each entry has required fields", () => {
    const models = listCatalogModels();
    for (const { entry } of models) {
      expect(entry.input).toBeGreaterThan(0);
      expect(entry.output).toBeGreaterThan(0);
      expect(entry.contextWindow).toBeGreaterThan(0);
      expect(entry.maxOutput).toBeGreaterThan(0);
      expect(entry.displayName.length).toBeGreaterThan(0);
    }
  });
});

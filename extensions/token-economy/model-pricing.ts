/**
 * Built-in Model Pricing Catalog — fallback pricing for common LLM models.
 *
 * Prices are in USD per 1M tokens. Used when the user's config does not
 * include explicit cost entries for a provider/model pair.
 *
 * Sources: official pricing pages as of March 2026.
 */

import type { ModelCostConfig } from "../../src/utils/usage-format.js";

export type ModelPricingEntry = ModelCostConfig & {
  /** Context window in tokens. */
  contextWindow: number;
  /** Max output tokens per response. */
  maxOutput: number;
  /** Display name for UIs. */
  displayName: string;
};

// ============================================================================
// Catalog
// ============================================================================

const CATALOG: Record<string, Record<string, ModelPricingEntry>> = {
  anthropic: {
    "claude-opus-4-6": {
      input: 15,
      output: 75,
      cacheRead: 1.5,
      cacheWrite: 18.75,
      contextWindow: 200_000,
      maxOutput: 32_000,
      displayName: "Claude Opus 4.6",
    },
    "claude-sonnet-4-6": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
      contextWindow: 200_000,
      maxOutput: 16_000,
      displayName: "Claude Sonnet 4.6",
    },
    "claude-haiku-4-5-20251001": {
      input: 0.8,
      output: 4,
      cacheRead: 0.08,
      cacheWrite: 1,
      contextWindow: 200_000,
      maxOutput: 8_192,
      displayName: "Claude Haiku 4.5",
    },
    "claude-sonnet-4-5-20250514": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
      contextWindow: 200_000,
      maxOutput: 16_000,
      displayName: "Claude Sonnet 4.5",
    },
    "claude-3-5-sonnet-20241022": {
      input: 3,
      output: 15,
      cacheRead: 0.3,
      cacheWrite: 3.75,
      contextWindow: 200_000,
      maxOutput: 8_192,
      displayName: "Claude 3.5 Sonnet",
    },
    "claude-3-5-haiku-20241022": {
      input: 0.8,
      output: 4,
      cacheRead: 0.08,
      cacheWrite: 1,
      contextWindow: 200_000,
      maxOutput: 8_192,
      displayName: "Claude 3.5 Haiku",
    },
  },
  openai: {
    "gpt-4o": {
      input: 2.5,
      output: 10,
      cacheRead: 1.25,
      cacheWrite: 2.5,
      contextWindow: 128_000,
      maxOutput: 16_384,
      displayName: "GPT-4o",
    },
    "gpt-4o-mini": {
      input: 0.15,
      output: 0.6,
      cacheRead: 0.075,
      cacheWrite: 0.15,
      contextWindow: 128_000,
      maxOutput: 16_384,
      displayName: "GPT-4o Mini",
    },
    o1: {
      input: 15,
      output: 60,
      cacheRead: 7.5,
      cacheWrite: 15,
      contextWindow: 200_000,
      maxOutput: 100_000,
      displayName: "o1",
    },
    "o1-mini": {
      input: 3,
      output: 12,
      cacheRead: 1.5,
      cacheWrite: 3,
      contextWindow: 128_000,
      maxOutput: 65_536,
      displayName: "o1-mini",
    },
    "o3-mini": {
      input: 1.1,
      output: 4.4,
      cacheRead: 0.55,
      cacheWrite: 1.1,
      contextWindow: 200_000,
      maxOutput: 100_000,
      displayName: "o3-mini",
    },
  },
  google: {
    "gemini-2.0-flash": {
      input: 0.1,
      output: 0.4,
      cacheRead: 0.025,
      cacheWrite: 0.1,
      contextWindow: 1_000_000,
      maxOutput: 8_192,
      displayName: "Gemini 2.0 Flash",
    },
    "gemini-2.0-pro": {
      input: 1.25,
      output: 10,
      cacheRead: 0.315,
      cacheWrite: 1.25,
      contextWindow: 2_000_000,
      maxOutput: 8_192,
      displayName: "Gemini 2.0 Pro",
    },
    "gemini-1.5-pro": {
      input: 1.25,
      output: 5,
      cacheRead: 0.315,
      cacheWrite: 1.25,
      contextWindow: 2_000_000,
      maxOutput: 8_192,
      displayName: "Gemini 1.5 Pro",
    },
  },
};

// ============================================================================
// Lookup
// ============================================================================

/**
 * Look up built-in pricing for a provider/model pair.
 * Returns undefined if the model is not in the catalog.
 */
export function lookupBuiltinPricing(
  provider: string,
  model: string,
): ModelPricingEntry | undefined {
  const providerModels = CATALOG[provider.toLowerCase()];
  if (!providerModels) return undefined;

  // Exact match first
  if (providerModels[model]) return providerModels[model];

  // Prefix match (e.g., "claude-sonnet-4-6-20260301" → "claude-sonnet-4-6")
  for (const [key, entry] of Object.entries(providerModels)) {
    if (model.startsWith(key)) return entry;
  }

  return undefined;
}

/**
 * Get the ModelCostConfig for a model, checking user config first,
 * then falling back to the built-in catalog.
 */
export function resolveModelCostWithFallback(params: {
  provider?: string;
  model?: string;
  configCost?: ModelCostConfig;
}): ModelCostConfig | undefined {
  // User-configured cost takes priority
  if (params.configCost) return params.configCost;

  if (!params.provider || !params.model) return undefined;

  const builtin = lookupBuiltinPricing(params.provider, params.model);
  if (!builtin) return undefined;

  return {
    input: builtin.input,
    output: builtin.output,
    cacheRead: builtin.cacheRead,
    cacheWrite: builtin.cacheWrite,
  };
}

/**
 * Get the display name for a model from the catalog.
 */
export function getModelDisplayName(provider: string, model: string): string {
  const entry = lookupBuiltinPricing(provider, model);
  return entry?.displayName ?? model;
}

/**
 * List all models in the built-in catalog.
 */
export function listCatalogModels(): Array<{
  provider: string;
  model: string;
  entry: ModelPricingEntry;
}> {
  const result: Array<{ provider: string; model: string; entry: ModelPricingEntry }> = [];
  for (const [provider, models] of Object.entries(CATALOG)) {
    for (const [model, entry] of Object.entries(models)) {
      result.push({ provider, model, entry });
    }
  }
  return result;
}

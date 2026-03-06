import { describe, it, expect, beforeEach } from "vitest";
import { TokenAccumulator } from "./token-accumulator.js";
import type { UsageData, ModelPricing } from "./token-accumulator.js";

describe("TokenAccumulator", () => {
  let accumulator: TokenAccumulator;

  beforeEach(() => {
    accumulator = new TokenAccumulator();
  });

  describe("single response accumulation", () => {
    it("tracks a single request correctly", () => {
      const data: UsageData = {
        promptTokens: 1500,
        completionTokens: 500,
      };
      accumulator.add(data);

      const usage = accumulator.getUsage();
      expect(usage.totalPromptTokens).toBe(1500);
      expect(usage.totalCompletionTokens).toBe(500);
      expect(usage.totalTokens).toBe(2000);
      expect(usage.requestCount).toBe(1);
    });
  });

  describe("multiple response accumulation", () => {
    it("sums tokens across three requests", () => {
      accumulator.add({ promptTokens: 1000, completionTokens: 200 });
      accumulator.add({ promptTokens: 1500, completionTokens: 300 });
      accumulator.add({ promptTokens: 2000, completionTokens: 400 });

      const usage = accumulator.getUsage();
      expect(usage.totalPromptTokens).toBe(4500);
      expect(usage.totalCompletionTokens).toBe(900);
      expect(usage.totalTokens).toBe(5400);
      expect(usage.requestCount).toBe(3);
    });

    it("increments request count for each add call", () => {
      for (let i = 0; i < 10; i++) {
        accumulator.add({ promptTokens: 100, completionTokens: 50 });
      }
      expect(accumulator.getUsage().requestCount).toBe(10);
    });
  });

  describe("cache token tracking", () => {
    it("accumulates cache read and write tokens", () => {
      accumulator.add({
        promptTokens: 1000,
        completionTokens: 200,
        cacheReadTokens: 300,
        cacheWriteTokens: 150,
      });
      accumulator.add({
        promptTokens: 800,
        completionTokens: 100,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
      });

      const usage = accumulator.getUsage();
      expect(usage.totalCacheReadTokens).toBe(800);
      expect(usage.totalCacheWriteTokens).toBe(150);
    });

    it("defaults cache tokens to 0 when not provided", () => {
      accumulator.add({ promptTokens: 1000, completionTokens: 200 });

      const usage = accumulator.getUsage();
      expect(usage.totalCacheReadTokens).toBe(0);
      expect(usage.totalCacheWriteTokens).toBe(0);
    });
  });

  describe("cost estimation", () => {
    it("estimates cost with standard pricing", () => {
      accumulator.add({ promptTokens: 50_000, completionTokens: 10_000 });

      const pricing: ModelPricing = {
        promptPer1M: 3.0,
        completionPer1M: 15.0,
      };

      const cost = accumulator.estimateCost(pricing);
      // prompt: (50000 / 1M) * 3 = 0.15
      // completion: (10000 / 1M) * 15 = 0.15
      expect(cost.promptCost).toBeCloseTo(0.15, 6);
      expect(cost.completionCost).toBeCloseTo(0.15, 6);
      expect(cost.totalCost).toBeCloseTo(0.3, 6);
    });

    it("estimates cost with different model pricing", () => {
      accumulator.add({ promptTokens: 1_000_000, completionTokens: 500_000 });

      const cheapPricing: ModelPricing = { promptPer1M: 0.25, completionPer1M: 1.25 };
      const cheapCost = accumulator.estimateCost(cheapPricing);
      expect(cheapCost.promptCost).toBeCloseTo(0.25, 6);
      expect(cheapCost.completionCost).toBeCloseTo(0.625, 6);
      expect(cheapCost.totalCost).toBeCloseTo(0.875, 6);

      const expensivePricing: ModelPricing = { promptPer1M: 15.0, completionPer1M: 75.0 };
      const expensiveCost = accumulator.estimateCost(expensivePricing);
      expect(expensiveCost.promptCost).toBeCloseTo(15.0, 6);
      expect(expensiveCost.completionCost).toBeCloseTo(37.5, 6);
      expect(expensiveCost.totalCost).toBeCloseTo(52.5, 6);
    });

    it("returns zero cost for zero tokens", () => {
      const cost = accumulator.estimateCost({ promptPer1M: 3.0, completionPer1M: 15.0 });
      expect(cost.promptCost).toBe(0);
      expect(cost.completionCost).toBe(0);
      expect(cost.totalCost).toBe(0);
    });
  });

  describe("reset", () => {
    it("clears all accumulated data", () => {
      accumulator.add({ promptTokens: 5000, completionTokens: 1000, cacheReadTokens: 200 });
      accumulator.add({ promptTokens: 3000, completionTokens: 800 });

      accumulator.reset();

      const usage = accumulator.getUsage();
      expect(usage.totalPromptTokens).toBe(0);
      expect(usage.totalCompletionTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.totalCacheReadTokens).toBe(0);
      expect(usage.totalCacheWriteTokens).toBe(0);
      expect(usage.requestCount).toBe(0);
    });

    it("allows accumulation after reset", () => {
      accumulator.add({ promptTokens: 5000, completionTokens: 1000 });
      accumulator.reset();
      accumulator.add({ promptTokens: 100, completionTokens: 50 });

      const usage = accumulator.getUsage();
      expect(usage.totalPromptTokens).toBe(100);
      expect(usage.totalCompletionTokens).toBe(50);
      expect(usage.totalTokens).toBe(150);
      expect(usage.requestCount).toBe(1);
    });
  });

  describe("zero token handling", () => {
    it("handles a request with zero prompt and completion tokens", () => {
      accumulator.add({ promptTokens: 0, completionTokens: 0 });

      const usage = accumulator.getUsage();
      expect(usage.totalPromptTokens).toBe(0);
      expect(usage.totalCompletionTokens).toBe(0);
      expect(usage.totalTokens).toBe(0);
      expect(usage.requestCount).toBe(1);
    });
  });

  describe("large token counts", () => {
    it("handles millions of tokens without precision loss", () => {
      accumulator.add({ promptTokens: 50_000_000, completionTokens: 10_000_000 });
      accumulator.add({ promptTokens: 50_000_000, completionTokens: 10_000_000 });

      const usage = accumulator.getUsage();
      expect(usage.totalPromptTokens).toBe(100_000_000);
      expect(usage.totalCompletionTokens).toBe(20_000_000);
      expect(usage.totalTokens).toBe(120_000_000);

      const cost = accumulator.estimateCost({ promptPer1M: 3.0, completionPer1M: 15.0 });
      expect(cost.promptCost).toBeCloseTo(300.0, 6);
      expect(cost.completionCost).toBeCloseTo(300.0, 6);
      expect(cost.totalCost).toBeCloseTo(600.0, 6);
    });
  });

  describe("getUsage returns a copy", () => {
    it("does not expose internal state to mutation", () => {
      accumulator.add({ promptTokens: 1000, completionTokens: 500 });
      const usage = accumulator.getUsage();
      usage.totalPromptTokens = 999_999;

      const freshUsage = accumulator.getUsage();
      expect(freshUsage.totalPromptTokens).toBe(1000);
    });
  });
});

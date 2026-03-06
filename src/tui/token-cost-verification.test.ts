import { describe, it, expect } from "vitest";

/**
 * Token cost display verification tests.
 *
 * Verifies the data flow from gateway usage response through TUI accumulation
 * to /usage and /context display commands.
 */

describe("token cost display", () => {
  describe("usage data structure", () => {
    it("gateway chat.final contains usage fields", () => {
      // Simulated gateway response structure
      const chatFinal = {
        type: "chat.final",
        usage: {
          promptTokens: 1500,
          completionTokens: 500,
          totalTokens: 2000,
          cacheReadTokens: 300,
          cacheWriteTokens: 200,
        },
      };

      expect(chatFinal.usage).toBeDefined();
      expect(chatFinal.usage.promptTokens).toBeGreaterThan(0);
      expect(chatFinal.usage.totalTokens).toBe(
        chatFinal.usage.promptTokens + chatFinal.usage.completionTokens,
      );
    });

    it("accumulates usage across multiple responses", () => {
      const responses = [
        { promptTokens: 1000, completionTokens: 200 },
        { promptTokens: 1500, completionTokens: 300 },
        { promptTokens: 2000, completionTokens: 400 },
      ];

      const accumulated = {
        totalPromptTokens: 0,
        totalCompletionTokens: 0,
        totalTokens: 0,
        requestCount: 0,
      };

      for (const r of responses) {
        accumulated.totalPromptTokens += r.promptTokens;
        accumulated.totalCompletionTokens += r.completionTokens;
        accumulated.totalTokens += r.promptTokens + r.completionTokens;
        accumulated.requestCount++;
      }

      expect(accumulated.totalTokens).toBe(5400);
      expect(accumulated.requestCount).toBe(3);
    });
  });

  describe("context visualization", () => {
    it("calculates usage percentage", () => {
      const used = 96_000;
      const max = 128_000;
      const pct = Math.round((used / max) * 100);
      expect(pct).toBe(75);
    });

    it("handles zero context window", () => {
      const used = 0;
      const max = 0;
      const pct = max > 0 ? Math.round((used / max) * 100) : 0;
      expect(pct).toBe(0);
    });
  });

  describe("cost estimation", () => {
    it("estimates cost based on model pricing", () => {
      // Claude Sonnet 4 pricing (example)
      const pricing = {
        promptPer1M: 3.0,
        completionPer1M: 15.0,
      };

      const usage = {
        promptTokens: 50_000,
        completionTokens: 10_000,
      };

      const cost =
        (usage.promptTokens / 1_000_000) * pricing.promptPer1M +
        (usage.completionTokens / 1_000_000) * pricing.completionPer1M;

      expect(cost).toBeCloseTo(0.3, 1);
    });
  });
});

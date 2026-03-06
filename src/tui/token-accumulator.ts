/**
 * Token usage accumulator for tracking prompt/completion tokens
 * and estimating costs across multiple LLM requests.
 */

export type UsageData = {
  promptTokens: number;
  completionTokens: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
};

export type AccumulatedUsage = {
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  requestCount: number;
};

export type CostEstimate = {
  promptCost: number;
  completionCost: number;
  totalCost: number;
};

export type ModelPricing = {
  promptPer1M: number;
  completionPer1M: number;
};

export class TokenAccumulator {
  private usage: AccumulatedUsage = {
    totalPromptTokens: 0,
    totalCompletionTokens: 0,
    totalTokens: 0,
    totalCacheReadTokens: 0,
    totalCacheWriteTokens: 0,
    requestCount: 0,
  };

  add(data: UsageData): void {
    this.usage.totalPromptTokens += data.promptTokens;
    this.usage.totalCompletionTokens += data.completionTokens;
    this.usage.totalTokens += data.promptTokens + data.completionTokens;
    this.usage.totalCacheReadTokens += data.cacheReadTokens ?? 0;
    this.usage.totalCacheWriteTokens += data.cacheWriteTokens ?? 0;
    this.usage.requestCount++;
  }

  getUsage(): AccumulatedUsage {
    return { ...this.usage };
  }

  estimateCost(pricing: ModelPricing): CostEstimate {
    const promptCost = (this.usage.totalPromptTokens / 1_000_000) * pricing.promptPer1M;
    const completionCost = (this.usage.totalCompletionTokens / 1_000_000) * pricing.completionPer1M;
    return {
      promptCost,
      completionCost,
      totalCost: promptCost + completionCost,
    };
  }

  reset(): void {
    this.usage = {
      totalPromptTokens: 0,
      totalCompletionTokens: 0,
      totalTokens: 0,
      totalCacheReadTokens: 0,
      totalCacheWriteTokens: 0,
      requestCount: 0,
    };
  }
}

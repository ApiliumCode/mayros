import type { NormalizedUsage } from "../../src/agents/usage.js";
import type { ModelCostConfig } from "../../src/utils/usage-format.js";
import { estimateUsageCost } from "../../src/utils/usage-format.js";
import type { PersistedBudget } from "./budget-persistence.js";
import type { TokenBudgetConfig } from "./config.js";

export type BudgetStatus = {
  level: "ok" | "warn" | "exceeded";
  usedUsd: number;
  limitUsd?: number;
  percent?: number;
};

export type ModelUsageEntry = {
  provider: string;
  model: string;
  calls: number;
  tokens: NormalizedUsage;
  costUsd: number;
};

export type BudgetSummary = {
  session: BudgetStatus;
  daily: BudgetStatus;
  monthly: BudgetStatus;
  callCount: number;
  tokens: NormalizedUsage;
  modelUsage: ModelUsageEntry[];
  cacheHits?: number;
  cacheMisses?: number;
  estimatedSavingsUsd?: number;
};

export class BudgetTracker {
  private sessionCostUsd = 0;
  private callCount = 0;
  private toolCallsSinceExceeded = 0;
  private tokenTotals: NormalizedUsage = {
    input: 0,
    output: 0,
    cacheRead: 0,
    cacheWrite: 0,
    total: 0,
  };
  private modelUsageMap = new Map<string, ModelUsageEntry>();

  constructor(
    private config: TokenBudgetConfig,
    private persisted: PersistedBudget,
  ) {}

  recordUsage(
    usage: NormalizedUsage,
    costConfig?: ModelCostConfig,
    provider?: string,
    model?: string,
  ): void {
    this.callCount++;
    this.tokenTotals.input = (this.tokenTotals.input ?? 0) + (usage.input ?? 0);
    this.tokenTotals.output = (this.tokenTotals.output ?? 0) + (usage.output ?? 0);
    this.tokenTotals.cacheRead = (this.tokenTotals.cacheRead ?? 0) + (usage.cacheRead ?? 0);
    this.tokenTotals.cacheWrite = (this.tokenTotals.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
    this.tokenTotals.total = (this.tokenTotals.total ?? 0) + (usage.total ?? 0);

    const cost = estimateUsageCost({ usage, cost: costConfig }) ?? 0;
    this.sessionCostUsd += cost;
    this.persisted.dailyCostUsd += cost;
    this.persisted.monthlyCostUsd += cost;
    this.persisted.lastFlushedAt = Date.now();

    // Per-model tracking
    if (provider && model) {
      const key = `${provider}:${model}`;
      const existing = this.modelUsageMap.get(key);
      if (existing) {
        existing.calls++;
        existing.costUsd += cost;
        existing.tokens.input = (existing.tokens.input ?? 0) + (usage.input ?? 0);
        existing.tokens.output = (existing.tokens.output ?? 0) + (usage.output ?? 0);
        existing.tokens.cacheRead = (existing.tokens.cacheRead ?? 0) + (usage.cacheRead ?? 0);
        existing.tokens.cacheWrite = (existing.tokens.cacheWrite ?? 0) + (usage.cacheWrite ?? 0);
        existing.tokens.total = (existing.tokens.total ?? 0) + (usage.total ?? 0);
      } else {
        this.modelUsageMap.set(key, {
          provider,
          model,
          calls: 1,
          tokens: { ...usage },
          costUsd: cost,
        });
      }

      // Update persisted per-model usage
      const persistedKey = key;
      const pm = this.persisted.modelUsage ?? {};
      const pe = pm[persistedKey];
      if (pe) {
        pe.calls++;
        pe.costUsd += cost;
        pe.tokens += usage.total ?? (usage.input ?? 0) + (usage.output ?? 0);
      } else {
        pm[persistedKey] = {
          provider,
          model,
          calls: 1,
          tokens: usage.total ?? (usage.input ?? 0) + (usage.output ?? 0),
          costUsd: cost,
        };
      }
      this.persisted.modelUsage = pm;
    }
  }

  getSessionStatus(): BudgetStatus {
    return this.computeStatus(this.sessionCostUsd, this.config.sessionLimitUsd);
  }

  getDailyStatus(): BudgetStatus {
    return this.computeStatus(this.persisted.dailyCostUsd, this.config.dailyLimitUsd);
  }

  getMonthlyStatus(): BudgetStatus {
    return this.computeStatus(this.persisted.monthlyCostUsd, this.config.monthlyLimitUsd);
  }

  getOverallStatus(): BudgetStatus {
    const statuses = [this.getSessionStatus(), this.getDailyStatus(), this.getMonthlyStatus()];
    // Return the highest alert level
    const exceeded = statuses.find((s) => s.level === "exceeded");
    if (exceeded) return exceeded;
    const warn = statuses.find((s) => s.level === "warn");
    if (warn) return warn;
    return statuses[0]!;
  }

  /** Get per-model usage breakdown for the current session. */
  getModelUsage(): ModelUsageEntry[] {
    return Array.from(this.modelUsageMap.values()).sort((a, b) => b.costUsd - a.costUsd);
  }

  getSummary(): BudgetSummary {
    return {
      session: this.getSessionStatus(),
      daily: this.getDailyStatus(),
      monthly: this.getMonthlyStatus(),
      callCount: this.callCount,
      tokens: { ...this.tokenTotals },
      modelUsage: this.getModelUsage(),
    };
  }

  /**
   * Record a tool call attempt. If the overall status is "exceeded",
   * increments the post-exceeded counter used for hard enforcement.
   */
  recordToolCall(): void {
    if (this.getOverallStatus().level === "exceeded") {
      this.toolCallsSinceExceeded++;
    }
  }

  /**
   * Returns true if hard enforcement should block the current tool call.
   * Allows `gracePeriodCalls` after exceeding before blocking.
   */
  isHardBlocked(gracePeriodCalls: number): boolean {
    return (
      this.getOverallStatus().level === "exceeded" && this.toolCallsSinceExceeded > gracePeriodCalls
    );
  }

  getToolCallsSinceExceeded(): number {
    return this.toolCallsSinceExceeded;
  }

  getPersistedSnapshot(): PersistedBudget {
    return { ...this.persisted };
  }

  getCallCount(): number {
    return this.callCount;
  }

  resetSession(): void {
    this.sessionCostUsd = 0;
    this.callCount = 0;
    this.toolCallsSinceExceeded = 0;
    this.tokenTotals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
    this.modelUsageMap.clear();
  }

  resetDaily(): void {
    this.persisted.dailyCostUsd = 0;
    const now = new Date();
    this.persisted.dailyDate = now.toISOString().slice(0, 10);
  }

  resetMonthly(): void {
    this.persisted.monthlyCostUsd = 0;
    const now = new Date();
    this.persisted.monthlyKey = now.toISOString().slice(0, 7);
  }

  updateLimit(scope: "session" | "daily" | "monthly", limitUsd: number): void {
    if (scope === "session") this.config.sessionLimitUsd = limitUsd;
    else if (scope === "daily") this.config.dailyLimitUsd = limitUsd;
    else if (scope === "monthly") this.config.monthlyLimitUsd = limitUsd;
  }

  private computeStatus(usedUsd: number, limitUsd?: number): BudgetStatus {
    if (limitUsd === undefined || limitUsd <= 0) {
      return { level: "ok", usedUsd };
    }
    const percent = usedUsd / limitUsd;
    if (percent >= 1) {
      return { level: "exceeded", usedUsd, limitUsd, percent };
    }
    if (percent >= this.config.warnThreshold) {
      return { level: "warn", usedUsd, limitUsd, percent };
    }
    return { level: "ok", usedUsd, limitUsd, percent };
  }
}

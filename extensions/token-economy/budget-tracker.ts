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

export type BudgetSummary = {
  session: BudgetStatus;
  daily: BudgetStatus;
  monthly: BudgetStatus;
  callCount: number;
  tokens: NormalizedUsage;
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

  constructor(
    private config: TokenBudgetConfig,
    private persisted: PersistedBudget,
  ) {}

  recordUsage(usage: NormalizedUsage, costConfig?: ModelCostConfig): void {
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

  getSummary(): BudgetSummary {
    return {
      session: this.getSessionStatus(),
      daily: this.getDailyStatus(),
      monthly: this.getMonthlyStatus(),
      callCount: this.callCount,
      tokens: { ...this.tokenTotals },
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

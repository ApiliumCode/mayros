/**
 * Rate Limiter
 *
 * Sliding window per-tool rate limiting combined with a global
 * token bucket for burst protection.
 */

import type { TomeruConfig } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type RateLimitCheck = {
  allowed: boolean;
  reason?: string;
  retryAfterMs?: number;
};

export type RateLimitStats = {
  totalChecks: number;
  totalRejected: number;
  perTool: Record<string, { calls: number; rejected: number }>;
  bucketTokens: number;
};

// ============================================================================
// ToolRateLimiter
// ============================================================================

export class ToolRateLimiter {
  private windows = new Map<string, number[]>(); // tool → timestamps
  private toolStats = new Map<string, { calls: number; rejected: number }>();
  private totalChecks = 0;
  private totalRejected = 0;

  // Token bucket state
  private bucketTokens: number;
  private lastRefillTime: number;

  constructor(private readonly config: TomeruConfig) {
    this.bucketTokens = config.burstLimit.maxCallsPerSecond;
    this.lastRefillTime = Date.now();
  }

  /**
   * Check if a tool call is allowed under rate limits.
   */
  check(toolName: string): RateLimitCheck {
    this.totalChecks++;

    // Exempt tools always pass
    if (this.config.exemptTools.includes(toolName)) {
      return { allowed: true };
    }

    // 1. Check sliding window for this tool
    const windowResult = this.checkSlidingWindow(toolName);
    if (!windowResult.allowed) {
      this.totalRejected++;
      this.recordRejection(toolName);
      return windowResult;
    }

    // 2. Check global token bucket
    const bucketResult = this.checkTokenBucket();
    if (!bucketResult.allowed) {
      this.totalRejected++;
      this.recordRejection(toolName);
      return bucketResult;
    }

    return { allowed: true };
  }

  /**
   * Record a tool call (call after check passes).
   */
  record(toolName: string): void {
    const now = Date.now();

    // Record in sliding window
    if (!this.windows.has(toolName)) {
      this.windows.set(toolName, []);
    }
    this.windows.get(toolName)!.push(now);

    // Consume bucket token
    this.refillBucket();
    this.bucketTokens = Math.max(0, this.bucketTokens - 1);

    // Update stats
    const stats = this.toolStats.get(toolName);
    if (stats) {
      stats.calls++;
    } else {
      this.toolStats.set(toolName, { calls: 1, rejected: 0 });
    }
  }

  /**
   * Get current rate limit statistics.
   */
  getStats(): RateLimitStats {
    this.refillBucket();
    const perTool: Record<string, { calls: number; rejected: number }> = {};
    for (const [tool, stats] of this.toolStats) {
      perTool[tool] = { ...stats };
    }
    return {
      totalChecks: this.totalChecks,
      totalRejected: this.totalRejected,
      perTool,
      bucketTokens: this.bucketTokens,
    };
  }

  /**
   * Reset all counters and windows.
   */
  reset(): void {
    this.windows.clear();
    this.toolStats.clear();
    this.totalChecks = 0;
    this.totalRejected = 0;
    this.bucketTokens = this.config.burstLimit.maxCallsPerSecond;
    this.lastRefillTime = Date.now();
  }

  // ---------- sliding window ----------

  private checkSlidingWindow(toolName: string): RateLimitCheck {
    const now = Date.now();
    const limit = this.config.perToolLimits[toolName] ?? this.config.defaultLimit;

    const window = this.windows.get(toolName);
    if (!window) return { allowed: true };

    // Prune expired timestamps
    const cutoff = now - limit.windowMs;
    while (window.length > 0 && window[0]! < cutoff) {
      window.shift();
    }

    if (window.length >= limit.maxCallsPerWindow) {
      const oldestInWindow = window[0]!;
      const retryAfterMs = oldestInWindow + limit.windowMs - now;
      return {
        allowed: false,
        reason: `Rate limit: ${toolName} exceeded ${limit.maxCallsPerWindow} calls in ${limit.windowMs}ms window`,
        retryAfterMs: Math.max(0, retryAfterMs),
      };
    }

    return { allowed: true };
  }

  // ---------- token bucket ----------

  private refillBucket(): void {
    const now = Date.now();
    const elapsedMs = now - this.lastRefillTime;
    const refill = (elapsedMs / 1000) * this.config.burstLimit.maxCallsPerSecond;
    this.bucketTokens = Math.min(
      this.config.burstLimit.maxCallsPerSecond,
      this.bucketTokens + refill,
    );
    this.lastRefillTime = now;
  }

  private checkTokenBucket(): RateLimitCheck {
    this.refillBucket();

    if (this.bucketTokens < 1) {
      const tokensNeeded = 1 - this.bucketTokens;
      const retryAfterMs = (tokensNeeded / this.config.burstLimit.maxCallsPerSecond) * 1000;
      return {
        allowed: false,
        reason: `Burst limit: global rate exceeds ${this.config.burstLimit.maxCallsPerSecond} calls/second`,
        retryAfterMs: Math.ceil(retryAfterMs),
      };
    }

    return { allowed: true };
  }

  // ---------- stats ----------

  private recordRejection(toolName: string): void {
    const stats = this.toolStats.get(toolName);
    if (stats) {
      stats.rejected++;
    } else {
      this.toolStats.set(toolName, { calls: 0, rejected: 1 });
    }
  }
}

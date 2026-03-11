/**
 * Loop Breaker
 *
 * Detects infinite tool call loops via identical-call sequences,
 * same-result repetition, and velocity circuit breaking.
 */

import { createHash } from "node:crypto";
import type { TomeruConfig } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type LoopCheckResult = {
  action: "allow" | "warn" | "block";
  message?: string;
};

type CallRecord = {
  toolName: string;
  paramsHash: string;
  resultHash?: string;
  timestamp: number;
};

// ============================================================================
// Helpers
// ============================================================================

function stableStringify(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  try {
    return JSON.stringify(value, Object.keys(value as object).sort());
  } catch {
    return String(value);
  }
}

function computeHash(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

// ============================================================================
// LoopBreaker
// ============================================================================

export class LoopBreaker {
  private buffer: CallRecord[] = [];
  private readonly maxBuffer = 50;
  private totalCallsThisMinute = 0;
  private minuteStart = Date.now();

  constructor(private readonly config: TomeruConfig) {}

  /**
   * Check before a tool call if it looks like a loop.
   */
  checkBeforeCall(toolName: string, params: unknown): LoopCheckResult {
    if (!this.config.loopBreaker.enabled) {
      return { action: "allow" };
    }

    const paramsHash = computeHash(toolName + stableStringify(params));

    // 1. Velocity circuit breaker
    const now = Date.now();
    if (now - this.minuteStart > 60_000) {
      this.totalCallsThisMinute = 0;
      this.minuteStart = now;
    }
    this.totalCallsThisMinute++;

    if (this.totalCallsThisMinute > this.config.loopBreaker.maxTotalCallsPerMinute) {
      return {
        action: "block",
        message: `Velocity circuit breaker: ${this.totalCallsThisMinute} total calls in the last minute exceeds limit of ${this.config.loopBreaker.maxTotalCallsPerMinute}`,
      };
    }

    // 2. Identical-call sequence detection
    let consecutiveIdentical = 0;
    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const record = this.buffer[i]!;
      if (record.paramsHash === paramsHash) {
        consecutiveIdentical++;
      } else {
        break;
      }
    }

    const maxIdentical = this.config.loopBreaker.maxIdenticalCalls;
    if (consecutiveIdentical >= maxIdentical) {
      return {
        action: "block",
        message: `Loop detected: ${toolName} called ${consecutiveIdentical} consecutive times with identical parameters (limit: ${maxIdentical})`,
      };
    }

    // Warn at 70% of limit
    const warnThreshold = Math.floor(maxIdentical * 0.7);
    if (consecutiveIdentical >= warnThreshold) {
      return {
        action: "warn",
        message: `Possible loop: ${toolName} called ${consecutiveIdentical}/${maxIdentical} times with identical parameters`,
      };
    }

    return { action: "allow" };
  }

  /**
   * Record a completed tool call for loop detection.
   */
  recordAfterCall(toolName: string, params: unknown, result: unknown): void {
    const paramsHash = computeHash(toolName + stableStringify(params));
    const resultHash = computeHash(stableStringify(result));

    this.buffer.push({
      toolName,
      paramsHash,
      resultHash,
      timestamp: Date.now(),
    });

    // Keep buffer bounded
    if (this.buffer.length > this.maxBuffer) {
      this.buffer.shift();
    }
  }

  /**
   * Check for same-result repetition (call after recording).
   * Returns a warning if the same tool produces identical results repeatedly.
   */
  checkSameResult(toolName: string): LoopCheckResult {
    if (!this.config.loopBreaker.enabled) {
      return { action: "allow" };
    }

    // Count consecutive identical results for this tool
    let consecutiveSameResult = 0;
    let lastResultHash: string | undefined;

    for (let i = this.buffer.length - 1; i >= 0; i--) {
      const record = this.buffer[i]!;
      if (record.toolName !== toolName) break;

      if (!lastResultHash) {
        lastResultHash = record.resultHash;
        consecutiveSameResult = 1;
      } else if (record.resultHash === lastResultHash) {
        consecutiveSameResult++;
      } else {
        break;
      }
    }

    const threshold = Math.floor(this.config.loopBreaker.maxIdenticalCalls * 0.5);
    if (consecutiveSameResult >= this.config.loopBreaker.maxIdenticalCalls) {
      return {
        action: "block",
        message: `Same-result loop: ${toolName} produced identical results ${consecutiveSameResult} times`,
      };
    }

    if (consecutiveSameResult >= threshold) {
      return {
        action: "warn",
        message: `${toolName} produced identical results ${consecutiveSameResult} times in a row`,
      };
    }

    return { action: "allow" };
  }

  /**
   * Get loop detection statistics.
   */
  getStats(): { bufferSize: number; totalCallsThisMinute: number } {
    return {
      bufferSize: this.buffer.length,
      totalCallsThisMinute: this.totalCallsThisMinute,
    };
  }

  /**
   * Reset state.
   */
  reset(): void {
    this.buffer = [];
    this.totalCallsThisMinute = 0;
    this.minuteStart = Date.now();
  }
}

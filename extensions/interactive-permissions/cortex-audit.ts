/**
 * Cortex Audit Trail.
 *
 * Records permission decisions in AIngle Cortex as RDF triples for
 * observability and compliance. Each decision is stored under a unique
 * subject with timestamp, tool name, risk level, and outcome.
 *
 * Falls back to in-memory storage when Cortex is unavailable.
 */

import { createHash } from "node:crypto";
import type { CortexClientLike } from "../shared/cortex-client.js";
import type { RiskLevel } from "./intent-classifier.js";

// ============================================================================
// Types
// ============================================================================

export type DecisionSource = "auto_safe" | "policy" | "user_prompt" | "deny_default";

export type PermissionDecision = {
  toolName: string;
  toolKind: string;
  command?: string;
  riskLevel: RiskLevel;
  allowed: boolean;
  decidedBy: DecisionSource;
  policyId?: string;
  sessionKey?: string;
  timestamp: string;
};

// ============================================================================
// Audit Trail
// ============================================================================

export class CortexAudit {
  private inMemory: PermissionDecision[] = [];
  private maxInMemory: number;

  constructor(
    private cortex: CortexClientLike | undefined,
    private ns: string,
    maxDecisions = 500,
  ) {
    this.maxInMemory = maxDecisions;
  }

  /**
   * Generate a short hash for a decision to use as a unique subject ID.
   */
  private hashDecision(decision: PermissionDecision): string {
    const data = `${decision.toolName}:${decision.command ?? ""}:${decision.timestamp}`;
    return createHash("sha256").update(data).digest("hex").slice(0, 12);
  }

  /**
   * Record a permission decision.
   * Writes to Cortex if available, otherwise stores in memory.
   */
  async recordDecision(decision: PermissionDecision): Promise<void> {
    // Always store in memory for quick access
    this.inMemory.push(decision);
    if (this.inMemory.length > this.maxInMemory) {
      this.inMemory.splice(0, this.inMemory.length - this.maxInMemory);
    }

    if (!this.cortex) return;

    const hash = this.hashDecision(decision);
    const subject = `${this.ns}:permission:decision:${hash}`;
    const prefix = `${this.ns}:permission`;

    try {
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:toolName`,
        object: decision.toolName,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:toolKind`,
        object: decision.toolKind,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:riskLevel`,
        object: decision.riskLevel,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:allowed`,
        object: decision.allowed,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:decidedBy`,
        object: decision.decidedBy,
      });
      await this.cortex.createTriple({
        subject,
        predicate: `${prefix}:timestamp`,
        object: decision.timestamp,
      });

      if (decision.command) {
        await this.cortex.createTriple({
          subject,
          predicate: `${prefix}:command`,
          object: decision.command,
        });
      }
      if (decision.policyId) {
        await this.cortex.createTriple({
          subject,
          predicate: `${prefix}:policyId`,
          object: decision.policyId,
        });
      }
      if (decision.sessionKey) {
        await this.cortex.createTriple({
          subject,
          predicate: `${prefix}:sessionKey`,
          object: decision.sessionKey,
        });
      }
    } catch {
      // Cortex write failure — decision is still in memory
    }
  }

  /**
   * Get recent decisions, newest first.
   * Uses in-memory cache for fast access.
   */
  async getRecentDecisions(limit = 20): Promise<PermissionDecision[]> {
    const capped = Math.min(limit, this.inMemory.length);
    return this.inMemory.slice(-capped).reverse();
  }

  /**
   * Get all in-memory decisions.
   */
  get decisions(): ReadonlyArray<PermissionDecision> {
    return this.inMemory;
  }

  /**
   * Number of stored decisions.
   */
  get size(): number {
    return this.inMemory.length;
  }
}

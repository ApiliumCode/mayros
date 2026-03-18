/**
 * Task Router (Miteru)
 *
 * Q-Learning based routing of tasks to agents. Learns which agent
 * handles which type of task best based on performance history.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import type { PerformanceTracker } from "./performance-tracker.js";
import type { LearningProfileManager } from "../kaneru/learning-profiles.js";
import {
  classifyTask as sharedClassifyTask,
  type TaskClassification,
} from "../shared/task-classification.js";

export type RoutingDecision = {
  routingId: string;
  agentId: string;
  stateKey: string;
  confidence: number;
  reason: string;
};

export type RoutingReward = {
  completion: number; // 0.35 weight
  quality: number; // 0.30 weight
  costEfficiency: number; // 0.20 weight
  speed: number; // 0.15 weight
  total: number;
};

type QTableMap = Map<string, Map<string, number>>;

// ============================================================================
// Constants
// ============================================================================

const ALPHA = 0.1;
const GAMMA = 0.9;
const EPSILON_INIT = 0.15;
const EPSILON_DECAY = 0.995;
const EPSILON_MIN = 0.05;
const CORTEX_PREFIX = "miteru:qtable:";

// Re-export TaskClassification for consumers that import from this module
export type { TaskClassification } from "../shared/task-classification.js";

// ============================================================================
// TaskRouter
// ============================================================================

export class TaskRouter {
  private qTable: QTableMap = new Map();
  private epsilon = EPSILON_INIT;
  private pendingDecisions = new Map<string, { stateKey: string; agentId: string }>();

  private learningProfiles: LearningProfileManager | null = null;

  constructor(
    private readonly client: CortexClient | null,
    private readonly ns: string,
    private readonly perfTracker: PerformanceTracker,
  ) {}

  /** Attach learning profiles for expertise-blended routing. */
  setLearningProfiles(profiles: LearningProfileManager): void {
    this.learningProfiles = profiles;
  }

  /**
   * Classify a task description into structured classification.
   * Delegates to shared task-classification module.
   */
  classifyTask(description: string, path?: string): TaskClassification {
    return sharedClassifyTask(description, path);
  }

  /**
   * Select the best agent for a task using Q-Learning.
   * Falls back to the first available agent if Q-table is empty.
   */
  async selectAgent(
    description: string,
    available: string[],
    path?: string,
    override?: string,
  ): Promise<RoutingDecision> {
    const routingId = randomUUID().slice(0, 8);

    // Explicit override
    if (override && available.includes(override)) {
      return {
        routingId,
        agentId: override,
        stateKey: "",
        confidence: 1.0,
        reason: `Explicit override: ${override}`,
      };
    }

    if (available.length === 0) {
      throw new Error("No available agents for routing");
    }

    if (available.length === 1) {
      return {
        routingId,
        agentId: available[0]!,
        stateKey: "",
        confidence: 1.0,
        reason: "Only one agent available",
      };
    }

    const classification = this.classifyTask(description, path);
    const stateKey = `${classification.taskType}:${classification.complexity}:${classification.domain}`;

    // Epsilon-greedy
    let agentId: string;
    let confidence: number;
    let reason: string;

    if (Math.random() < this.epsilon) {
      // Exploration
      agentId = available[Math.floor(Math.random() * available.length)]!;
      confidence = 0.5;
      reason = `Exploration (ε=${this.epsilon.toFixed(3)})`;
    } else {
      // Exploitation: blend Q-values with learning profile expertise
      const stateActions = this.qTable.get(stateKey);
      if (!stateActions || stateActions.size === 0) {
        // No Q-values: use expertise + EMA score
        let bestAgent = available[0]!;
        let bestScore = -Infinity;
        for (const a of available) {
          const perfScore = await this.perfTracker.getScore(a);
          const expertise = this.learningProfiles
            ? await this.learningProfiles.getExpertise(a, classification.domain, classification.taskType)
            : 0.5;
          // Blend: 40% performance EMA + 60% learned expertise
          const blended = 0.4 * perfScore + 0.6 * expertise;
          if (blended > bestScore) {
            bestScore = blended;
            bestAgent = a;
          }
        }
        agentId = bestAgent;
        confidence = 0.6;
        reason = this.learningProfiles
          ? `Expertise-based (no Q-data for ${stateKey}, score=${bestScore.toFixed(3)})`
          : `Performance-based (no Q-data for ${stateKey})`;
      } else {
        // Blend Q-value with expertise from learning profiles
        let bestAgent = available[0]!;
        let bestBlended = -Infinity;
        let bestQ = 0;
        for (const a of available) {
          const q = stateActions.get(a) ?? 0;
          const expertise = this.learningProfiles
            ? await this.learningProfiles.getExpertise(a, classification.domain, classification.taskType)
            : 0.5;
          // Normalize Q-value to 0-1 range (sigmoid-like: q / (1 + |q|))
          const qNorm = q / (1 + Math.abs(q));
          // Blend: 60% Q-value + 40% expertise
          const blended = 0.6 * qNorm + 0.4 * expertise;
          if (blended > bestBlended) {
            bestBlended = blended;
            bestAgent = a;
            bestQ = q;
          }
        }
        agentId = bestAgent;
        confidence = Math.min(1.0, 0.7 + bestQ * 0.1);
        reason = this.learningProfiles
          ? `Blended Q=${bestQ.toFixed(3)} + expertise (score=${bestBlended.toFixed(3)}) for ${stateKey}`
          : `Q-value ${bestQ.toFixed(3)} for state ${stateKey}`;
      }
    }

    this.pendingDecisions.set(routingId, { stateKey, agentId });

    return { routingId, agentId, stateKey, confidence, reason };
  }

  /**
   * Record reward for a completed routing decision.
   */
  async recordReward(routingId: string, reward: RoutingReward): Promise<void> {
    const decision = this.pendingDecisions.get(routingId);
    if (!decision) return;
    this.pendingDecisions.delete(routingId);

    const { stateKey, agentId } = decision;
    if (!stateKey) return; // was an override

    // Q-Learning update
    const currentQ = this.getQ(stateKey, agentId);
    const maxNextQ = this.maxQ(stateKey);
    const newQ = currentQ + ALPHA * (reward.total + GAMMA * maxNextQ - currentQ);
    this.setQ(stateKey, agentId, newQ);

    // Decay epsilon
    this.epsilon = Math.max(EPSILON_MIN, this.epsilon * EPSILON_DECAY);

    // Persist to Cortex
    await this.persistQValue(stateKey, agentId, newQ);
  }

  /**
   * Compute a reward signal from task outcome.
   */
  computeReward(outcome: {
    completed: boolean;
    findings: number;
    conflicts: number;
    durationMs: number;
    costUsd: number;
  }): RoutingReward {
    const completion = outcome.completed ? 1.0 : 0.0;
    const quality = Math.min(1.0, outcome.findings * 0.1) - Math.min(0.5, outcome.conflicts * 0.1);
    const costEfficiency = Math.max(0, 1.0 - outcome.costUsd * 2);
    const speed = Math.max(0, 1.0 - outcome.durationMs / 300_000); // 5 min baseline

    const total = completion * 0.35 + quality * 0.3 + costEfficiency * 0.2 + speed * 0.15;

    return { completion, quality, costEfficiency, speed, total };
  }

  /**
   * Load Q-table from Cortex.
   */
  async loadFromCortex(): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.patternQuery({
        predicate: `${this.ns}:${CORTEX_PREFIX}`,
        limit: 5000,
      });

      // Also try listing triples with subject prefix
      const listResult = await this.client.listTriples({
        subject: `${this.ns}:${CORTEX_PREFIX}`,
        limit: 5000,
      });

      for (const triple of [...(result.matches ?? []), ...listResult.triples]) {
        const subject = String(triple.subject);
        const prefix = `${this.ns}:${CORTEX_PREFIX}`;
        if (!subject.startsWith(prefix)) continue;

        const stateKey = subject.slice(prefix.length);
        const pred = String(triple.predicate);
        const agentPrefix = `${this.ns}:miteru:q:`;
        if (!pred.startsWith(agentPrefix)) continue;

        const agentId = pred.slice(agentPrefix.length);
        const value =
          typeof triple.object === "object" && triple.object !== null && "node" in triple.object
            ? Number((triple.object as { node: string }).node)
            : Number(triple.object);

        if (!isNaN(value)) {
          this.setQ(stateKey, agentId, value);
        }
      }
    } catch {
      // best-effort
    }
  }

  /**
   * Get the current epsilon value.
   */
  getEpsilon(): number {
    return this.epsilon;
  }

  /**
   * Get Q-table size.
   */
  size(): number {
    let count = 0;
    for (const actions of this.qTable.values()) {
      count += actions.size;
    }
    return count;
  }

  /** Export Q-table entries for dashboard visualization. */
  getRouteTable(): Array<{ stateKey: string; agentId: string; qValue: number }> {
    const entries: Array<{ stateKey: string; agentId: string; qValue: number }> = [];
    for (const [stateKey, actions] of this.qTable) {
      for (const [agentId, qValue] of actions) {
        entries.push({ stateKey, agentId, qValue });
      }
    }
    return entries;
  }

  // ---------- Q-table operations ----------

  private getQ(state: string, action: string): number {
    return this.qTable.get(state)?.get(action) ?? 0;
  }

  private setQ(state: string, action: string, value: number): void {
    if (!this.qTable.has(state)) {
      this.qTable.set(state, new Map());
    }
    this.qTable.get(state)!.set(action, value);
  }

  private maxQ(state: string): number {
    const actions = this.qTable.get(state);
    if (!actions || actions.size === 0) return 0;
    let max = -Infinity;
    for (const v of actions.values()) {
      if (v > max) max = v;
    }
    return max;
  }

  private async persistQValue(stateKey: string, agentId: string, value: number): Promise<void> {
    if (!this.client) return;

    try {
      const subject = `${this.ns}:${CORTEX_PREFIX}${stateKey}`;
      const predicate = `${this.ns}:miteru:q:${agentId}`;

      // Delete existing
      const existing = await this.client.listTriples({ subject, predicate, limit: 1 });
      for (const t of existing.triples) {
        if (t.id) await this.client.deleteTriple(t.id);
      }

      await this.client.createTriple({
        subject,
        predicate,
        object: String(value),
      });
    } catch {
      // best-effort
    }
  }
}

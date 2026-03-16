/**
 * Task Router (Miteru)
 *
 * Q-Learning based routing of tasks to agents. Learns which agent
 * handles which type of task best based on performance history.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import type { PerformanceTracker } from "./performance-tracker.js";

// ============================================================================
// Types
// ============================================================================

export type TaskClassification = {
  taskType: string; // e.g., "code-review", "security-scan", "implementation"
  complexity: "low" | "medium" | "high";
  domain: string; // e.g., "typescript", "python", "general"
};

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

// ============================================================================
// Task classification helpers
// ============================================================================

const TASK_TYPE_KEYWORDS: Record<string, string[]> = {
  "code-review": ["review", "check", "lint", "inspect"],
  "security-scan": ["security", "vulnerability", "cve", "audit", "pentest"],
  implementation: ["implement", "build", "create", "add", "feature"],
  refactoring: ["refactor", "clean", "simplify", "restructure"],
  testing: ["test", "spec", "coverage", "assertion"],
  documentation: ["document", "docs", "readme", "explain"],
  debugging: ["debug", "fix", "bug", "error", "crash"],
  analysis: ["analyze", "report", "benchmark", "profile"],
};

const DOMAIN_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx", ".mjs"],
  python: [".py"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
};

function detectTaskType(description: string): string {
  const lower = description.toLowerCase();
  let bestType = "general";
  let bestScore = 0;

  for (const [type, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

function detectComplexity(description: string): "low" | "medium" | "high" {
  const words = description.split(/\s+/).length;
  const hasScope = /\b(all|entire|full|complete|whole)\b/i.test(description);
  const hasMultiple = /\b(multiple|several|many|each|every)\b/i.test(description);

  if (words > 100 || (hasScope && hasMultiple)) return "high";
  if (words > 30 || hasScope || hasMultiple) return "medium";
  return "low";
}

function detectDomain(description: string, path?: string): string {
  // Check path first
  if (path) {
    for (const [domain, exts] of Object.entries(DOMAIN_EXTENSIONS)) {
      for (const ext of exts) {
        if (path.endsWith(ext)) return domain;
      }
    }
  }

  // Check description keywords
  const lower = description.toLowerCase();
  for (const domain of Object.keys(DOMAIN_EXTENSIONS)) {
    if (lower.includes(domain)) return domain;
  }

  return "general";
}

// ============================================================================
// TaskRouter
// ============================================================================

export class TaskRouter {
  private qTable: QTableMap = new Map();
  private epsilon = EPSILON_INIT;
  private pendingDecisions = new Map<string, { stateKey: string; agentId: string }>();

  constructor(
    private readonly client: CortexClient | null,
    private readonly ns: string,
    private readonly perfTracker: PerformanceTracker,
  ) {}

  /**
   * Classify a task description into structured classification.
   */
  classifyTask(description: string, path?: string): TaskClassification {
    return {
      taskType: detectTaskType(description),
      complexity: detectComplexity(description),
      domain: detectDomain(description, path),
    };
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
      // Exploitation
      const stateActions = this.qTable.get(stateKey);
      if (!stateActions || stateActions.size === 0) {
        // No Q-values: prefer agent with best EMA score
        let bestAgent = available[0]!;
        let bestScore = -Infinity;
        for (const a of available) {
          const score = await this.perfTracker.getScore(a);
          if (score > bestScore) {
            bestScore = score;
            bestAgent = a;
          }
        }
        agentId = bestAgent;
        confidence = 0.6;
        reason = `Performance-based (no Q-data for ${stateKey})`;
      } else {
        let bestAgent = available[0]!;
        let bestQ = -Infinity;
        for (const a of available) {
          const q = stateActions.get(a) ?? 0;
          if (q > bestQ) {
            bestQ = q;
            bestAgent = a;
          }
        }
        agentId = bestAgent;
        confidence = Math.min(1.0, 0.7 + bestQ * 0.1);
        reason = `Q-value ${bestQ.toFixed(3)} for state ${stateKey}`;
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

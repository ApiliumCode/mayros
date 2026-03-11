/**
 * Q-Learning Engine for Eruberu
 *
 * Tabular Q-Learning with epsilon-greedy exploration.
 * State: (taskType, budgetLevel, timeSlot)
 * Action: (strategy, provider?) — e.g., "cost-optimized:", "capability:anthropic"
 */

import type { QLearningConfig } from "./config.js";
import type { TaskType, BudgetLevel, TimeSlot } from "./task-classifier.js";

// ============================================================================
// Types
// ============================================================================

export type QState = {
  taskType: TaskType;
  budgetLevel: BudgetLevel;
  timeSlot: TimeSlot;
};

export type QAction = string; // e.g., "cost-optimized:", "capability:anthropic"

export type RewardSignal = {
  success: number; // +1.0 or -1.0
  costEfficiency: number; // 0 to +0.5
  qualityProxy: number; // 0 to +0.3
  latencyPenalty: number; // 0 or -0.2
  rateLimitPenalty: number; // 0 or -0.8
};

export type QTableData = Record<string, Record<string, number>>;

// ============================================================================
// Helpers
// ============================================================================

export function stateKey(state: QState): string {
  return `${state.taskType}:${state.budgetLevel}:${state.timeSlot}`;
}

export function computeReward(signal: RewardSignal): number {
  return (
    signal.success +
    signal.costEfficiency +
    signal.qualityProxy +
    signal.latencyPenalty +
    signal.rateLimitPenalty
  );
}

// ============================================================================
// Q-Table
// ============================================================================

export class QTable {
  private table: Map<string, Map<string, number>> = new Map();
  private epsilon: number;
  private readonly alpha: number;
  private readonly gamma: number;
  private readonly epsilonDecay: number;
  private readonly minEpsilon: number;

  constructor(config: QLearningConfig) {
    this.alpha = config.alpha;
    this.gamma = config.gamma;
    this.epsilon = config.epsilon;
    this.epsilonDecay = config.epsilonDecay;
    this.minEpsilon = config.minEpsilon;
  }

  /**
   * Get Q-value for a state-action pair. Returns 0 if unseen.
   */
  getQ(state: string, action: string): number {
    return this.table.get(state)?.get(action) ?? 0;
  }

  /**
   * Set Q-value for a state-action pair.
   */
  setQ(state: string, action: string, value: number): void {
    if (!this.table.has(state)) {
      this.table.set(state, new Map());
    }
    this.table.get(state)!.set(action, value);
  }

  /**
   * Get all Q-values for a state as { action: qValue }.
   */
  getStateActions(state: string): Map<string, number> {
    return this.table.get(state) ?? new Map();
  }

  /**
   * Get the max Q-value across all actions for a state.
   */
  maxQ(state: string): number {
    const actions = this.table.get(state);
    if (!actions || actions.size === 0) return 0;
    let max = -Infinity;
    for (const v of actions.values()) {
      if (v > max) max = v;
    }
    return max;
  }

  /**
   * Epsilon-greedy action selection.
   * Returns the chosen action, or null if no actions are known.
   */
  selectAction(state: string, availableActions: string[]): string | null {
    if (availableActions.length === 0) return null;

    // Exploration: random action
    if (Math.random() < this.epsilon) {
      return availableActions[Math.floor(Math.random() * availableActions.length)]!;
    }

    // Exploitation: best known Q-value
    let bestAction = availableActions[0]!;
    let bestQ = -Infinity;

    for (const action of availableActions) {
      const q = this.getQ(state, action);
      if (q > bestQ) {
        bestQ = q;
        bestAction = action;
      }
    }

    return bestAction;
  }

  /**
   * Q-Learning update: Q(s,a) += α(r + γ·max Q(s',a') - Q(s,a))
   */
  update(state: string, action: string, reward: number, nextState: string): void {
    const currentQ = this.getQ(state, action);
    const maxNextQ = this.maxQ(nextState);
    const newQ = currentQ + this.alpha * (reward + this.gamma * maxNextQ - currentQ);
    this.setQ(state, action, newQ);

    // Decay epsilon
    this.epsilon = Math.max(this.minEpsilon, this.epsilon * this.epsilonDecay);
  }

  /**
   * Get current epsilon value.
   */
  getEpsilon(): number {
    return this.epsilon;
  }

  /**
   * Get total number of state-action entries.
   */
  size(): number {
    let count = 0;
    for (const actions of this.table.values()) {
      count += actions.size;
    }
    return count;
  }

  /**
   * Export Q-table as serializable data.
   */
  export(): QTableData {
    const data: QTableData = {};
    for (const [state, actions] of this.table) {
      data[state] = {};
      for (const [action, value] of actions) {
        data[state]![action] = value;
      }
    }
    return data;
  }

  /**
   * Import Q-table from serialized data.
   */
  import(data: QTableData): void {
    this.table.clear();
    for (const [state, actions] of Object.entries(data)) {
      const actionMap = new Map<string, number>();
      for (const [action, value] of Object.entries(actions)) {
        actionMap.set(action, value);
      }
      this.table.set(state, actionMap);
    }
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.table.clear();
  }
}

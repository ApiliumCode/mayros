/**
 * Eruberu Configuration
 *
 * Parsing and defaults for the intelligent model routing plugin.
 */

import type { ModelRoutingStrategy } from "../../src/routing/model-router.js";

export type QLearningConfig = {
  alpha: number;
  gamma: number;
  epsilon: number;
  epsilonDecay: number;
  minEpsilon: number;
};

export type EruberuConfig = {
  enabled: boolean;
  strategy: "auto" | ModelRoutingStrategy;
  budgetDrivenFallback: boolean;
  budgetWarnThreshold: number;
  budgetCriticalThreshold: number;
  qLearning: QLearningConfig;
  persistPath: string;
  cortexPersist: boolean;
};

const DEFAULT_ALPHA = 0.1;
const DEFAULT_GAMMA = 0.9;
const DEFAULT_EPSILON = 0.15;
const DEFAULT_EPSILON_DECAY = 0.995;
const DEFAULT_MIN_EPSILON = 0.05;
const DEFAULT_PERSIST_PATH = "~/.mayros/eruberu-qtable.json";

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

function parseQLearningConfig(raw: unknown): QLearningConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      alpha: DEFAULT_ALPHA,
      gamma: DEFAULT_GAMMA,
      epsilon: DEFAULT_EPSILON,
      epsilonDecay: DEFAULT_EPSILON_DECAY,
      minEpsilon: DEFAULT_MIN_EPSILON,
    };
  }
  const c = raw as Record<string, unknown>;
  assertAllowedKeys(
    c,
    ["alpha", "gamma", "epsilon", "epsilonDecay", "minEpsilon"],
    "qLearning config",
  );

  return {
    alpha: typeof c.alpha === "number" && c.alpha > 0 && c.alpha <= 1 ? c.alpha : DEFAULT_ALPHA,
    gamma: typeof c.gamma === "number" && c.gamma >= 0 && c.gamma <= 1 ? c.gamma : DEFAULT_GAMMA,
    epsilon:
      typeof c.epsilon === "number" && c.epsilon >= 0 && c.epsilon <= 1
        ? c.epsilon
        : DEFAULT_EPSILON,
    epsilonDecay:
      typeof c.epsilonDecay === "number" && c.epsilonDecay > 0 && c.epsilonDecay <= 1
        ? c.epsilonDecay
        : DEFAULT_EPSILON_DECAY,
    minEpsilon:
      typeof c.minEpsilon === "number" && c.minEpsilon >= 0 && c.minEpsilon <= 1
        ? c.minEpsilon
        : DEFAULT_MIN_EPSILON,
  };
}

export function parseEruberuConfig(raw: unknown): EruberuConfig {
  const cfg = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;

  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      cfg,
      [
        "enabled",
        "strategy",
        "budgetDrivenFallback",
        "budgetWarnThreshold",
        "budgetCriticalThreshold",
        "qLearning",
        "persistPath",
        "cortexPersist",
      ],
      "eruberu config",
    );
  }

  const validStrategies = ["auto", "default", "fallback", "cost-optimized", "capability"];
  const strategy =
    typeof cfg.strategy === "string" && validStrategies.includes(cfg.strategy)
      ? (cfg.strategy as "auto" | ModelRoutingStrategy)
      : ("auto" as const);

  const budgetWarnThreshold =
    typeof cfg.budgetWarnThreshold === "number" &&
    cfg.budgetWarnThreshold > 0 &&
    cfg.budgetWarnThreshold <= 1
      ? cfg.budgetWarnThreshold
      : 0.8;

  const budgetCriticalThreshold =
    typeof cfg.budgetCriticalThreshold === "number" &&
    cfg.budgetCriticalThreshold > 0 &&
    cfg.budgetCriticalThreshold <= 1
      ? cfg.budgetCriticalThreshold
      : 0.95;

  return {
    enabled: cfg.enabled !== false,
    strategy,
    budgetDrivenFallback: cfg.budgetDrivenFallback !== false,
    budgetWarnThreshold,
    budgetCriticalThreshold,
    qLearning: parseQLearningConfig(cfg.qLearning),
    persistPath:
      typeof cfg.persistPath === "string" && cfg.persistPath.length > 0
        ? cfg.persistPath
        : DEFAULT_PERSIST_PATH,
    cortexPersist: cfg.cortexPersist !== false,
  };
}

export const eruberuConfigSchema = {
  parse: (value: unknown) => parseEruberuConfig(value),
  uiHints: {
    enabled: {
      label: "Enable Eruberu",
      help: "Enable intelligent model routing (no-op if only 1 provider configured)",
    },
    strategy: {
      label: "Routing Strategy",
      placeholder: "auto",
      help: "auto = Q-Learning adaptive, or fixed: default, fallback, cost-optimized, capability",
    },
    budgetDrivenFallback: {
      label: "Budget-Driven Fallback",
      help: "Automatically switch to cheaper models when budget is running low",
    },
    budgetWarnThreshold: {
      label: "Budget Warn Threshold",
      placeholder: "0.8",
      advanced: true,
      help: "Budget usage fraction (0-1) that triggers cost-optimized routing",
    },
    budgetCriticalThreshold: {
      label: "Budget Critical Threshold",
      placeholder: "0.95",
      advanced: true,
      help: "Budget usage fraction (0-1) that forces cheapest model",
    },
    "qLearning.alpha": {
      label: "Learning Rate (α)",
      placeholder: "0.1",
      advanced: true,
    },
    "qLearning.gamma": {
      label: "Discount Factor (γ)",
      placeholder: "0.9",
      advanced: true,
    },
    "qLearning.epsilon": {
      label: "Exploration Rate (ε)",
      placeholder: "0.15",
      advanced: true,
    },
  },
};

/**
 * Budget Bridge
 *
 * Symbol-based bridge that exposes the BudgetTracker from token-economy
 * to other plugins (e.g., Eruberu) without tight coupling.
 * Follows the same pattern as cortex-lifecycle-registry.ts.
 */

import type { BudgetTracker } from "../token-economy/budget-tracker.js";

const BUDGET_BRIDGE_KEY = Symbol.for("mayros.budget.bridge");

type GlobalWithBudget = typeof globalThis & {
  [BUDGET_BRIDGE_KEY]?: BudgetTracker | null;
};

/**
 * Register the active BudgetTracker. Called by token-economy on session_start.
 */
export function setBudgetBridge(tracker: BudgetTracker): void {
  (globalThis as GlobalWithBudget)[BUDGET_BRIDGE_KEY] = tracker;
}

/**
 * Retrieve the active BudgetTracker, or null if token-economy is not loaded.
 */
export function getBudgetBridge(): BudgetTracker | null {
  return (globalThis as GlobalWithBudget)[BUDGET_BRIDGE_KEY] ?? null;
}

/**
 * Clear the bridge. Called by token-economy on session_end.
 */
export function clearBudgetBridge(): void {
  (globalThis as GlobalWithBudget)[BUDGET_BRIDGE_KEY] = null;
}

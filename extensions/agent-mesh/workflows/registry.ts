/**
 * Workflow Registry
 *
 * Central registry for workflow definitions.
 * Ships with 3 built-in workflows and supports runtime registration.
 */

import type { WorkflowDefinition } from "./types.js";
import { codeReviewWorkflow } from "./code-review.js";
import { featureDevWorkflow } from "./feature-dev.js";
import { securityReviewWorkflow } from "./security-review.js";

// ============================================================================
// Registry
// ============================================================================

const workflows = new Map<string, WorkflowDefinition>();

// Register built-in workflows
workflows.set(codeReviewWorkflow.name, codeReviewWorkflow);
workflows.set(featureDevWorkflow.name, featureDevWorkflow);
workflows.set(securityReviewWorkflow.name, securityReviewWorkflow);

/**
 * Get a workflow definition by name.
 */
export function getWorkflow(name: string): WorkflowDefinition | undefined {
  return workflows.get(name);
}

/**
 * List all registered workflow definitions.
 */
export function listWorkflows(): WorkflowDefinition[] {
  return [...workflows.values()];
}

/**
 * Register a custom workflow definition.
 * Throws if a workflow with the same name already exists.
 */
export function registerWorkflow(definition: WorkflowDefinition): void {
  if (!definition.name || typeof definition.name !== "string") {
    throw new Error("Workflow definition must have a non-empty name");
  }
  if (!definition.phases || definition.phases.length === 0) {
    throw new Error("Workflow definition must have at least one phase");
  }
  if (workflows.has(definition.name)) {
    throw new Error(`Workflow "${definition.name}" is already registered`);
  }
  workflows.set(definition.name, definition);
}

/**
 * Unregister a workflow definition by name.
 * Returns true if the workflow was found and removed.
 */
export function unregisterWorkflow(name: string): boolean {
  return workflows.delete(name);
}

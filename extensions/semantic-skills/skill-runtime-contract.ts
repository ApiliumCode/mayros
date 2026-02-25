/**
 * Semantic Skill Runtime Contract
 *
 * Defines the lifecycle interface that skill.ts files can implement
 * for activation, deactivation, query enrichment, and error handling.
 */

import type { CortexClientLike } from "../shared/cortex-client.js";

// ============================================================================
// Context types passed to lifecycle hooks
// ============================================================================

export type SkillActivateContext = {
  namespace: string;
  agentId: string;
  sessionId?: string;
  graphClient: CortexClientLike;
  logger: {
    info: (message: string) => void;
    warn: (message: string) => void;
    error: (message: string) => void;
  };
};

export type SkillDeactivateContext = {
  namespace: string;
  agentId: string;
  reason: "session_end" | "reload" | "unload";
};

export type SkillQueryContext = {
  namespace: string;
  agentId: string;
  predicate: string;
  scope: "agent" | "namespace" | "global";
  results: Array<{ subject: string; object: unknown }>;
};

export type SkillQueryResult = {
  results?: Array<{ subject: string; object: unknown }>;
  additionalContext?: string;
};

export type SkillErrorContext = {
  namespace: string;
  agentId: string;
  error: Error;
  operation: string;
};

// ============================================================================
// Runtime interface
// ============================================================================

export type SkillRuntime = {
  name: string;
  onActivate?(ctx: SkillActivateContext): void | Promise<void>;
  onDeactivate?(ctx: SkillDeactivateContext): void | Promise<void>;
  onQuery?(ctx: SkillQueryContext): SkillQueryResult | Promise<SkillQueryResult>;
  onError?(ctx: SkillErrorContext): void | Promise<void>;
};

// ============================================================================
// Type guard
// ============================================================================

export function isSkillRuntime(mod: unknown): mod is SkillRuntime {
  if (!mod || typeof mod !== "object") return false;
  const obj = mod as Record<string, unknown>;
  if (typeof obj.name !== "string" || obj.name.length === 0) return false;
  if (obj.onActivate !== undefined && typeof obj.onActivate !== "function") return false;
  if (obj.onDeactivate !== undefined && typeof obj.onDeactivate !== "function") return false;
  if (obj.onQuery !== undefined && typeof obj.onQuery !== "function") return false;
  if (obj.onError !== undefined && typeof obj.onError !== "function") return false;
  return true;
}

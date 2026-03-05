/**
 * Workflow Types
 *
 * Shared types for multi-agent workflow orchestration.
 */

import type { MergeStrategy, FusionReport } from "../mesh-protocol.js";

// ============================================================================
// Agent Role
// ============================================================================

export type AgentRole = {
  agentId: string;
  role: string;
  task: string;
};

// ============================================================================
// Workflow Phase
// ============================================================================

export type WorkflowPhase = {
  name: string;
  description: string;
  agents: AgentRole[];
  strategy: MergeStrategy;
  parallel: boolean;
};

// ============================================================================
// Workflow Definition
// ============================================================================

export type WorkflowDefinition = {
  name: string;
  description: string;
  phases: WorkflowPhase[];
  defaultStrategy: MergeStrategy;
};

// ============================================================================
// Workflow Entry (runtime state)
// ============================================================================

export type WorkflowState = "pending" | "running" | "merging" | "completed" | "failed";

export type WorkflowEntry = {
  id: string;
  name: string;
  definition: string;
  state: WorkflowState;
  currentPhase: string;
  teamId: string;
  path: string;
  config: Record<string, unknown>;
  phases: WorkflowPhase[];
  phaseResults: Record<string, PhaseResult>;
  createdAt: string;
  updatedAt: string;
  result?: WorkflowResult;
};

// ============================================================================
// Phase Result
// ============================================================================

export type PhaseResult = {
  phase: string;
  status: "completed" | "failed";
  agentResults: Array<{ agentId: string; role: string; findings: number }>;
  conflicts: number;
  duration: number;
  completedAt: string;
};

// ============================================================================
// Workflow Result
// ============================================================================

export type WorkflowResult = {
  summary: string;
  totalPhases: number;
  completedPhases: number;
  totalAgents: number;
  totalFindings: number;
  totalConflicts: number;
  duration: number;
  phaseResults: PhaseResult[];
  fusionReport?: FusionReport;
};

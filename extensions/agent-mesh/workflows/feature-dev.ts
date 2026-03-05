/**
 * Feature Development Workflow
 *
 * Four sequential phases: explore → design → review → implement.
 * Each phase builds on the previous one's output.
 */

import type { WorkflowDefinition } from "./types.js";

export const featureDevWorkflow: WorkflowDefinition = {
  name: "feature-dev",
  description: "Multi-phase feature development: explore → design → review → implement",
  defaultStrategy: "additive",
  phases: [
    {
      name: "explore",
      description: "Explore the codebase to understand existing patterns and architecture",
      parallel: false,
      strategy: "additive",
      agents: [
        {
          agentId: "explorer",
          role: "explorer",
          task: "Explore ${path} and its dependencies: understand the architecture, identify relevant files, document existing patterns and conventions",
        },
      ],
    },
    {
      name: "design",
      description: "Design the implementation approach based on exploration findings",
      parallel: false,
      strategy: "additive",
      agents: [
        {
          agentId: "architect",
          role: "architect",
          task: "Design the implementation plan for ${path}: propose file changes, define interfaces, consider edge cases, identify risks",
        },
      ],
    },
    {
      name: "review",
      description: "Review the design with parallel security and quality checks",
      parallel: true,
      strategy: "conflict-flag",
      agents: [
        {
          agentId: "security-reviewer",
          role: "security",
          task: "Review the proposed design for ${path}: check for security implications, validate input handling, verify authorization model",
        },
        {
          agentId: "quality-reviewer",
          role: "quality",
          task: "Review the proposed design for ${path}: check naming conventions, test strategy, API consistency, error handling patterns",
        },
      ],
    },
    {
      name: "implement",
      description: "Implement the approved design",
      parallel: false,
      strategy: "additive",
      agents: [
        {
          agentId: "implementer",
          role: "implementer",
          task: "Implement the approved design for ${path}: write code, add tests, update documentation as needed",
        },
      ],
    },
  ],
};

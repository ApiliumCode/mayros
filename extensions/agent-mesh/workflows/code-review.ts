/**
 * Code Review Workflow
 *
 * Single-phase parallel workflow with 4 specialized agents:
 * security, tests, types, and simplification review.
 * Uses additive merge to combine all findings.
 */

import type { WorkflowDefinition } from "./types.js";

export const codeReviewWorkflow: WorkflowDefinition = {
  name: "code-review",
  description: "Multi-agent code review with security, tests, types, and simplification analysis",
  defaultStrategy: "additive",
  phases: [
    {
      name: "review",
      description: "Parallel code review by specialized agents",
      parallel: true,
      strategy: "additive",
      agents: [
        {
          agentId: "security-reviewer",
          role: "security",
          task: "Review ${path} for security vulnerabilities: injection, XSS, CSRF, sensitive data exposure, authentication/authorization issues",
        },
        {
          agentId: "test-reviewer",
          role: "tests",
          task: "Review ${path} for test coverage gaps: missing edge cases, untested error paths, missing integration tests, assertion quality",
        },
        {
          agentId: "type-reviewer",
          role: "types",
          task: "Review ${path} for type safety: any usage, missing generics, loose type assertions, incorrect narrowing, missing return types",
        },
        {
          agentId: "simplification-reviewer",
          role: "simplification",
          task: "Review ${path} for complexity: dead code, unnecessary abstractions, over-engineering, duplicate logic, unclear naming",
        },
      ],
    },
  ],
};

/**
 * Security Review Workflow
 *
 * Single-phase parallel workflow with 2 specialized security agents:
 * static analysis and semantic security scanning.
 * Uses additive merge to combine all findings.
 */

import type { WorkflowDefinition } from "./types.js";

export const securityReviewWorkflow: WorkflowDefinition = {
  name: "security-review",
  description: "Parallel security review with static and semantic scanning agents",
  defaultStrategy: "additive",
  phases: [
    {
      name: "scan",
      description: "Parallel security scanning by specialized agents",
      parallel: true,
      strategy: "additive",
      agents: [
        {
          agentId: "static-scanner",
          role: "static",
          task: "Perform static security analysis of ${path}: scan for OWASP Top 10 vulnerabilities, dangerous function calls, hardcoded credentials, insecure dependencies, path traversal risks",
        },
        {
          agentId: "semantic-scanner",
          role: "semantic",
          task: "Perform semantic security analysis of ${path}: analyze data flow for injection paths, check authorization boundaries, verify input validation completeness, detect privilege escalation risks",
        },
      ],
    },
  ],
};

/**
 * Workflow Registry Tests
 */

import { describe, it, expect, beforeEach } from "vitest";
import { getWorkflow, listWorkflows, registerWorkflow, unregisterWorkflow } from "./registry.js";
import type { WorkflowDefinition } from "./types.js";

describe("workflow registry", () => {
  // Clean up any custom workflows between tests
  const customWorkflowName = "test-custom-workflow";
  beforeEach(() => {
    unregisterWorkflow(customWorkflowName);
  });

  it("ships with code-review workflow", () => {
    const workflow = getWorkflow("code-review");
    expect(workflow).toBeTruthy();
    expect(workflow!.name).toBe("code-review");
    expect(workflow!.phases).toHaveLength(1);
    expect(workflow!.phases[0].agents).toHaveLength(4);
    expect(workflow!.defaultStrategy).toBe("additive");
  });

  it("ships with feature-dev workflow", () => {
    const workflow = getWorkflow("feature-dev");
    expect(workflow).toBeTruthy();
    expect(workflow!.name).toBe("feature-dev");
    expect(workflow!.phases).toHaveLength(4);
  });

  it("ships with security-review workflow", () => {
    const workflow = getWorkflow("security-review");
    expect(workflow).toBeTruthy();
    expect(workflow!.name).toBe("security-review");
    expect(workflow!.phases).toHaveLength(1);
    expect(workflow!.phases[0].agents).toHaveLength(2);
  });

  it("listWorkflows returns all built-in workflows", () => {
    const all = listWorkflows();
    const names = all.map((w) => w.name);
    expect(names).toContain("code-review");
    expect(names).toContain("feature-dev");
    expect(names).toContain("security-review");
  });

  it("registerWorkflow adds a custom workflow", () => {
    const custom: WorkflowDefinition = {
      name: customWorkflowName,
      description: "Test workflow",
      defaultStrategy: "additive",
      phases: [
        {
          name: "test-phase",
          description: "A test phase",
          parallel: false,
          strategy: "additive",
          agents: [{ agentId: "test-agent", role: "tester", task: "test" }],
        },
      ],
    };

    registerWorkflow(custom);

    const retrieved = getWorkflow(customWorkflowName);
    expect(retrieved).toBeTruthy();
    expect(retrieved!.description).toBe("Test workflow");
  });

  it("registerWorkflow rejects duplicate names", () => {
    expect(() =>
      registerWorkflow({
        name: "code-review",
        description: "duplicate",
        defaultStrategy: "additive",
        phases: [
          {
            name: "p",
            description: "d",
            parallel: false,
            strategy: "additive",
            agents: [{ agentId: "a", role: "r", task: "t" }],
          },
        ],
      }),
    ).toThrow(/already registered/);
  });

  it("registerWorkflow rejects empty phases", () => {
    expect(() =>
      registerWorkflow({
        name: "bad-workflow",
        description: "no phases",
        defaultStrategy: "additive",
        phases: [],
      }),
    ).toThrow(/at least one phase/);
  });

  it("unregisterWorkflow removes a custom workflow", () => {
    registerWorkflow({
      name: customWorkflowName,
      description: "to be removed",
      defaultStrategy: "additive",
      phases: [
        {
          name: "p",
          description: "d",
          parallel: false,
          strategy: "additive",
          agents: [{ agentId: "a", role: "r", task: "t" }],
        },
      ],
    });

    const removed = unregisterWorkflow(customWorkflowName);
    expect(removed).toBe(true);
    expect(getWorkflow(customWorkflowName)).toBeUndefined();
  });
});

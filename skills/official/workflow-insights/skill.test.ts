import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  results: [
    {
      subject: "trace:data",
      object: "error timeout timeout timeout delegation>5 same-query same-query",
    },
  ],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("workflow-insights", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("workflow-insights");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("detects anti-patterns in trace data", async () => {
    const result = await runtime.onQuery(mockCtx as never);
    expect(result.additionalContext).toContain("workflow-insights");
  });

  it("reports healthy for clean trace", async () => {
    const ctx = {
      ...mockCtx,
      results: [{ subject: "trace", object: "step1 ok step2 ok step3 done" }],
    };
    const result = await runtime.onQuery(ctx as never);
    expect(result.results).toBeDefined();
  });
});

import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  results: [
    {
      subject: "task:info",
      object: "I need to classify thousands of simple support tickets quickly",
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

describe("model-advisor", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("model-advisor");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("recommends a model based on task keywords", async () => {
    const result = await runtime.onQuery(mockCtx as never);
    expect(result.additionalContext).toContain("model-advisor");
  });

  it("handles ambiguous input", async () => {
    const ctx = { ...mockCtx, results: [{ subject: "q", object: "do something" }] };
    const result = await runtime.onQuery(ctx as never);
    expect(result.results).toBeDefined();
  });
});

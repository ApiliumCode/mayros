import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  results: [
    {
      subject: "usage:pattern",
      object: "Repeated identical prompts using claude-opus-4-6-20250514",
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

describe("cost-optimizer", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("cost-optimizer");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("detects caching opportunity", async () => {
    const result = await runtime.onQuery(mockCtx as never);
    expect(result.additionalContext).toContain("cost-optimizer");
  });

  it("handles empty results", async () => {
    const ctx = { ...mockCtx, results: [] };
    const result = await runtime.onQuery(ctx as never);
    expect(result.results).toBeDefined();
  });
});

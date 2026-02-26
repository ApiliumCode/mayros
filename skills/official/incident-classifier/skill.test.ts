import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  results: [{ subject: "error:log", object: "HTTP 429 Too Many Requests - rate limit exceeded" }],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("incident-classifier", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("incident-classifier");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("classifies rate limit error", async () => {
    const result = await runtime.onQuery(mockCtx as never);
    expect(result.additionalContext).toContain("incident-classifier");
  });

  it("handles clean input with no errors", async () => {
    const ctx = { ...mockCtx, results: [{ subject: "log", object: "All systems operational" }] };
    const result = await runtime.onQuery(ctx as never);
    expect(result.results).toBeDefined();
  });
});

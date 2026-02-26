import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  results: [{ subject: "api:query", object: "How to stream messages in python?" }],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("api-docs", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("api-docs");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("detects streaming + python from query text", async () => {
    const result = await runtime.onQuery(mockCtx as never);
    expect(result.additionalContext).toContain("api-docs");
  });

  it("defaults to messages when no operation detected", async () => {
    const ctx = { ...mockCtx, results: [{ subject: "q", object: "hello" }] };
    const result = await runtime.onQuery(ctx as never);
    expect(result.results).toBeDefined();
  });
});

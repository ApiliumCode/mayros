import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  namespace: "test-ns",
  predicate: "sync:checkpoint",
  scope: "global" as const,
  results: [{ subject: "sync:ns1:agent1", object: "2026-02-26T00:00:00Z" }],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("knowledge-sync", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("knowledge-sync");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("passes through results with sync context", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    expect(result.results).toEqual(mockCtx.results);
    expect(result.additionalContext).toContain("knowledge-sync");
  });

  it("includes scope and predicate in context", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    expect(result.additionalContext).toContain("global");
    expect(result.additionalContext).toContain("sync:checkpoint");
  });

  it("seeds initial triple on activation", async () => {
    let created = false;
    const ctx = {
      ...mockCtx,
      graphClient: {
        ...mockCtx.graphClient,
        createTriple: async () => {
          created = true;
        },
      },
    };
    await runtime.onActivate!(ctx as never);
    expect(created).toBe(true);
  });
});

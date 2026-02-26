import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  namespace: "test-ns",
  predicate: "api:healthy",
  scope: "namespace" as const,
  results: [
    { subject: "api:/health", object: "200 ok healthy" },
    { subject: "api:/users", object: "500 internal server error down" },
    { subject: "api:/search", object: "timeout slow response" },
    { subject: "api:/docs", object: "unknown status" },
  ],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("api-monitor", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("api-monitor");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("annotates healthy endpoints", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    const first = result.results![0].object as Record<string, unknown>;
    expect(first.healthStatus).toBe("healthy");
  });

  it("annotates unhealthy endpoints", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    const second = result.results![1].object as Record<string, unknown>;
    expect(second.healthStatus).toBe("unhealthy");
  });

  it("annotates degraded endpoints", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    const third = result.results![2].object as Record<string, unknown>;
    expect(third.healthStatus).toBe("degraded");
  });
});

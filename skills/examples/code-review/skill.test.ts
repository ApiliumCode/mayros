import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  namespace: "test-ns",
  predicate: "review:finding",
  scope: "agent" as const,
  results: [
    { subject: "file:main.ts", object: "found critical vulnerability in auth" },
    { subject: "file:utils.ts", object: "deprecated API usage warning" },
    { subject: "file:index.ts", object: "minor style suggestion" },
  ],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("code-review", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("code-review");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("classifies findings by severity", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    expect(result.results).toHaveLength(3);
    expect(result.additionalContext).toContain("code-review");
  });

  it("assigns critical severity for vulnerability keywords", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    const first = result.results![0].object as Record<string, unknown>;
    expect(first.severity).toBe("critical");
  });

  it("assigns warning severity for deprecated keywords", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    const second = result.results![1].object as Record<string, unknown>;
    expect(second.severity).toBe("warning");
  });
});

import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  namespace: "test-ns",
  predicate: "dep:safe",
  scope: "namespace" as const,
  results: [
    { subject: "pkg:lodash", object: "outdated v3.10.1" },
    { subject: "pkg:express", object: "CVE-2024-1234 vulnerability found" },
    { subject: "pkg:vitest", object: "up to date v1.0.0" },
  ],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("dependency-audit", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("dependency-audit");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("flags outdated dependencies", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    const first = result.results![0].object as Record<string, unknown>;
    expect(first.flag).toBe("outdated");
  });

  it("flags vulnerable dependencies", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    const second = result.results![1].object as Record<string, unknown>;
    expect(second.flag).toBe("vulnerable");
  });

  it("reports flagged count in additionalContext", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    expect(result.additionalContext).toContain("dependency-audit");
    expect(result.additionalContext).toContain("2");
  });
});

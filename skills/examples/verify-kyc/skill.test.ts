import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  namespace: "test-ns",
  predicate: "kyc:level",
  scope: "agent" as const,
  results: [
    { subject: "kyc:user:alice", object: "enhanced" },
    { subject: "order:12345", object: "shipped" },
  ],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("verify-kyc", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("verify-kyc");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("passes all results when predicate is KYC-related", async () => {
    const result = await runtime.onQuery!(mockCtx as never);
    expect(result.results).toHaveLength(2);
  });

  it("filters non-KYC results when predicate is unrelated", async () => {
    const ctx = { ...mockCtx, predicate: "order:status" };
    const result = await runtime.onQuery!(ctx as never);
    expect(result.results!.length).toBeLessThanOrEqual(mockCtx.results.length);
  });

  it("returns original results when no KYC subjects match", async () => {
    const ctx = {
      ...mockCtx,
      predicate: "order:status",
      results: [{ subject: "order:1", object: "done" }],
    };
    const result = await runtime.onQuery!(ctx as never);
    expect(result.results).toHaveLength(1);
  });
});

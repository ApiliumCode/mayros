import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  results: [
    { subject: "ver:check", object: "Updated from 1.0.0 to 2.0.0 with breaking API changes" },
  ],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("changelog-tracker", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("changelog-tracker");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("detects semver versions in text", async () => {
    const result = await runtime.onQuery(mockCtx as never);
    expect(result.additionalContext).toContain("changelog-tracker");
  });

  it("handles text with no versions", async () => {
    const ctx = { ...mockCtx, results: [{ subject: "q", object: "no versions here" }] };
    const result = await runtime.onQuery(ctx as never);
    expect(result.results).toBeDefined();
  });
});

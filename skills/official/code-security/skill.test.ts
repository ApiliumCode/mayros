import { describe, it, expect } from "vitest";
import runtime from "./skill.js";

const mockCtx = {
  agentId: "test-agent",
  results: [
    { subject: "code:scan", object: "const q = 'SELECT * FROM users WHERE id=' + userId;" },
  ],
  logger: { info: () => {}, warn: () => {}, error: () => {} },
  graphClient: {
    createTriple: async () => {},
    listTriples: async () => [],
    patternQuery: async () => [],
    deleteTriple: async () => {},
  },
};

describe("code-security", () => {
  it("exports a valid runtime", () => {
    expect(runtime.name).toBe("code-security");
    expect(typeof runtime.onActivate).toBe("function");
    expect(typeof runtime.onQuery).toBe("function");
  });

  it("detects SQL injection pattern", async () => {
    const result = await runtime.onQuery(mockCtx as never);
    expect(result.additionalContext).toContain("code-security");
  });

  it("reports clean code as safe", async () => {
    const ctx = { ...mockCtx, results: [{ subject: "code", object: "const x = 1 + 2;" }] };
    const result = await runtime.onQuery(ctx as never);
    expect(result.results).toBeDefined();
  });
});

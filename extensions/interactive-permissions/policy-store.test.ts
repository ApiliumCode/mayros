/**
 * Policy Store Tests
 *
 * Tests cover: add/remove policies, exact/glob/regex matching,
 * maxRiskLevel filtering, source tracking, list policies,
 * no-cortex fallback, policy ID generation.
 */

import { describe, it, expect } from "vitest";
import { PolicyStore, generatePolicyId, type PermissionPolicy } from "./policy-store.js";

// ============================================================================
// Mock Cortex Client
// ============================================================================

function createMockClient() {
  const triples: Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string | number | boolean | { node: string };
  }> = [];
  let nextId = 1;

  return {
    triples,
    async createTriple(req: {
      subject: string;
      predicate: string;
      object: string | number | boolean | { node: string };
    }) {
      const triple = { id: String(nextId++), ...req };
      triples.push(triple);
      return triple;
    },
    async listTriples(query: { subject?: string; predicate?: string; limit?: number }) {
      const filtered = triples.filter((t) => {
        if (query.subject && t.subject !== query.subject) return false;
        if (query.predicate && t.predicate !== query.predicate) return false;
        return true;
      });
      const limited = filtered.slice(0, query.limit ?? 100);
      return { triples: limited, total: filtered.length };
    },
    async patternQuery(req: {
      subject?: string;
      predicate?: string;
      object?: string | number | boolean | { node: string };
      limit?: number;
    }) {
      const filtered = triples.filter((t) => {
        if (req.subject && t.subject !== req.subject) return false;
        if (req.predicate && t.predicate !== req.predicate) return false;
        if (req.object !== undefined) {
          if (JSON.stringify(req.object) !== JSON.stringify(t.object)) return false;
        }
        return true;
      });
      const limited = filtered.slice(0, req.limit ?? 100);
      return { matches: limited, total: filtered.length };
    },
    async deleteTriple(id: string) {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
    },
  };
}

function createTestPolicy(overrides: Partial<PermissionPolicy> = {}): PermissionPolicy {
  return {
    id: overrides.id ?? generatePolicyId(),
    kind: "always_allow",
    matcher: "ls",
    matcherType: "exact",
    createdAt: new Date().toISOString(),
    source: "manual",
    ...overrides,
  };
}

// ============================================================================
// Add / Remove Policies
// ============================================================================

describe("PolicyStore — add/remove", () => {
  it("adds a policy to memory", async () => {
    const store = new PolicyStore(undefined, "mayros");
    const policy = createTestPolicy();

    await store.savePolicy(policy);

    expect(store.size).toBe(1);
    expect(store.getPolicy(policy.id)).toEqual(policy);
  });

  it("removes a policy from memory", async () => {
    const store = new PolicyStore(undefined, "mayros");
    const policy = createTestPolicy();

    await store.savePolicy(policy);
    await store.removePolicy(policy.id);

    expect(store.size).toBe(0);
    expect(store.getPolicy(policy.id)).toBeUndefined();
  });

  it("lists all policies", async () => {
    const store = new PolicyStore(undefined, "mayros");

    await store.savePolicy(createTestPolicy({ id: "p1", matcher: "ls" }));
    await store.savePolicy(createTestPolicy({ id: "p2", matcher: "cat" }));
    await store.savePolicy(createTestPolicy({ id: "p3", matcher: "grep" }));

    const policies = store.listPolicies();
    expect(policies).toHaveLength(3);
    expect(policies.map((p) => p.id).sort()).toEqual(["p1", "p2", "p3"]);
  });

  it("overwrites existing policy with same ID", async () => {
    const store = new PolicyStore(undefined, "mayros");

    await store.savePolicy(createTestPolicy({ id: "p1", kind: "always_allow" }));
    await store.savePolicy(createTestPolicy({ id: "p1", kind: "always_deny" }));

    expect(store.size).toBe(1);
    expect(store.getPolicy("p1")!.kind).toBe("always_deny");
  });

  it("removes non-existent policy silently", async () => {
    const store = new PolicyStore(undefined, "mayros");

    await store.removePolicy("nonexistent");
    expect(store.size).toBe(0);
  });
});

// ============================================================================
// Exact Matching
// ============================================================================

describe("PolicyStore — exact matching", () => {
  it("finds exact match by tool name", async () => {
    const store = new PolicyStore(undefined, "mayros");
    const policy = createTestPolicy({ matcher: "exec", matcherType: "exact" });
    await store.savePolicy(policy);

    const found = store.findMatchingPolicy("exec");
    expect(found).toBeTruthy();
    expect(found!.id).toBe(policy.id);
  });

  it("does not match different tool name", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(createTestPolicy({ matcher: "exec", matcherType: "exact" }));

    const found = store.findMatchingPolicy("read");
    expect(found).toBeUndefined();
  });

  it("matches command via general matcher", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(createTestPolicy({ matcher: "ls -la", matcherType: "exact" }));

    const found = store.findMatchingPolicy("exec", "ls -la");
    expect(found).toBeTruthy();
  });

  it("matches command via commandPattern", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(
      createTestPolicy({
        matcher: "exec",
        matcherType: "exact",
        commandPattern: "git status",
      }),
    );

    const found = store.findMatchingPolicy("exec", "git status");
    expect(found).toBeTruthy();
  });
});

// ============================================================================
// Glob Matching
// ============================================================================

describe("PolicyStore — glob matching", () => {
  it("matches with * wildcard", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(createTestPolicy({ matcher: "git*", matcherType: "glob" }));

    expect(store.findMatchingPolicy("git")).toBeTruthy();
    expect(store.findMatchingPolicy("git-push")).toBeTruthy();
    expect(store.findMatchingPolicy("not-git")).toBeUndefined();
  });

  it("matches with ? wildcard", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(createTestPolicy({ matcher: "l?", matcherType: "glob" }));

    expect(store.findMatchingPolicy("ls")).toBeTruthy();
    expect(store.findMatchingPolicy("la")).toBeTruthy();
    expect(store.findMatchingPolicy("list")).toBeUndefined();
  });

  it("matches glob against command", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(createTestPolicy({ matcher: "npm *", matcherType: "glob" }));

    expect(store.findMatchingPolicy("exec", "npm install")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", "npm publish")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", "pnpm install")).toBeUndefined();
  });
});

// ============================================================================
// Regex Matching
// ============================================================================

describe("PolicyStore — regex matching", () => {
  it("matches regex pattern against tool name", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(createTestPolicy({ matcher: "^mesh_.*", matcherType: "regex" }));

    expect(store.findMatchingPolicy("mesh_share_knowledge")).toBeTruthy();
    expect(store.findMatchingPolicy("mesh_list_agents")).toBeTruthy();
    expect(store.findMatchingPolicy("exec")).toBeUndefined();
  });

  it("matches regex pattern against command", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(
      createTestPolicy({ matcher: "^git\\s+(add|status)", matcherType: "regex" }),
    );

    expect(store.findMatchingPolicy("exec", "git add .")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", "git status")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", "git push")).toBeUndefined();
  });

  it("handles invalid regex gracefully", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(createTestPolicy({ matcher: "[invalid", matcherType: "regex" }));

    // Invalid regex should not match anything
    expect(store.findMatchingPolicy("anything")).toBeUndefined();
  });
});

// ============================================================================
// maxRiskLevel Filtering
// ============================================================================

describe("PolicyStore — maxRiskLevel", () => {
  it("matches when risk is within maxRiskLevel", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(
      createTestPolicy({ matcher: "exec", matcherType: "exact", maxRiskLevel: "medium" }),
    );

    expect(store.findMatchingPolicy("exec", undefined, "safe")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", undefined, "low")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", undefined, "medium")).toBeTruthy();
  });

  it("does not match when risk exceeds maxRiskLevel", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(
      createTestPolicy({ matcher: "exec", matcherType: "exact", maxRiskLevel: "medium" }),
    );

    expect(store.findMatchingPolicy("exec", undefined, "high")).toBeUndefined();
    expect(store.findMatchingPolicy("exec", undefined, "critical")).toBeUndefined();
  });

  it("ignores maxRiskLevel when no risk is provided", async () => {
    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy(
      createTestPolicy({ matcher: "exec", matcherType: "exact", maxRiskLevel: "low" }),
    );

    // No risk provided — maxRiskLevel constraint is not checked
    expect(store.findMatchingPolicy("exec")).toBeTruthy();
  });
});

// ============================================================================
// Source Tracking
// ============================================================================

describe("PolicyStore — source tracking", () => {
  it("preserves manual source", async () => {
    const store = new PolicyStore(undefined, "mayros");
    const policy = createTestPolicy({ source: "manual" });
    await store.savePolicy(policy);

    expect(store.getPolicy(policy.id)!.source).toBe("manual");
  });

  it("preserves learned source", async () => {
    const store = new PolicyStore(undefined, "mayros");
    const policy = createTestPolicy({ source: "learned" });
    await store.savePolicy(policy);

    expect(store.getPolicy(policy.id)!.source).toBe("learned");
  });
});

// ============================================================================
// Cortex Persistence
// ============================================================================

describe("PolicyStore — Cortex persistence", () => {
  it("writes triples to Cortex on save", async () => {
    const client = createMockClient();
    const store = new PolicyStore(client as never, "mayros");

    await store.savePolicy(createTestPolicy({ id: "test-1", matcher: "ls", kind: "always_allow" }));

    // Should have created multiple triples for this policy
    expect(client.triples.length).toBeGreaterThanOrEqual(5);

    // Check subject format
    const subjects = client.triples.map((t) => t.subject);
    expect(subjects.every((s) => s === "mayros:permission:policy:test-1")).toBe(true);

    // Check predicates
    const predicates = client.triples.map((t) => t.predicate);
    expect(predicates).toContain("mayros:permission:kind");
    expect(predicates).toContain("mayros:permission:matcher");
    expect(predicates).toContain("mayros:permission:matcherType");
    expect(predicates).toContain("mayros:permission:createdAt");
    expect(predicates).toContain("mayros:permission:source");
  });

  it("deletes triples from Cortex on remove", async () => {
    const client = createMockClient();
    const store = new PolicyStore(client as never, "mayros");

    await store.savePolicy(createTestPolicy({ id: "del-1", matcher: "rm" }));
    const countBefore = client.triples.length;
    expect(countBefore).toBeGreaterThan(0);

    await store.removePolicy("del-1");

    // All triples for this subject should be deleted
    const remaining = client.triples.filter((t) => t.subject === "mayros:permission:policy:del-1");
    expect(remaining).toHaveLength(0);
  });
});

// ============================================================================
// No Cortex Fallback
// ============================================================================

describe("PolicyStore — no Cortex fallback", () => {
  it("works entirely in memory when cortex is undefined", async () => {
    const store = new PolicyStore(undefined, "mayros");

    await store.savePolicy(createTestPolicy({ id: "mem-1" }));
    expect(store.size).toBe(1);

    await store.removePolicy("mem-1");
    expect(store.size).toBe(0);
  });

  it("loadFromCortex is a no-op without cortex", async () => {
    const store = new PolicyStore(undefined, "mayros");

    // Should not throw
    await store.loadFromCortex();
    expect(store.size).toBe(0);
  });
});

// ============================================================================
// Policy ID Generation
// ============================================================================

describe("generatePolicyId", () => {
  it("generates unique IDs", () => {
    const id1 = generatePolicyId();
    const id2 = generatePolicyId();
    expect(id1).not.toBe(id2);
  });

  it("generates string IDs starting with policy-", () => {
    const id = generatePolicyId();
    expect(typeof id).toBe("string");
    expect(id.startsWith("policy-")).toBe(true);
  });
});

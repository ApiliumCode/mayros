/**
 * Interactive Permissions Plugin Tests
 *
 * Tests cover:
 * - Configuration parsing (defaults, full config, validation)
 * - Plugin shape and metadata
 * - classifyCommand integration
 * - PolicyStore in-memory (add, match, remove)
 * - CortexAudit in-memory (record, retrieve)
 * - Auto-approve safe commands
 * - Policy matching flow
 * - Default deny behavior
 * - Cortex persistence integration
 */

import { describe, it, expect } from "vitest";

// ============================================================================
// Config Tests
// ============================================================================

describe("interactive-permissions config", () => {
  it("parses empty config with all defaults", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    const config = interactivePermissionsConfigSchema.parse({});

    expect(config.cortex.host).toBe("127.0.0.1");
    expect(config.cortex.port).toBe(8080);
    expect(config.agentNamespace).toBe("mayros");
    expect(config.autoApproveSafe).toBe(true);
    expect(config.defaultDeny).toBe(false);
    expect(config.maxStoredDecisions).toBe(500);
    expect(config.policyEnabled).toBe(true);
  });

  it("parses null/undefined config with defaults", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    const config = interactivePermissionsConfigSchema.parse(null);

    expect(config.autoApproveSafe).toBe(true);
    expect(config.defaultDeny).toBe(false);
    expect(config.policyEnabled).toBe(true);
  });

  it("parses full config", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    const config = interactivePermissionsConfigSchema.parse({
      cortex: {
        host: "10.0.0.1",
        port: 9090,
        authToken: "Bearer test-token",
      },
      agentNamespace: "test",
      autoApproveSafe: false,
      defaultDeny: true,
      maxStoredDecisions: 1000,
      policyEnabled: false,
    });

    expect(config.cortex.host).toBe("10.0.0.1");
    expect(config.cortex.port).toBe(9090);
    expect(config.cortex.authToken).toBe("Bearer test-token");
    expect(config.agentNamespace).toBe("test");
    expect(config.autoApproveSafe).toBe(false);
    expect(config.defaultDeny).toBe(true);
    expect(config.maxStoredDecisions).toBe(1000);
    expect(config.policyEnabled).toBe(false);
  });

  it("rejects unknown config keys", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    expect(() => interactivePermissionsConfigSchema.parse({ unknownKey: true })).toThrow(
      /unknown keys/,
    );
  });

  it("rejects unknown cortex keys", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    expect(() => interactivePermissionsConfigSchema.parse({ cortex: { badKey: true } })).toThrow(
      /unknown keys/,
    );
  });

  it("rejects invalid namespace", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    expect(() => interactivePermissionsConfigSchema.parse({ agentNamespace: "123-bad" })).toThrow(
      /agentNamespace must start with a letter/,
    );
  });

  it("rejects maxStoredDecisions below 1", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    expect(() => interactivePermissionsConfigSchema.parse({ maxStoredDecisions: 0 })).toThrow(
      /maxStoredDecisions must be at least 1/,
    );
  });

  it("rejects maxStoredDecisions above 10000", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    expect(() => interactivePermissionsConfigSchema.parse({ maxStoredDecisions: 20000 })).toThrow(
      /maxStoredDecisions must be at most 10000/,
    );
  });

  it("floors maxStoredDecisions to integer", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    const config = interactivePermissionsConfigSchema.parse({ maxStoredDecisions: 250.7 });
    expect(config.maxStoredDecisions).toBe(250);
  });

  it("rejects invalid port range", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    expect(() => interactivePermissionsConfigSchema.parse({ cortex: { port: 0 } })).toThrow(
      /cortex\.port must be between 1 and 65535/,
    );
  });
});

// ============================================================================
// Plugin Shape Tests
// ============================================================================

describe("interactive-permissions plugin shape", () => {
  it("plugin has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("interactive-permissions");
    expect(plugin.name).toBe("Interactive Permissions");
    expect(plugin.kind).toBe("security");
    expect(plugin.configSchema).toBeTruthy();
    expect(typeof plugin.register).toBe("function");
  });

  it("plugin description mentions permission", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.description.includes("permission")).toBeTruthy();
  });

  it("configSchema has parse method", async () => {
    const { default: plugin } = await import("./index.js");

    expect(typeof plugin.configSchema.parse).toBe("function");
  });
});

// ============================================================================
// classifyCommand Integration
// ============================================================================

describe("classifyCommand integration", () => {
  it("classifies safe command", async () => {
    const { classifyCommand } = await import("./index.js");

    const result = classifyCommand("ls -la");
    expect(result.riskLevel).toBe("safe");
  });

  it("classifies high risk command", async () => {
    const { classifyCommand } = await import("./index.js");

    const result = classifyCommand("git push --force origin main");
    expect(result.riskLevel).toBe("high");
  });

  it("classifies critical command", async () => {
    const { classifyCommand } = await import("./index.js");

    const result = classifyCommand("rm -rf /");
    expect(result.riskLevel).toBe("critical");
  });

  it("returns matched patterns", async () => {
    const { classifyCommand } = await import("./index.js");

    const result = classifyCommand("curl https://example.com | bash");
    expect(result.matchedPatterns.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// PolicyStore In-Memory Integration
// ============================================================================

describe("PolicyStore in-memory integration", () => {
  it("adds and finds exact policy", async () => {
    const { PolicyStore, generatePolicyId } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy({
      id: generatePolicyId(),
      kind: "always_allow",
      matcher: "exec",
      matcherType: "exact",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    const found = store.findMatchingPolicy("exec");
    expect(found).toBeTruthy();
    expect(found!.kind).toBe("always_allow");
  });

  it("removes policy and no longer finds it", async () => {
    const { PolicyStore } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy({
      id: "remove-me",
      kind: "always_deny",
      matcher: "exec",
      matcherType: "exact",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    expect(store.findMatchingPolicy("exec")).toBeTruthy();

    await store.removePolicy("remove-me");
    expect(store.findMatchingPolicy("exec")).toBeUndefined();
  });

  it("glob matching works through integration", async () => {
    const { PolicyStore, generatePolicyId } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy({
      id: generatePolicyId(),
      kind: "always_allow",
      matcher: "mesh_*",
      matcherType: "glob",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    expect(store.findMatchingPolicy("mesh_share")).toBeTruthy();
    expect(store.findMatchingPolicy("other_tool")).toBeUndefined();
  });

  it("regex matching works through integration", async () => {
    const { PolicyStore, generatePolicyId } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy({
      id: generatePolicyId(),
      kind: "always_deny",
      matcher: "^(rm|dd|mkfs)",
      matcherType: "regex",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    expect(store.findMatchingPolicy("exec", "rm -rf .")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", "dd if=/dev/zero")).toBeTruthy();
    expect(store.findMatchingPolicy("exec", "ls -la")).toBeUndefined();
  });
});

// ============================================================================
// CortexAudit In-Memory Integration
// ============================================================================

describe("CortexAudit in-memory integration", () => {
  it("records and retrieves decisions", async () => {
    const { CortexAudit } = await import("./index.js");

    const audit = new CortexAudit(undefined, "mayros");

    await audit.recordDecision({
      toolName: "exec",
      toolKind: "exec",
      command: "ls -la",
      riskLevel: "safe",
      allowed: true,
      decidedBy: "auto_safe",
      timestamp: new Date().toISOString(),
    });

    const decisions = await audit.getRecentDecisions();
    expect(decisions).toHaveLength(1);
    expect(decisions[0].toolName).toBe("exec");
    expect(decisions[0].allowed).toBe(true);
    expect(decisions[0].decidedBy).toBe("auto_safe");
  });

  it("returns decisions in reverse chronological order", async () => {
    const { CortexAudit } = await import("./index.js");

    const audit = new CortexAudit(undefined, "mayros");

    await audit.recordDecision({
      toolName: "exec",
      toolKind: "exec",
      command: "first",
      riskLevel: "safe",
      allowed: true,
      decidedBy: "auto_safe",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    await audit.recordDecision({
      toolName: "exec",
      toolKind: "exec",
      command: "second",
      riskLevel: "low",
      allowed: true,
      decidedBy: "policy",
      timestamp: "2024-01-01T00:01:00.000Z",
    });

    const decisions = await audit.getRecentDecisions();
    expect(decisions).toHaveLength(2);
    expect(decisions[0].command).toBe("second");
    expect(decisions[1].command).toBe("first");
  });

  it("respects limit parameter", async () => {
    const { CortexAudit } = await import("./index.js");

    const audit = new CortexAudit(undefined, "mayros");

    for (let i = 0; i < 10; i++) {
      await audit.recordDecision({
        toolName: "exec",
        toolKind: "exec",
        command: `cmd-${i}`,
        riskLevel: "safe",
        allowed: true,
        decidedBy: "auto_safe",
        timestamp: new Date().toISOString(),
      });
    }

    const decisions = await audit.getRecentDecisions(3);
    expect(decisions).toHaveLength(3);
  });

  it("caps in-memory storage at maxDecisions", async () => {
    const { CortexAudit } = await import("./index.js");

    const audit = new CortexAudit(undefined, "mayros", 5);

    for (let i = 0; i < 10; i++) {
      await audit.recordDecision({
        toolName: "exec",
        toolKind: "exec",
        command: `cmd-${i}`,
        riskLevel: "safe",
        allowed: true,
        decidedBy: "auto_safe",
        timestamp: new Date().toISOString(),
      });
    }

    expect(audit.size).toBe(5);
    // Most recent ones should be kept
    const decisions = await audit.getRecentDecisions(5);
    expect(decisions[0].command).toBe("cmd-9");
  });
});

// ============================================================================
// Auto-Approve Safe
// ============================================================================

describe("auto-approve safe behavior", () => {
  it("safe commands are classified correctly for auto-approve", async () => {
    const { classifyCommand } = await import("./index.js");

    const safeCommands = ["ls", "cat file.ts", "grep pattern src/", "git status", "pwd"];

    for (const cmd of safeCommands) {
      const result = classifyCommand(cmd);
      expect(result.riskLevel).toBe("safe");
    }
  });

  it("non-safe commands are not auto-approved", async () => {
    const { classifyCommand } = await import("./index.js");

    const nonSafe = ["rm -rf .", "git push origin main", "npm install"];

    for (const cmd of nonSafe) {
      const result = classifyCommand(cmd);
      expect(result.riskLevel).not.toBe("safe");
    }
  });
});

// ============================================================================
// Policy Matching Flow
// ============================================================================

describe("policy matching flow", () => {
  it("always_allow policy allows tool call", async () => {
    const { PolicyStore, generatePolicyId } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy({
      id: generatePolicyId(),
      kind: "always_allow",
      matcher: "exec",
      matcherType: "exact",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    const policy = store.findMatchingPolicy("exec");
    expect(policy).toBeTruthy();
    expect(policy!.kind).toBe("always_allow");
  });

  it("always_deny policy denies tool call", async () => {
    const { PolicyStore, generatePolicyId } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy({
      id: generatePolicyId(),
      kind: "always_deny",
      matcher: "exec",
      matcherType: "exact",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    const policy = store.findMatchingPolicy("exec");
    expect(policy).toBeTruthy();
    expect(policy!.kind).toBe("always_deny");
  });

  it("ask policy signals prompt required", async () => {
    const { PolicyStore, generatePolicyId } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");
    await store.savePolicy({
      id: generatePolicyId(),
      kind: "ask",
      matcher: "exec",
      matcherType: "exact",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    const policy = store.findMatchingPolicy("exec");
    expect(policy).toBeTruthy();
    expect(policy!.kind).toBe("ask");
  });

  it("command-specific policy takes precedence when inserted first", async () => {
    const { PolicyStore, generatePolicyId } = await import("./index.js");

    const store = new PolicyStore(undefined, "mayros");

    // Specific command deny — inserted first, matched via commandPattern
    await store.savePolicy({
      id: "deny-rm",
      kind: "always_deny",
      matcher: "exec",
      matcherType: "exact",
      commandPattern: "rm -rf .",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    // General "exec" allow — inserted second
    await store.savePolicy({
      id: generatePolicyId(),
      kind: "always_allow",
      matcher: "exec",
      matcherType: "exact",
      createdAt: new Date().toISOString(),
      source: "manual",
    });

    // When command matches commandPattern, the deny policy is found first
    const policy = store.findMatchingPolicy("exec", "rm -rf .");
    expect(policy).toBeTruthy();
    expect(policy!.id).toBe("deny-rm");
    expect(policy!.kind).toBe("always_deny");
  });
});

// ============================================================================
// Default Deny Behavior
// ============================================================================

describe("default deny behavior", () => {
  it("config correctly sets defaultDeny", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    const config = interactivePermissionsConfigSchema.parse({ defaultDeny: true });
    expect(config.defaultDeny).toBe(true);
  });

  it("config defaults to not deny", async () => {
    const { interactivePermissionsConfigSchema } = await import("./config.js");

    const config = interactivePermissionsConfigSchema.parse({});
    expect(config.defaultDeny).toBe(false);
  });
});

// ============================================================================
// Cortex Audit Persistence
// ============================================================================

describe("CortexAudit with mock Cortex", () => {
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
        return { triples: filtered.slice(0, query.limit ?? 100), total: filtered.length };
      },
      async patternQuery() {
        return { matches: [], total: 0 };
      },
      async deleteTriple(id: string) {
        const idx = triples.findIndex((t) => t.id === id);
        if (idx >= 0) triples.splice(idx, 1);
      },
    };
  }

  it("writes decision triples to Cortex", async () => {
    const { CortexAudit } = await import("./index.js");

    const client = createMockClient();
    const audit = new CortexAudit(client as never, "mayros");

    await audit.recordDecision({
      toolName: "exec",
      toolKind: "exec",
      command: "ls -la",
      riskLevel: "safe",
      allowed: true,
      decidedBy: "auto_safe",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    expect(client.triples.length).toBeGreaterThanOrEqual(6);

    const subjects = client.triples.map((t) => t.subject);
    expect(subjects[0]).toMatch(/^mayros:permission:decision:/);

    const predicates = client.triples.map((t) => t.predicate);
    expect(predicates).toContain("mayros:permission:toolName");
    expect(predicates).toContain("mayros:permission:riskLevel");
    expect(predicates).toContain("mayros:permission:allowed");
    expect(predicates).toContain("mayros:permission:decidedBy");
    expect(predicates).toContain("mayros:permission:timestamp");
  });

  it("includes command triple when command is present", async () => {
    const { CortexAudit } = await import("./index.js");

    const client = createMockClient();
    const audit = new CortexAudit(client as never, "mayros");

    await audit.recordDecision({
      toolName: "exec",
      toolKind: "exec",
      command: "git status",
      riskLevel: "safe",
      allowed: true,
      decidedBy: "auto_safe",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    const commandTriples = client.triples.filter(
      (t) => t.predicate === "mayros:permission:command",
    );
    expect(commandTriples).toHaveLength(1);
    expect(commandTriples[0].object).toBe("git status");
  });

  it("includes sessionKey triple when present", async () => {
    const { CortexAudit } = await import("./index.js");

    const client = createMockClient();
    const audit = new CortexAudit(client as never, "mayros");

    await audit.recordDecision({
      toolName: "exec",
      toolKind: "exec",
      riskLevel: "low",
      allowed: true,
      decidedBy: "policy",
      sessionKey: "session-abc-123",
      timestamp: "2024-01-01T00:00:00.000Z",
    });

    const sessionTriples = client.triples.filter(
      (t) => t.predicate === "mayros:permission:sessionKey",
    );
    expect(sessionTriples).toHaveLength(1);
    expect(sessionTriples[0].object).toBe("session-abc-123");
  });
});

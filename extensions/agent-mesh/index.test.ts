/**
 * Agent Mesh Plugin Tests
 *
 * Tests cover:
 * - Configuration parsing and validation
 * - NamespaceManager: getPrivateNs, getSharedNs format
 * - ACL: grant/revoke/check access
 * - MeshProtocol: message type validation
 * - DelegationEngine: prepareContext returns valid DelegationContext
 * - KnowledgeFusion: detectConflicts finds contradictions
 * - Plugin registration
 */

import { describe, it, expect, vi } from "vitest";
import { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Config Tests
// ============================================================================

describe("agent mesh config", () => {
  it("parses valid config with defaults", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({});

    expect(config.cortex.host).toBe("127.0.0.1");
    expect(config.cortex.port).toBe(8080);
    expect(config.cortex.authToken).toBe(undefined);
    expect(config.agentNamespace).toBe("mayros");
    expect(config.mesh.maxSharedNamespaces).toBe(50);
    expect(config.mesh.delegationTimeout).toBe(300);
    expect(config.mesh.autoMerge).toBe(true);
  });

  it("parses full config", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({
      cortex: {
        host: "10.0.0.1",
        port: 9090,
        authToken: "Bearer test-token",
      },
      agentNamespace: "test",
      mesh: {
        maxSharedNamespaces: 100,
        delegationTimeout: 600,
        autoMerge: false,
      },
    });

    expect(config.cortex.host).toBe("10.0.0.1");
    expect(config.cortex.port).toBe(9090);
    expect(config.cortex.authToken).toBe("Bearer test-token");
    expect(config.agentNamespace).toBe("test");
    expect(config.mesh.maxSharedNamespaces).toBe(100);
    expect(config.mesh.delegationTimeout).toBe(600);
    expect(config.mesh.autoMerge).toBe(false);
  });

  it("rejects invalid port range", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ cortex: { port: 0 } })).toThrow(
      /cortex\.port must be between 1 and 65535/,
    );
  });

  it("rejects unknown config keys", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ unknownKey: true })).toThrow(/unknown keys/);
  });

  it("rejects unknown cortex keys", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ cortex: { badKey: true } })).toThrow(/unknown keys/);
  });

  it("rejects unknown mesh keys", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ mesh: { badKey: true } })).toThrow(/unknown keys/);
  });

  it("rejects invalid namespace", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ agentNamespace: "123-bad" })).toThrow(
      /agentNamespace must start with a letter/,
    );
  });

  it("resolves env vars in auth token", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    process.env.TEST_MESH_TOKEN = "secret-mesh-token";

    const config = agentMeshConfigSchema.parse({
      cortex: { authToken: "${TEST_MESH_TOKEN}" },
    });

    expect(config.cortex.authToken).toBe("secret-mesh-token");

    delete process.env.TEST_MESH_TOKEN;
  });

  it("throws on missing env var", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() =>
      agentMeshConfigSchema.parse({
        cortex: { authToken: "${NONEXISTENT_MESH_VAR}" },
      }),
    ).toThrow(/Environment variable NONEXISTENT_MESH_VAR is not set/);
  });

  it("rejects maxSharedNamespaces less than 1", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ mesh: { maxSharedNamespaces: 0 } })).toThrow(
      /mesh\.maxSharedNamespaces must be at least 1/,
    );
  });

  it("rejects delegationTimeout less than 1", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ mesh: { delegationTimeout: 0 } })).toThrow(
      /mesh\.delegationTimeout must be at least 1/,
    );
  });

  it("parses teams config with defaults", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({});

    expect(config.teams.maxTeamSize).toBe(8);
    expect(config.teams.defaultStrategy).toBe("additive");
    expect(config.teams.workflowTimeout).toBe(600);
  });

  it("parses teams config with custom values", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({
      teams: {
        maxTeamSize: 4,
        defaultStrategy: "conflict-flag",
        workflowTimeout: 120,
      },
    });

    expect(config.teams.maxTeamSize).toBe(4);
    expect(config.teams.defaultStrategy).toBe("conflict-flag");
    expect(config.teams.workflowTimeout).toBe(120);
  });

  it("rejects teams.maxTeamSize less than 1", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ teams: { maxTeamSize: 0 } })).toThrow(
      /teams\.maxTeamSize must be at least 1/,
    );
  });

  it("rejects teams.workflowTimeout less than 1", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ teams: { workflowTimeout: 0 } })).toThrow(
      /teams\.workflowTimeout must be at least 1/,
    );
  });

  it("rejects unknown teams keys", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ teams: { badKey: true } })).toThrow(/unknown keys/);
  });

  it("parses worktree config with defaults", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({});

    expect(config.worktree.enabled).toBe(false);
    expect(config.worktree.basePath).toBe(".mayros/worktrees");
  });

  it("parses worktree config with custom values", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({
      worktree: {
        enabled: true,
        basePath: ".custom/trees",
      },
    });

    expect(config.worktree.enabled).toBe(true);
    expect(config.worktree.basePath).toBe(".custom/trees");
  });

  it("rejects unknown worktree keys", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    expect(() => agentMeshConfigSchema.parse({ worktree: { badKey: true } })).toThrow(
      /unknown keys/,
    );
  });

  it("allows teams and worktree in top-level keys", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({
      teams: { maxTeamSize: 6 },
      worktree: { enabled: true },
    });

    expect(config.teams.maxTeamSize).toBe(6);
    expect(config.worktree.enabled).toBe(true);
  });

  it("uses default strategy for invalid strategy value", async () => {
    const { agentMeshConfigSchema } = await import("./config.js");

    const config = agentMeshConfigSchema.parse({
      teams: { defaultStrategy: "invalid-strategy" },
    });

    expect(config.teams.defaultStrategy).toBe("additive");
  });
});

// ============================================================================
// Plugin Registration Tests
// ============================================================================

describe("agent mesh plugin registration", () => {
  it("plugin has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("agent-mesh");
    expect(plugin.name).toBe("Agent Mesh");
    expect(plugin.kind).toBe("coordination");
    expect(plugin.configSchema).toBeTruthy();
    expect(typeof plugin.register).toBe("function");
  });

  it("plugin description mentions coordination", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.description.includes("coordination")).toBeTruthy();
  });
});

// ============================================================================
// Mesh Protocol Tests
// ============================================================================

describe("mesh protocol", () => {
  it("isValidMessageType accepts known types", async () => {
    const { isValidMessageType } = await import("./mesh-protocol.js");

    expect(isValidMessageType("knowledge-share")).toBe(true);
    expect(isValidMessageType("delegation-context")).toBe(true);
    expect(isValidMessageType("merge-request")).toBe(true);
    expect(isValidMessageType("conflict-alert")).toBe(true);
  });

  it("isValidMessageType rejects unknown types", async () => {
    const { isValidMessageType } = await import("./mesh-protocol.js");

    expect(isValidMessageType("unknown-type")).toBe(false);
    expect(isValidMessageType("")).toBe(false);
    expect(isValidMessageType("KNOWLEDGE-SHARE")).toBe(false);
  });

  it("isValidAccessLevel accepts known levels", async () => {
    const { isValidAccessLevel } = await import("./mesh-protocol.js");

    expect(isValidAccessLevel("none")).toBe(true);
    expect(isValidAccessLevel("read")).toBe(true);
    expect(isValidAccessLevel("write")).toBe(true);
    expect(isValidAccessLevel("admin")).toBe(true);
  });

  it("isValidAccessLevel rejects unknown levels", async () => {
    const { isValidAccessLevel } = await import("./mesh-protocol.js");

    expect(isValidAccessLevel("owner")).toBe(false);
    expect(isValidAccessLevel("")).toBe(false);
  });

  it("createMeshMessage creates well-formed message", async () => {
    const { createMeshMessage } = await import("./mesh-protocol.js");

    const before = Date.now();
    const msg = createMeshMessage("knowledge-share", "agent-a", "agent-b", "mayros:shared:ws1", {
      data: "hello",
    });
    const after = Date.now();

    expect(msg.type).toBe("knowledge-share");
    expect(msg.fromAgent).toBe("agent-a");
    expect(msg.toAgent).toBe("agent-b");
    expect(msg.namespace).toBe("mayros:shared:ws1");
    expect(msg.payload).toEqual({ data: "hello" });
    expect(msg.timestamp >= before && msg.timestamp <= after).toBeTruthy();
  });

  it("accessLevelSatisfies checks hierarchy correctly", async () => {
    const { accessLevelSatisfies } = await import("./mesh-protocol.js");

    // admin satisfies everything
    expect(accessLevelSatisfies("admin", "admin")).toBe(true);
    expect(accessLevelSatisfies("admin", "write")).toBe(true);
    expect(accessLevelSatisfies("admin", "read")).toBe(true);
    expect(accessLevelSatisfies("admin", "none")).toBe(true);

    // write satisfies write, read, none
    expect(accessLevelSatisfies("write", "admin")).toBe(false);
    expect(accessLevelSatisfies("write", "write")).toBe(true);
    expect(accessLevelSatisfies("write", "read")).toBe(true);
    expect(accessLevelSatisfies("write", "none")).toBe(true);

    // read satisfies read, none
    expect(accessLevelSatisfies("read", "admin")).toBe(false);
    expect(accessLevelSatisfies("read", "write")).toBe(false);
    expect(accessLevelSatisfies("read", "read")).toBe(true);
    expect(accessLevelSatisfies("read", "none")).toBe(true);

    // none satisfies only none
    expect(accessLevelSatisfies("none", "admin")).toBe(false);
    expect(accessLevelSatisfies("none", "write")).toBe(false);
    expect(accessLevelSatisfies("none", "read")).toBe(false);
    expect(accessLevelSatisfies("none", "none")).toBe(true);
  });
});

// ============================================================================
// Namespace Manager Tests
// ============================================================================

describe("namespace manager", () => {
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
            const reqObj = JSON.stringify(req.object);
            const tObj = JSON.stringify(t.object);
            if (reqObj !== tObj) return false;
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

  it("getPrivateNs formats correctly", async () => {
    const { NamespaceManager } = await import("./namespace-manager.js");
    const client = createMockClient();
    const mgr = new NamespaceManager(client, "mayros", 50);

    expect(mgr.getPrivateNs("agent-1")).toBe("mayros:agent:agent-1");
    expect(mgr.getPrivateNs("bot")).toBe("mayros:agent:bot");
  });

  it("getSharedNs formats correctly", async () => {
    const { NamespaceManager } = await import("./namespace-manager.js");
    const client = createMockClient();
    const mgr = new NamespaceManager(client, "mayros", 50);

    expect(mgr.getSharedNs("workspace-1")).toBe("mayros:shared:workspace-1");
    expect(mgr.getSharedNs("team")).toBe("mayros:shared:team");
  });

  it("createSharedNamespace creates namespace and grants admin to owners", async () => {
    const { NamespaceManager } = await import("./namespace-manager.js");
    const client = createMockClient();
    const mgr = new NamespaceManager(client, "mayros", 50);

    const ns = await mgr.createSharedNamespace("team-alpha", ["agent-1", "agent-2"]);

    expect(ns).toBe("mayros:shared:team-alpha");

    // Verify triples were created for the namespace
    const nsTriples = client.triples.filter((t) => t.subject === "mayros:shared:team-alpha");
    expect(nsTriples.length >= 2).toBeTruthy(); // type + createdAt

    // Verify ACL grants were created for both owners
    const aclTriples = client.triples.filter(
      (t) => t.predicate === "mayros:acl:level" && t.object === "admin",
    );
    expect(aclTriples.length).toBe(2);
  });

  it("createSharedNamespace rejects invalid names", async () => {
    const { NamespaceManager } = await import("./namespace-manager.js");
    const client = createMockClient();
    const mgr = new NamespaceManager(client, "mayros", 50);

    await expect(() => mgr.createSharedNamespace("123-bad", ["agent-1"])).rejects.toThrow(
      /must start with a letter/,
    );
  });

  it("createSharedNamespace enforces max limit", async () => {
    const { NamespaceManager } = await import("./namespace-manager.js");
    const client = createMockClient();
    const mgr = new NamespaceManager(client, "mayros", 2);

    await mgr.createSharedNamespace("ns-a", ["agent-1"]);
    await mgr.createSharedNamespace("ns-b", ["agent-1"]);

    await expect(() => mgr.createSharedNamespace("ns-c", ["agent-1"])).rejects.toThrow(
      /Maximum shared namespaces reached/,
    );
  });

  it("checkAccess returns true for own private namespace", async () => {
    const { NamespaceManager } = await import("./namespace-manager.js");
    const client = createMockClient();
    const mgr = new NamespaceManager(client, "mayros", 50);

    const hasAccess = await mgr.checkAccess("agent-1", "mayros:agent:agent-1", "admin");
    expect(hasAccess).toBe(true);
  });

  it("checkAccess returns false for other agent's private namespace", async () => {
    const { NamespaceManager } = await import("./namespace-manager.js");
    const client = createMockClient();
    const mgr = new NamespaceManager(client, "mayros", 50);

    const hasAccess = await mgr.checkAccess("agent-1", "mayros:agent:agent-2", "read");
    expect(hasAccess).toBe(false);
  });
});

// ============================================================================
// ACL Tests
// ============================================================================

describe("namespace ACL", () => {
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
            const reqObj = JSON.stringify(req.object);
            const tObj = JSON.stringify(t.object);
            if (reqObj !== tObj) return false;
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

  it("grant creates ACL triples", async () => {
    const { NamespaceACL } = await import("./acl.js");
    const client = createMockClient();
    const acl = new NamespaceACL(client, "mayros");

    await acl.grant("owner-1", "agent-1", "mayros:shared:ws1", "write");

    // Should have created 5 triples: agent, namespace, level, grantedBy, grantedAt
    expect(client.triples.length).toBe(5);

    const levelTriple = client.triples.find((t) => t.predicate === "mayros:acl:level");
    expect(levelTriple).toBeTruthy();
    expect(levelTriple!.object).toBe("write");

    const agentTriple = client.triples.find((t) => t.predicate === "mayros:acl:agent");
    expect(agentTriple).toBeTruthy();
    expect(agentTriple!.object).toEqual({ node: "mayros:agent:agent-1" });
  });

  it("checkAccess returns true when grant exists at or above required level", async () => {
    const { NamespaceACL } = await import("./acl.js");
    const client = createMockClient();
    const acl = new NamespaceACL(client, "mayros");

    await acl.grant("owner-1", "agent-1", "mayros:shared:ws1", "write");

    const canRead = await acl.checkAccess("agent-1", "mayros:shared:ws1", "read");
    expect(canRead).toBe(true);

    const canWrite = await acl.checkAccess("agent-1", "mayros:shared:ws1", "write");
    expect(canWrite).toBe(true);

    const canAdmin = await acl.checkAccess("agent-1", "mayros:shared:ws1", "admin");
    expect(canAdmin).toBe(false);
  });

  it("checkAccess returns false when no grant exists", async () => {
    const { NamespaceACL } = await import("./acl.js");
    const client = createMockClient();
    const acl = new NamespaceACL(client, "mayros");

    const canRead = await acl.checkAccess("agent-1", "mayros:shared:ws1", "read");
    expect(canRead).toBe(false);
  });

  it("checkAccess returns true for 'none' requirement without any grant", async () => {
    const { NamespaceACL } = await import("./acl.js");
    const client = createMockClient();
    const acl = new NamespaceACL(client, "mayros");

    const canNone = await acl.checkAccess("agent-1", "mayros:shared:ws1", "none");
    expect(canNone).toBe(true);
  });

  it("revoke removes ACL triples", async () => {
    const { NamespaceACL } = await import("./acl.js");
    const client = createMockClient();
    const acl = new NamespaceACL(client, "mayros");

    await acl.grant("owner-1", "agent-1", "mayros:shared:ws1", "write");
    expect(client.triples.length).toBe(5);

    await acl.revoke("owner-1", "agent-1", "mayros:shared:ws1");

    // All ACL triples should be deleted
    const grants = await acl.listGrants("mayros:shared:ws1");
    expect(grants.length).toBe(0);
  });

  it("listGrants returns all grants for a namespace", async () => {
    const { NamespaceACL } = await import("./acl.js");
    const client = createMockClient();
    const acl = new NamespaceACL(client, "mayros");

    await acl.grant("owner-1", "agent-1", "mayros:shared:ws1", "write");
    await acl.grant("owner-1", "agent-2", "mayros:shared:ws1", "read");

    const grants = await acl.listGrants("mayros:shared:ws1");
    expect(grants.length).toBe(2);

    const agent1Grant = grants.find((g) => g.agent === "agent-1");
    expect(agent1Grant).toBeTruthy();
    expect(agent1Grant!.level).toBe("write");
    expect(agent1Grant!.grantedBy).toBe("owner-1");
    expect(agent1Grant!.grantedAt > 0).toBeTruthy();

    const agent2Grant = grants.find((g) => g.agent === "agent-2");
    expect(agent2Grant).toBeTruthy();
    expect(agent2Grant!.level).toBe("read");
  });

  it("grant replaces existing grant for same agent+namespace", async () => {
    const { NamespaceACL } = await import("./acl.js");
    const client = createMockClient();
    const acl = new NamespaceACL(client, "mayros");

    await acl.grant("owner-1", "agent-1", "mayros:shared:ws1", "read");
    await acl.grant("owner-1", "agent-1", "mayros:shared:ws1", "admin");

    const grants = await acl.listGrants("mayros:shared:ws1");
    expect(grants.length).toBe(1);
    expect(grants[0].level).toBe("admin");
  });
});

// ============================================================================
// Delegation Engine Tests
// ============================================================================

describe("delegation engine", () => {
  it("prepareContext returns valid DelegationContext", async () => {
    const { DelegationEngine } = await import("./delegation-engine.js");
    const { NamespaceManager } = await import("./namespace-manager.js");

    // We need to mock fetch for this test since DelegationEngine uses HTTP
    const originalFetch = globalThis.fetch;

    const mockTriples = [
      {
        id: "t1",
        subject: "mayros:memory:mem-1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "mayros:agent:parent-agent" },
      },
    ];

    const mockMemoryTriples = [
      {
        id: "t2",
        subject: "mayros:memory:mem-1",
        predicate: "mayros:memory:text",
        object: "The project uses TypeScript for backend development",
      },
      {
        id: "t3",
        subject: "mayros:memory:mem-1",
        predicate: "mayros:memory:category",
        object: "fact",
      },
    ];

    let callCount = 0;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      callCount++;
      const body = init?.body ? JSON.parse(init.body as string) : null;

      if (init?.method === "POST") {
        // Pattern query
        return new Response(JSON.stringify({ matches: mockTriples, total: 1 }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET — list triples
      return new Response(
        JSON.stringify({
          triples: mockMemoryTriples,
          total: mockMemoryTriples.length,
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    try {
      // Create a mock client for NamespaceManager
      const mockClient = {
        async createTriple() {
          return { subject: "", predicate: "", object: "" };
        },
        async listTriples() {
          return { triples: [], total: 0 };
        },
        async patternQuery() {
          return { matches: [], total: 0 };
        },
        async deleteTriple() {},
      };

      const nsMgr = new NamespaceManager(mockClient, "mayros", 50);
      const cortexClient = new CortexClient({ host: "127.0.0.1", port: 8080 });
      const engine = new DelegationEngine(cortexClient, "mayros", nsMgr);

      const ctx = await engine.prepareContext("Review the TypeScript backend code", "parent-agent");

      // Validate DelegationContext shape
      expect(ctx.task).toBe("Review the TypeScript backend code");
      expect(ctx.parentAgentId).toBe("parent-agent");
      expect(ctx.namespace).toBe("mayros:agent:parent-agent");
      expect(ctx.timestamp > 0).toBeTruthy();
      expect(Array.isArray(ctx.relevantTriples)).toBeTruthy();
      expect(Array.isArray(ctx.relatedMemories)).toBeTruthy();

      // Should have found relevant triples (task mentions "TypeScript", memory has "TypeScript")
      expect(ctx.relevantTriples.length > 0).toBeTruthy();
      expect(ctx.relatedMemories.length > 0).toBeTruthy();
      expect(ctx.relatedMemories[0]).toBe("mem-1");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("injectContext stores formatted context string", async () => {
    const { DelegationEngine } = await import("./delegation-engine.js");
    const { NamespaceManager } = await import("./namespace-manager.js");

    const mockClient = {
      async createTriple() {
        return { subject: "", predicate: "", object: "" };
      },
      async listTriples() {
        return { triples: [], total: 0 };
      },
      async patternQuery() {
        return { matches: [], total: 0 };
      },
      async deleteTriple() {},
    };

    const nsMgr = new NamespaceManager(mockClient, "mayros", 50);
    const cortexClient = new CortexClient({ host: "127.0.0.1", port: 8080 });
    const engine = new DelegationEngine(cortexClient, "mayros", nsMgr);

    const ctx = {
      task: "Test task",
      parentAgentId: "parent-1",
      relevantTriples: [{ subject: "s1", predicate: "p1", object: "o1" }],
      relatedMemories: ["mem-1"],
      namespace: "mayros:agent:parent-1",
      timestamp: Date.now(),
    };

    engine.injectContext("session-abc", ctx);

    const injected = engine.getInjectedContext("session-abc");
    expect(injected).toBeTruthy();
    expect(injected!.includes("<delegation-context>")).toBeTruthy();
    expect(injected!.includes("Test task")).toBeTruthy();
    expect(injected!.includes("parent-1")).toBeTruthy();
    expect(injected!.includes("</delegation-context>")).toBeTruthy();
    expect(injected!.includes("s1 p1")).toBeTruthy();
    expect(injected!.includes("mem-1")).toBeTruthy();
  });

  it("getInjectedContext returns undefined for unknown session", async () => {
    const { DelegationEngine } = await import("./delegation-engine.js");
    const { NamespaceManager } = await import("./namespace-manager.js");

    const mockClient = {
      async createTriple() {
        return { subject: "", predicate: "", object: "" };
      },
      async listTriples() {
        return { triples: [], total: 0 };
      },
      async patternQuery() {
        return { matches: [], total: 0 };
      },
      async deleteTriple() {},
    };

    const nsMgr = new NamespaceManager(mockClient, "mayros", 50);
    const cortexClient = new CortexClient({ host: "127.0.0.1", port: 8080 });
    const engine = new DelegationEngine(cortexClient, "mayros", nsMgr);

    const result = engine.getInjectedContext("nonexistent");
    expect(result).toBe(undefined);
  });
});

// ============================================================================
// Knowledge Fusion Tests
// ============================================================================

describe("knowledge fusion", () => {
  it("detectConflicts finds contradictions between namespaces", async () => {
    const { KnowledgeFusion } = await import("./knowledge-fusion.js");

    const originalFetch = globalThis.fetch;
    let queryCount = 0;

    // Mock data: two namespaces with conflicting values for the same subject/predicate
    const ns1Triples = [
      {
        id: "t1",
        subject: "mayros:memory:m1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "mayros:agent:agent-1" },
      },
    ];

    const ns1MemoryTriples = [
      {
        id: "t2",
        subject: "mayros:memory:m1",
        predicate: "mayros:memory:text",
        object: "The server runs on port 3000",
      },
      {
        id: "t3",
        subject: "mayros:memory:m1",
        predicate: "mayros:memory:category",
        object: "fact",
      },
    ];

    const ns2Triples = [
      {
        id: "t4",
        subject: "mayros:memory:m1",
        predicate: "mayros:memory:ownedBy",
        object: { node: "mayros:agent:agent-2" },
      },
    ];

    const ns2MemoryTriples = [
      {
        id: "t5",
        subject: "mayros:memory:m1",
        predicate: "mayros:memory:text",
        object: "The server runs on port 8080",
      },
      {
        id: "t6",
        subject: "mayros:memory:m1",
        predicate: "mayros:memory:category",
        object: "fact",
      },
    ];

    let postCallIndex = 0;
    let getCallIndex = 0;
    globalThis.fetch = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      const url = typeof _url === "string" ? _url : _url.toString();

      if (init?.method === "POST") {
        postCallIndex++;
        // First POST: query ns1 memories, Second POST: query ns2 memories
        const matches = postCallIndex === 1 ? ns1Triples : ns2Triples;
        return new Response(JSON.stringify({ matches, total: matches.length }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      // GET — list triples for a memory subject
      getCallIndex++;
      // First GET: ns1 memory triples, Second GET: ns2 memory triples
      const triples = getCallIndex === 1 ? ns1MemoryTriples : ns2MemoryTriples;
      return new Response(JSON.stringify({ triples, total: triples.length }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const fusionEngine = new KnowledgeFusion(
        new CortexClient({ host: "127.0.0.1", port: 8080 }),
        "mayros",
      );

      const conflicts = await fusionEngine.detectConflicts(
        "mayros:agent:agent-1",
        "mayros:agent:agent-2",
      );

      // Should detect a conflict on memory:text (different port values)
      expect(conflicts.length).toBeGreaterThan(0);

      const textConflict = conflicts.find((c) => c.predicate.includes("text"));
      if (textConflict) {
        expect(textConflict.values.length).toBeGreaterThanOrEqual(2);
        expect(textConflict.namespaces.length).toBe(2);
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("constructor does not throw", async () => {
    const { KnowledgeFusion } = await import("./knowledge-fusion.js");

    const fusion = new KnowledgeFusion(
      new CortexClient({ host: "127.0.0.1", port: 8080 }),
      "mayros",
    );
    expect(fusion).toBeTruthy();
  });

  it("constructor accepts auth token", async () => {
    const { KnowledgeFusion } = await import("./knowledge-fusion.js");

    const fusion = new KnowledgeFusion(
      new CortexClient({ host: "127.0.0.1", port: 8080, authToken: "Bearer secret" }),
      "mayros",
    );
    expect(fusion).toBeTruthy();
  });
});

// ============================================================================
// Teams Config Tests
// ============================================================================

describe("teams config", () => {
  it("parseTeamsConfig returns defaults", async () => {
    const { parseTeamsConfig } = await import("./config.js");

    const config = parseTeamsConfig(undefined);
    expect(config.maxTeamSize).toBe(8);
    expect(config.defaultStrategy).toBe("additive");
    expect(config.workflowTimeout).toBe(600);
  });

  it("parseTeamsConfig accepts valid values", async () => {
    const { parseTeamsConfig } = await import("./config.js");

    const config = parseTeamsConfig({
      maxTeamSize: 12,
      defaultStrategy: "newest-wins",
      workflowTimeout: 300,
    });
    expect(config.maxTeamSize).toBe(12);
    expect(config.defaultStrategy).toBe("newest-wins");
    expect(config.workflowTimeout).toBe(300);
  });
});

// ============================================================================
// Worktree Config Tests
// ============================================================================

describe("worktree config", () => {
  it("parseWorktreeConfig returns defaults", async () => {
    const { parseWorktreeConfig } = await import("./config.js");

    const config = parseWorktreeConfig(undefined);
    expect(config.enabled).toBe(false);
    expect(config.basePath).toBe(".mayros/worktrees");
  });

  it("parseWorktreeConfig accepts custom values", async () => {
    const { parseWorktreeConfig } = await import("./config.js");

    const config = parseWorktreeConfig({ enabled: true, basePath: "custom/path" });
    expect(config.enabled).toBe(true);
    expect(config.basePath).toBe("custom/path");
  });
});

import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { semanticSkillsConfigSchema } from "./config.js";
import { computeSkillDirHash } from "./index.js";
import { PermissionResolver, requiredPermissions } from "./permission-resolver.js";
import {
  parseSemanticManifest,
  validateManifest,
  DEFAULT_ALLOWED_TOOLS,
  type SemanticSkillManifest,
} from "./skill-manifest.js";
import { formatSkillContextXml, type SkillRuntimeContext } from "./skill-runtime.js";

// ============================================================================
// Config tests
// ============================================================================

describe("semanticSkillsConfigSchema", () => {
  it("parses minimal config", () => {
    const cfg = semanticSkillsConfigSchema.parse({});
    expect(cfg.cortex.host).toBe("127.0.0.1");
    expect(cfg.cortex.port).toBe(8080);
    expect(cfg.agentNamespace).toBe("mayros");
    expect(cfg.skillSandbox.maxGraphQueries).toBe(50);
    expect(cfg.skillSandbox.maxAssertions).toBe(20);
    expect(cfg.skillSandbox.proofTimeoutMs).toBe(5000);
    expect(cfg.skillSandbox.allowZkProofs).toBe(true);
    expect(cfg.skillSandbox.sandboxEnabled).toBe(true);
    expect(cfg.skillSandbox.childProcess).toBe(false);
    expect(cfg.skillSandbox.memoryLimitBytes).toBe(8 * 1024 * 1024);
    expect(cfg.skillSandbox.maxStackSizeBytes).toBe(512 * 1024);
    expect(cfg.skillSandbox.executionTimeoutMs).toBe(10_000);
    expect(cfg.skillSandbox.maxCallsPerMinute).toBe(60);
    expect(cfg.verification.requireSignature).toBe(true);
    expect(cfg.verification.polValidation).toBe(true);
    expect(cfg.verification.autoScan).toBe(true);
  });

  it("parses full config", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      cortex: { host: "10.0.0.1", port: 9090, authToken: "Bearer test" },
      agentNamespace: "custom-ns",
      skillSandbox: {
        maxGraphQueries: 100,
        maxAssertions: 50,
        proofTimeoutMs: 10000,
        allowZkProofs: false,
      },
      verification: {
        requireSignature: true,
        polValidation: false,
        autoScan: false,
      },
    });
    expect(cfg.cortex.host).toBe("10.0.0.1");
    expect(cfg.cortex.port).toBe(9090);
    expect(cfg.cortex.authToken).toBe("Bearer test");
    expect(cfg.agentNamespace).toBe("custom-ns");
    expect(cfg.skillSandbox.maxGraphQueries).toBe(100);
    expect(cfg.skillSandbox.allowZkProofs).toBe(false);
    expect(cfg.verification.requireSignature).toBe(true);
    expect(cfg.verification.polValidation).toBe(false);
  });

  it("rejects unknown keys", () => {
    expect(() => semanticSkillsConfigSchema.parse({ unknownKey: true })).toThrow("unknown keys");
  });

  it("rejects invalid namespace", () => {
    expect(() => semanticSkillsConfigSchema.parse({ agentNamespace: "123bad" })).toThrow(
      "agentNamespace",
    );
  });

  it("rejects invalid port", () => {
    expect(() => semanticSkillsConfigSchema.parse({ cortex: { port: 99999 } })).toThrow("port");
  });

  it("parses custom sandbox WASM config values", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: {
        sandboxEnabled: false,
        childProcess: true,
        memoryLimitBytes: 16 * 1024 * 1024,
        maxStackSizeBytes: 1024 * 1024,
        executionTimeoutMs: 30_000,
      },
    });
    expect(cfg.skillSandbox.sandboxEnabled).toBe(false);
    expect(cfg.skillSandbox.childProcess).toBe(true);
    expect(cfg.skillSandbox.memoryLimitBytes).toBe(16 * 1024 * 1024);
    expect(cfg.skillSandbox.maxStackSizeBytes).toBe(1024 * 1024);
    expect(cfg.skillSandbox.executionTimeoutMs).toBe(30_000);
  });

  it("rejects unknown sandbox keys", () => {
    expect(() =>
      semanticSkillsConfigSchema.parse({
        skillSandbox: { unknownSandboxKey: true },
      }),
    ).toThrow("unknown keys");
  });

  // P0-3: Bounds validation
  it("clamps memoryLimitBytes to minimum 1MB", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { memoryLimitBytes: 100 },
    });
    expect(cfg.skillSandbox.memoryLimitBytes).toBe(1024 * 1024);
  });

  it("clamps memoryLimitBytes to maximum 256MB", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { memoryLimitBytes: 999_999_999 },
    });
    expect(cfg.skillSandbox.memoryLimitBytes).toBe(256 * 1024 * 1024);
  });

  it("clamps executionTimeoutMs to minimum 100", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { executionTimeoutMs: 1 },
    });
    expect(cfg.skillSandbox.executionTimeoutMs).toBe(100);
  });

  it("clamps executionTimeoutMs to maximum 60000", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { executionTimeoutMs: 999_999 },
    });
    expect(cfg.skillSandbox.executionTimeoutMs).toBe(60_000);
  });

  it("clamps maxStackSizeBytes to bounds", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { maxStackSizeBytes: 1 },
    });
    expect(cfg.skillSandbox.maxStackSizeBytes).toBe(64 * 1024); // min
  });

  it("defaults non-number sandbox values to safe defaults", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: {
        memoryLimitBytes: "not-a-number",
        maxStackSizeBytes: null,
        executionTimeoutMs: true,
      },
    });
    expect(cfg.skillSandbox.memoryLimitBytes).toBe(8 * 1024 * 1024);
    expect(cfg.skillSandbox.maxStackSizeBytes).toBe(512 * 1024);
    expect(cfg.skillSandbox.executionTimeoutMs).toBe(10_000);
  });
});

// ============================================================================
// Manifest tests
// ============================================================================

describe("parseSemanticManifest", () => {
  it("returns undefined for non-semantic skills", () => {
    const result = parseSemanticManifest({ name: "test", description: "test" });
    expect(result).toBeUndefined();
  });

  it("parses a valid semantic manifest", () => {
    const frontmatter = {
      name: "verify-kyc",
      description: "KYC verification",
      type: "semantic",
      semantic: {
        version: 1,
        permissions: {
          graph: ["read", "write"],
          proofs: ["request", "verify"],
          memory: ["recall"],
        },
        assertions: [{ predicate: "kyc:verified", requireProof: true }],
        queries: [{ predicate: "kyc:level", scope: "agent" }],
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest).toBeDefined();
    expect(manifest!.version).toBe(1);
    expect(manifest!.permissions.graph).toEqual(["read", "write"]);
    expect(manifest!.permissions.proofs).toEqual(["request", "verify"]);
    expect(manifest!.permissions.memory).toEqual(["recall"]);
    expect(manifest!.assertions).toHaveLength(1);
    expect(manifest!.assertions[0].predicate).toBe("kyc:verified");
    expect(manifest!.assertions[0].requireProof).toBe(true);
    expect(manifest!.queries).toHaveLength(1);
    expect(manifest!.queries[0].scope).toBe("agent");
  });

  it("filters invalid permissions", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: {
          graph: ["read", "delete"],
          proofs: ["hack"],
          memory: ["recall", "forget"],
        },
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest).toBeDefined();
    expect(manifest!.permissions.graph).toEqual(["read"]);
    expect(manifest!.permissions.proofs).toEqual([]);
    expect(manifest!.permissions.memory).toEqual(["recall"]);
  });

  it("defaults query scope to agent", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
        queries: [{ predicate: "test:pred" }],
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest!.queries[0].scope).toBe("agent");
  });
});

describe("validateManifest", () => {
  it("validates a correct manifest", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: {
        graph: ["read", "write"],
        proofs: ["request", "verify"],
        memory: ["recall"],
      },
      assertions: [{ predicate: "kyc:verified", requireProof: true }],
      queries: [{ predicate: "kyc:level", scope: "agent" }],
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("reports missing proof permission for assertions", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read", "write"], proofs: [], memory: [] },
      assertions: [{ predicate: "test:claim", requireProof: true }],
      queries: [],
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("proofs:request");
  });

  it("reports missing graph:read for queries", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: [], proofs: [], memory: [] },
      assertions: [],
      queries: [{ predicate: "test:pred", scope: "agent" }],
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("graph:read");
  });

  it("reports missing graph:write for assertions", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read"], proofs: ["request"], memory: [] },
      assertions: [{ predicate: "test:claim", requireProof: true }],
      queries: [],
    };

    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("graph:write");
  });
});

// ============================================================================
// Permission resolver tests
// ============================================================================

describe("PermissionResolver", () => {
  const manifest: SemanticSkillManifest = {
    version: 1,
    permissions: {
      graph: ["read", "write"],
      proofs: ["request", "verify"],
      memory: ["recall"],
    },
    assertions: [],
    queries: [],
  };

  it("allows granted permissions", () => {
    const resolver = new PermissionResolver(manifest, "test-skill");
    expect(resolver.check("graph:read").allowed).toBe(true);
    expect(resolver.check("graph:write").allowed).toBe(true);
    expect(resolver.check("proofs:request").allowed).toBe(true);
    expect(resolver.check("memory:recall").allowed).toBe(true);
  });

  it("denies ungranted permissions", () => {
    const resolver = new PermissionResolver(manifest, "test-skill");
    expect(resolver.check("proofs:publish").allowed).toBe(false);
    expect(resolver.check("memory:remember").allowed).toBe(false);
  });

  it("provides denial reason", () => {
    const resolver = new PermissionResolver(manifest, "test-skill");
    const result = resolver.check("proofs:publish");
    expect(result.reason).toContain("test-skill");
    expect(result.reason).toContain("proofs:publish");
  });

  it("checks multiple permissions", () => {
    const resolver = new PermissionResolver(manifest, "test-skill");
    expect(resolver.checkAll(["graph:read", "proofs:verify"]).allowed).toBe(true);
    expect(resolver.checkAll(["graph:read", "proofs:publish"]).allowed).toBe(false);
  });

  it("lists all granted permissions", () => {
    const resolver = new PermissionResolver(manifest, "test-skill");
    const granted = resolver.listGranted();
    expect(granted).toContain("graph:read");
    expect(granted).toContain("graph:write");
    expect(granted).toContain("proofs:request");
    expect(granted).toContain("proofs:verify");
    expect(granted).toContain("memory:recall");
    expect(granted).not.toContain("proofs:publish");
  });
});

describe("requiredPermissions", () => {
  it("maps tool names to required permissions", () => {
    expect(requiredPermissions("skill_graph_query")).toEqual(["graph:read"]);
    expect(requiredPermissions("skill_assert")).toEqual(["graph:write"]);
    expect(requiredPermissions("skill_verify_assertion")).toEqual(["graph:read", "proofs:verify"]);
    expect(requiredPermissions("skill_request_zk_proof")).toEqual(["proofs:request"]);
    expect(requiredPermissions("skill_verify_zk_proof")).toEqual(["proofs:verify"]);
    expect(requiredPermissions("skill_memory_context")).toEqual(["memory:recall"]);
  });

  it("returns empty for unknown tools", () => {
    expect(requiredPermissions("unknown_tool")).toEqual([]);
  });
});

// ============================================================================
// Tool allowlist tests (Gap C)
// ============================================================================

describe("PermissionResolver.isToolAllowed", () => {
  it("allows all tools when no allowedTools is set (non-semantic backward compat)", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read"], proofs: [], memory: [] },
      assertions: [],
      queries: [],
      // allowedTools is undefined — non-semantic skills have this
    };
    const resolver = new PermissionResolver(manifest, "test-skill");
    expect(resolver.isToolAllowed("mesh_share_knowledge")).toBe(true);
    expect(resolver.isToolAllowed("hub_install")).toBe(true);
    expect(resolver.isToolAllowed("anything")).toBe(true);
  });

  it("always allows the 6 core semantic tools regardless of allowlist", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read"], proofs: [], memory: [] },
      assertions: [],
      queries: [],
      allowedTools: [], // empty allowlist
    };
    const resolver = new PermissionResolver(manifest, "test-skill");
    expect(resolver.isToolAllowed("skill_graph_query")).toBe(true);
    expect(resolver.isToolAllowed("skill_assert")).toBe(true);
    expect(resolver.isToolAllowed("skill_verify_assertion")).toBe(true);
    expect(resolver.isToolAllowed("skill_request_zk_proof")).toBe(true);
    expect(resolver.isToolAllowed("skill_verify_zk_proof")).toBe(true);
    expect(resolver.isToolAllowed("skill_memory_context")).toBe(true);
  });

  it("blocks tools not in the allowlist", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read"], proofs: [], memory: [] },
      assertions: [],
      queries: [],
      allowedTools: ["mesh_request_knowledge"],
    };
    const resolver = new PermissionResolver(manifest, "test-skill");
    expect(resolver.isToolAllowed("mesh_request_knowledge")).toBe(true);
    expect(resolver.isToolAllowed("mesh_share_knowledge")).toBe(false);
    expect(resolver.isToolAllowed("hub_install")).toBe(false);
    expect(resolver.isToolAllowed("mesh_delegate")).toBe(false);
  });

  it("allows explicitly listed non-semantic tools", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read", "write"], proofs: [], memory: [] },
      assertions: [],
      queries: [],
      allowedTools: ["mesh_share_knowledge", "hub_install"],
    };
    const resolver = new PermissionResolver(manifest, "test-skill");
    expect(resolver.isToolAllowed("mesh_share_knowledge")).toBe(true);
    expect(resolver.isToolAllowed("hub_install")).toBe(true);
    expect(resolver.isToolAllowed("mesh_delegate")).toBe(false);
  });
});

// ============================================================================
// Manifest parsing: allowedTools + maxQueries
// ============================================================================

describe("parseSemanticManifest — allowedTools & maxQueries", () => {
  it("parses allowedTools from frontmatter", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
        allowedTools: ["mesh_request_knowledge", "hub_search"],
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest).toBeDefined();
    expect(manifest!.allowedTools).toEqual(["mesh_request_knowledge", "hub_search"]);
  });

  it("applies default allowlist when allowedTools not specified", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest).toBeDefined();
    expect(manifest!.allowedTools).toEqual(DEFAULT_ALLOWED_TOOLS);
  });

  it("parses maxQueries from frontmatter", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
        maxQueries: 25,
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest!.maxQueries).toBe(25);
  });

  it("leaves maxQueries undefined when not specified", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest!.maxQueries).toBeUndefined();
  });
});

describe("validateManifest — maxQueries", () => {
  it("rejects maxQueries < 1", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read"], proofs: [], memory: [] },
      assertions: [],
      queries: [],
      maxQueries: 0,
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain("maxQueries");
  });

  it("accepts valid maxQueries", () => {
    const manifest: SemanticSkillManifest = {
      version: 1,
      permissions: { graph: ["read"], proofs: [], memory: [] },
      assertions: [],
      queries: [],
      maxQueries: 10,
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
  });
});

// ============================================================================
// Skill runtime context tests
// ============================================================================

describe("formatSkillContextXml", () => {
  it("returns empty string for no entries", () => {
    const ctx: SkillRuntimeContext = {
      skillName: "test",
      manifest: {
        version: 1,
        permissions: { graph: [], proofs: [], memory: [] },
        assertions: [],
        queries: [],
      },
      contextEntries: [],
    };
    expect(formatSkillContextXml(ctx)).toBe("");
  });

  it("formats context entries as XML", () => {
    const ctx: SkillRuntimeContext = {
      skillName: "verify-kyc",
      manifest: {
        version: 1,
        permissions: { graph: ["read"], proofs: [], memory: [] },
        assertions: [],
        queries: [{ predicate: "kyc:level", scope: "agent" }],
      },
      contextEntries: [
        {
          predicate: "kyc:level",
          matches: [
            { subject: "mayros:agent:a1", object: "tier-3" },
            { subject: "mayros:agent:a2", object: "tier-1" },
          ],
        },
      ],
    };

    const xml = formatSkillContextXml(ctx);
    expect(xml).toContain('<semantic-skill-context skill="verify-kyc">');
    expect(xml).toContain('<query predicate="kyc:level" count="2">');
    expect(xml).toContain('<result subject="mayros:agent:a1">tier-3</result>');
    expect(xml).toContain("</semantic-skill-context>");
  });
});

// ============================================================================
// Phase 5.5 — Default allowlist for semantic skills (Fix 3)
// ============================================================================

describe("parseSemanticManifest — default allowlist (Phase 5.5)", () => {
  it("applies DEFAULT_ALLOWED_TOOLS when allowedTools is not declared", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest).toBeDefined();
    expect(manifest!.allowedTools).toEqual(DEFAULT_ALLOWED_TOOLS);
    expect(manifest!.allowedTools).toContain("hub_search");
    expect(manifest!.allowedTools).toContain("mesh_request_knowledge");
  });

  it("preserves explicit allowedTools declaration", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
        allowedTools: ["custom_tool", "hub_search"],
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest!.allowedTools).toEqual(["custom_tool", "hub_search"]);
  });

  it("allows wildcard ['*'] as unrestricted escape hatch", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
        allowedTools: ["*"],
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest!.allowedTools).toEqual(["*"]);

    // PermissionResolver should allow everything with wildcard
    const resolver = new PermissionResolver(manifest!, "wildcard-skill");
    expect(resolver.isToolAllowed("anything_at_all")).toBe(true);
    expect(resolver.isToolAllowed("hub_install")).toBe(true);
    expect(resolver.isToolAllowed("dangerous_tool")).toBe(true);
  });

  it("default allowlist restricts non-listed tools via PermissionResolver", () => {
    const frontmatter = {
      type: "semantic",
      semantic: {
        version: 1,
        permissions: { graph: ["read"] },
        // no allowedTools → gets default
      } as unknown,
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    const resolver = new PermissionResolver(manifest!, "restricted-skill");

    // Default allowed tools should pass
    expect(resolver.isToolAllowed("hub_search")).toBe(true);
    expect(resolver.isToolAllowed("hub_verify")).toBe(true);
    expect(resolver.isToolAllowed("mesh_request_knowledge")).toBe(true);
    expect(resolver.isToolAllowed("skill_graph_query")).toBe(true); // always allowed (semantic tool)

    // Non-default tools should be blocked
    expect(resolver.isToolAllowed("hub_install")).toBe(false);
    expect(resolver.isToolAllowed("mesh_delegate")).toBe(false);
    expect(resolver.isToolAllowed("some_random_tool")).toBe(false);
  });

  it("non-semantic skills are unaffected (no manifest = no restriction)", () => {
    const frontmatter = {
      name: "plain-skill",
      description: "A regular skill",
    } as Record<string, string>;

    const manifest = parseSemanticManifest(frontmatter);
    expect(manifest).toBeUndefined();
  });
});

// ============================================================================
// Gap A2 — XML entity escaping in formatSkillContextXml
// ============================================================================

describe("formatSkillContextXml — XML escaping", () => {
  it("escapes < and > in subject", () => {
    const ctx: SkillRuntimeContext = {
      skillName: "test",
      manifest: {
        version: 1,
        permissions: { graph: ["read"], proofs: [], memory: [] },
        assertions: [],
        queries: [{ predicate: "test:pred", scope: "agent" }],
      },
      contextEntries: [
        {
          predicate: "test:pred",
          matches: [{ subject: '<script>alert("xss")</script>', object: "safe" }],
        },
      ],
    };
    const xml = formatSkillContextXml(ctx);
    expect(xml).not.toContain("<script>");
    expect(xml).toContain("&lt;script&gt;");
  });

  it("escapes & in object value", () => {
    const ctx: SkillRuntimeContext = {
      skillName: "test",
      manifest: {
        version: 1,
        permissions: { graph: ["read"], proofs: [], memory: [] },
        assertions: [],
        queries: [{ predicate: "test:pred", scope: "agent" }],
      },
      contextEntries: [
        {
          predicate: "test:pred",
          matches: [{ subject: "s1", object: "foo & bar" }],
        },
      ],
    };
    const xml = formatSkillContextXml(ctx);
    expect(xml).toContain("foo &amp; bar");
    expect(xml).not.toContain("foo & bar");
  });

  it("escapes double quotes in subject", () => {
    const ctx: SkillRuntimeContext = {
      skillName: "test",
      manifest: {
        version: 1,
        permissions: { graph: ["read"], proofs: [], memory: [] },
        assertions: [],
        queries: [{ predicate: "test:pred", scope: "agent" }],
      },
      contextEntries: [
        {
          predicate: "test:pred",
          matches: [{ subject: 'key="value"', object: "ok" }],
        },
      ],
    };
    const xml = formatSkillContextXml(ctx);
    expect(xml).toContain("key=&quot;value&quot;");
  });

  it("escapes injected XML tags in object", () => {
    const ctx: SkillRuntimeContext = {
      skillName: "test",
      manifest: {
        version: 1,
        permissions: { graph: ["read"], proofs: [], memory: [] },
        assertions: [],
        queries: [{ predicate: "test:pred", scope: "agent" }],
      },
      contextEntries: [
        {
          predicate: "test:pred",
          matches: [{ subject: "s1", object: '</result><injected attr="x">payload</injected>' }],
        },
      ],
    };
    const xml = formatSkillContextXml(ctx);
    expect(xml).not.toContain("<injected");
    expect(xml).toContain("&lt;injected");
  });
});

// ============================================================================
// Gap B — computeSkillDirHash
// ============================================================================

describe("computeSkillDirHash", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = join(tmpdir(), `skill-hash-test-${Date.now()}`);
    await mkdir(tmpDir, { recursive: true });
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true, force: true });
  });

  it("returns a hex hash for a directory with files", async () => {
    await writeFile(join(tmpDir, "SKILL.md"), "# Test Skill");
    await writeFile(join(tmpDir, "skill.ts"), "export default { name: 'test' }");
    const hash = await computeSkillDirHash(tmpDir);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("returns consistent hash for same content", async () => {
    await writeFile(join(tmpDir, "skill.ts"), "const x = 1;");
    const hash1 = await computeSkillDirHash(tmpDir);
    const hash2 = await computeSkillDirHash(tmpDir);
    expect(hash1).toBe(hash2);
  });

  it("changes hash when a .mjs file is added", async () => {
    await writeFile(join(tmpDir, "skill.ts"), "const x = 1;");
    const hash1 = await computeSkillDirHash(tmpDir);
    await writeFile(join(tmpDir, "helper.mjs"), "export const y = 2;");
    const hash2 = await computeSkillDirHash(tmpDir);
    expect(hash1).not.toBe(hash2);
  });

  it("changes hash when file content changes", async () => {
    await writeFile(join(tmpDir, "skill.ts"), "const x = 1;");
    const hash1 = await computeSkillDirHash(tmpDir);
    await writeFile(join(tmpDir, "skill.ts"), "const x = 2;");
    const hash2 = await computeSkillDirHash(tmpDir);
    expect(hash1).not.toBe(hash2);
  });

  it("ignores non-scannable extensions like .json and .png", async () => {
    await writeFile(join(tmpDir, "skill.ts"), "const x = 1;");
    const hash1 = await computeSkillDirHash(tmpDir);
    await writeFile(join(tmpDir, "data.json"), '{"key": "value"}');
    await writeFile(join(tmpDir, "icon.png"), "fake-png-data");
    const hash2 = await computeSkillDirHash(tmpDir);
    expect(hash1).toBe(hash2);
  });

  it("returns a hash for non-existent directory", async () => {
    const hash = await computeSkillDirHash("/non/existent/dir");
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("includes .cjs, .mts, .cts, .jsx, .tsx extensions", async () => {
    await writeFile(join(tmpDir, "a.cjs"), "module.exports = 1;");
    const hash1 = await computeSkillDirHash(tmpDir);
    await writeFile(join(tmpDir, "b.tsx"), "export const C = () => null;");
    const hash2 = await computeSkillDirHash(tmpDir);
    expect(hash1).not.toBe(hash2);
  });
});

// ============================================================================
// Gap D — requireSignature defaults to true
// ============================================================================

describe("requireSignature default (Gap D)", () => {
  it("defaults to true when not specified", () => {
    const cfg = semanticSkillsConfigSchema.parse({});
    expect(cfg.verification.requireSignature).toBe(true);
  });

  it("can be explicitly set to false", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      verification: { requireSignature: false },
    });
    expect(cfg.verification.requireSignature).toBe(false);
  });

  it("remains true when explicitly set to true", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      verification: { requireSignature: true },
    });
    expect(cfg.verification.requireSignature).toBe(true);
  });
});

// ============================================================================
// Rate limiter config
// ============================================================================

describe("maxCallsPerMinute config", () => {
  it("defaults to 60", () => {
    const cfg = semanticSkillsConfigSchema.parse({});
    expect(cfg.skillSandbox.maxCallsPerMinute).toBe(60);
  });

  it("accepts custom value", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { maxCallsPerMinute: 120 },
    });
    expect(cfg.skillSandbox.maxCallsPerMinute).toBe(120);
  });

  it("clamps to minimum 1", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { maxCallsPerMinute: 0 },
    });
    expect(cfg.skillSandbox.maxCallsPerMinute).toBe(1);
  });

  it("clamps to maximum 1000", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { maxCallsPerMinute: 9999 },
    });
    expect(cfg.skillSandbox.maxCallsPerMinute).toBe(1000);
  });

  it("defaults non-number to 60", () => {
    const cfg = semanticSkillsConfigSchema.parse({
      skillSandbox: { maxCallsPerMinute: "fast" },
    });
    expect(cfg.skillSandbox.maxCallsPerMinute).toBe(60);
  });
});

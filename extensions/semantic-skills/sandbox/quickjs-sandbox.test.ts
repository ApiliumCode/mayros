import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { QuickJSSandbox, type SandboxOptions, type LoggerLike } from "./quickjs-sandbox.js";
import type { CortexClientLike } from "../../shared/cortex-client.js";

// ============================================================================
// Test helpers
// ============================================================================

function makeMockGraphClient(): CortexClientLike {
  return {
    createTriple: vi
      .fn()
      .mockResolvedValue({ id: "triple-1", subject: "s", predicate: "p", object: "o" }),
    listTriples: vi.fn().mockResolvedValue({ triples: [], total: 0 }),
    patternQuery: vi.fn().mockResolvedValue({ matches: [], total: 0 }),
    deleteTriple: vi.fn().mockResolvedValue(undefined),
  };
}

function makeMockLogger(): LoggerLike {
  return {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  };
}

const VALID_SKILL = `
  var runtime = {
    name: "test-skill",
    onActivate: function(ctx) {
      logger.info("activated: " + ctx.namespace);
    },
    onQuery: function(ctx) {
      return { results: ctx.results, additionalContext: "enriched" };
    },
  };
  export default runtime;
`;

const MINIMAL_SKILL = `
  export default { name: "minimal" };
`;

const ASYNC_SKILL = `
  var runtime = {
    name: "async-skill",
    onQuery: async function(ctx) {
      var triples = await graphClient.listTriples({ subject: "test" });
      return { results: ctx.results, additionalContext: "count:" + triples.total };
    },
  };
  export default runtime;
`;

// ============================================================================
// Init / Dispose lifecycle
// ============================================================================

describe("QuickJSSandbox — lifecycle", () => {
  let sandbox: QuickJSSandbox;

  afterEach(() => {
    if (sandbox && !sandbox.isDisposed) sandbox.dispose();
  });

  it("initializes and disposes cleanly", async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
    expect(sandbox.isDisposed).toBe(false);
    sandbox.dispose();
    expect(sandbox.isDisposed).toBe(true);
  });

  it("throws on double init", async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
    await expect(sandbox.init()).rejects.toThrow("already initialized");
  });

  it("throws on init after dispose", async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
    sandbox.dispose();
    await expect(sandbox.init()).rejects.toThrow("disposed");
  });

  it("double dispose is safe", async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
    sandbox.dispose();
    expect(() => sandbox.dispose()).not.toThrow();
  });

  it("throws loadSkill before init", async () => {
    sandbox = new QuickJSSandbox();
    await expect(sandbox.loadSkill("var x = 1;")).rejects.toThrow("not initialized");
  });
});

// ============================================================================
// Skill loading
// ============================================================================

describe("QuickJSSandbox — loadSkill", () => {
  let sandbox: QuickJSSandbox;

  beforeEach(async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
  });

  afterEach(() => {
    if (!sandbox.isDisposed) sandbox.dispose();
  });

  it("loads a valid skill and returns its name", async () => {
    const name = await sandbox.loadSkill(VALID_SKILL, "skill.js");
    expect(name).toBe("test-skill");
  });

  it("loads a minimal skill", async () => {
    const name = await sandbox.loadSkill(MINIMAL_SKILL, "skill.js");
    expect(name).toBe("minimal");
  });

  it("rejects skill without name", async () => {
    await expect(sandbox.loadSkill(`export default { value: 42 };`, "skill.js")).rejects.toThrow(
      "name",
    );
  });

  it("rejects skill with empty name", async () => {
    await expect(sandbox.loadSkill(`export default { name: "" };`, "skill.js")).rejects.toThrow(
      "non-empty",
    );
  });

  it("rejects malformed JS", async () => {
    await expect(sandbox.loadSkill("function {{{ invalid", "skill.js")).rejects.toThrow();
  });

  it("rejects skill that returns non-object", async () => {
    await expect(sandbox.loadSkill(`export default 42;`, "skill.js")).rejects.toThrow("name");
  });
});

// ============================================================================
// Proxy calls — onActivate, onQuery
// ============================================================================

describe("QuickJSSandbox — runtime proxy", () => {
  let sandbox: QuickJSSandbox;
  let graphClient: CortexClientLike;
  let logger: LoggerLike;

  beforeEach(async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
    graphClient = makeMockGraphClient();
    logger = makeMockLogger();
  });

  afterEach(() => {
    if (!sandbox.isDisposed) sandbox.dispose();
  });

  it("createRuntimeProxy returns SkillRuntime with correct name", async () => {
    await sandbox.loadSkill(VALID_SKILL, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    expect(runtime.name).toBe("test-skill");
    expect(runtime.onActivate).toBeDefined();
    expect(runtime.onQuery).toBeDefined();
  });

  it("minimal skill has no lifecycle hooks", async () => {
    await sandbox.loadSkill(MINIMAL_SKILL, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    expect(runtime.name).toBe("minimal");
    expect(runtime.onActivate).toBeUndefined();
    expect(runtime.onQuery).toBeUndefined();
    expect(runtime.onDeactivate).toBeUndefined();
    expect(runtime.onError).toBeUndefined();
  });

  it("onActivate calls logger.info inside sandbox", async () => {
    await sandbox.loadSkill(VALID_SKILL, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    await runtime.onActivate!({
      namespace: "test-ns",
      agentId: "a1",
      graphClient: graphClient as any,
      logger: logger as any,
    });
    expect(logger.info).toHaveBeenCalledWith("[skill:test-skill] activated: test-ns");
  });

  it("onQuery returns enriched results", async () => {
    await sandbox.loadSkill(VALID_SKILL, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    const result = await runtime.onQuery!({
      namespace: "ns",
      agentId: "a1",
      predicate: "test:pred",
      scope: "agent",
      results: [{ subject: "s1", object: "v1" }],
    });
    expect(result).toBeDefined();
    expect(result.additionalContext).toBe("enriched");
    expect(result.results).toEqual([{ subject: "s1", object: "v1" }]);
  });
});

// ============================================================================
// graphClient bridging
// ============================================================================

describe("QuickJSSandbox — graphClient bridge", () => {
  let sandbox: QuickJSSandbox;
  let graphClient: CortexClientLike;
  let logger: LoggerLike;

  beforeEach(async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
    graphClient = makeMockGraphClient();
    logger = makeMockLogger();
  });

  afterEach(() => {
    if (!sandbox.isDisposed) sandbox.dispose();
  });

  it("skill can call graphClient.listTriples via async bridge", async () => {
    (graphClient.listTriples as ReturnType<typeof vi.fn>).mockResolvedValue({
      triples: [{ id: "t1", subject: "s", predicate: "p", object: "o" }],
      total: 1,
    });
    await sandbox.loadSkill(ASYNC_SKILL, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    const result = await runtime.onQuery!({
      namespace: "ns",
      agentId: "a1",
      predicate: "test:pred",
      scope: "agent",
      results: [],
    });
    expect(graphClient.listTriples).toHaveBeenCalledWith({ subject: "test" });
    expect(result.additionalContext).toBe("count:1");
  });

  it("skill can call graphClient.createTriple", async () => {
    const skill = `
      var runtime = {
        name: "create-skill",
        onActivate: async function(ctx) {
          await graphClient.createTriple({
            subject: "ns:test",
            predicate: "test:pred",
            object: "value",
          });
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    await runtime.onActivate!({
      namespace: "ns",
      agentId: "a1",
      graphClient: graphClient as any,
      logger: logger as any,
    });
    expect(graphClient.createTriple).toHaveBeenCalledWith({
      subject: "ns:test",
      predicate: "test:pred",
      object: "value",
    });
  });

  it("skill can call graphClient.patternQuery", async () => {
    (graphClient.patternQuery as ReturnType<typeof vi.fn>).mockResolvedValue({
      matches: [{ id: "m1", subject: "s", predicate: "p", object: "o" }],
      total: 1,
    });
    const skill = `
      var runtime = {
        name: "pattern-skill",
        onQuery: async function(ctx) {
          var res = await graphClient.patternQuery({ predicate: "test:p" });
          return { results: ctx.results, additionalContext: "matches:" + res.total };
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    const result = await runtime.onQuery!({
      namespace: "ns",
      agentId: "a1",
      predicate: "test:pred",
      scope: "agent",
      results: [],
    });
    expect(graphClient.patternQuery).toHaveBeenCalledWith({ predicate: "test:p" });
    expect(result.additionalContext).toBe("matches:1");
  });

  it("skill can call graphClient.deleteTriple", async () => {
    const skill = `
      var runtime = {
        name: "delete-skill",
        onActivate: async function(ctx) {
          await graphClient.deleteTriple("triple-123");
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const runtime = sandbox.createRuntimeProxy(graphClient, logger);
    await runtime.onActivate!({
      namespace: "ns",
      agentId: "a1",
      graphClient: graphClient as any,
      logger: logger as any,
    });
    expect(graphClient.deleteTriple).toHaveBeenCalledWith("triple-123");
  });
});

// ============================================================================
// Logger bridging
// ============================================================================

describe("QuickJSSandbox — logger bridge", () => {
  let sandbox: QuickJSSandbox;

  afterEach(() => {
    if (sandbox && !sandbox.isDisposed) sandbox.dispose();
  });

  it("logger.info, warn, error are called from sandbox", async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
    const logger = makeMockLogger();
    const skill = `
      var runtime = {
        name: "log-skill",
        onActivate: function(ctx) {
          logger.info("info msg");
          logger.warn("warn msg");
          logger.error("error msg");
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const runtime = sandbox.createRuntimeProxy(makeMockGraphClient(), logger);
    await runtime.onActivate!({
      namespace: "ns",
      agentId: "a1",
      graphClient: makeMockGraphClient() as any,
      logger: logger as any,
    });
    expect(logger.info).toHaveBeenCalledWith("[skill:log-skill] info msg");
    expect(logger.warn).toHaveBeenCalledWith("[skill:log-skill] warn msg");
    expect(logger.error).toHaveBeenCalledWith("[skill:log-skill] error msg");
  });
});

// ============================================================================
// Isolation — Node.js APIs must NOT exist
// ============================================================================

describe("QuickJSSandbox — isolation", () => {
  let sandbox: QuickJSSandbox;

  beforeEach(async () => {
    sandbox = new QuickJSSandbox();
    await sandbox.init();
  });

  afterEach(() => {
    if (!sandbox.isDisposed) sandbox.dispose();
  });

  it("require('fs') throws ReferenceError", async () => {
    const skill = `
      var runtime = {
        name: "evil-fs",
        onActivate: function() { require("fs"); },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
  });

  it("require('child_process') throws", async () => {
    const skill = `
      var runtime = {
        name: "evil-cp",
        onActivate: function() { require("child_process"); },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
  });

  it("process.env is not defined", async () => {
    const skill = `
      var runtime = {
        name: "evil-env",
        onActivate: function() {
          var x = process.env.SECRET;
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
  });

  it("globalThis.process is not defined", async () => {
    const skill = `
      var runtime = {
        name: "evil-global",
        onActivate: function() {
          var p = globalThis.process;
          if (p) p.exit(1);
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    // Should not throw (globalThis.process is undefined, so p is falsy)
    await rt.onActivate!({
      namespace: "ns",
      agentId: "a1",
      graphClient: makeMockGraphClient() as any,
      logger: makeMockLogger() as any,
    });
  });

  it("fetch() is not defined", async () => {
    const skill = `
      var runtime = {
        name: "evil-fetch",
        onActivate: function() {
          var f = fetch;
          f("https://evil.com");
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
  });

  it("string concat evasion for require does not work", async () => {
    const skill = `
      var runtime = {
        name: "evil-concat",
        onActivate: function() {
          var mod = "child" + "_process";
          require(mod);
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
  });

  it("new Worker() is not available", async () => {
    const skill = `
      var runtime = {
        name: "evil-worker",
        onActivate: function() { new Worker("evil.js"); },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
  });

  it("setTimeout is not available", async () => {
    const skill = `
      var runtime = {
        name: "evil-timeout",
        onActivate: function() { setTimeout(function(){}, 0); },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
  });
});

// ============================================================================
// Memory limit enforcement
// ============================================================================

describe("QuickJSSandbox — memory limit", () => {
  it("rejects skill that allocates beyond memory limit", async () => {
    const sandbox = new QuickJSSandbox({ memoryLimitBytes: 256 * 1024 }); // 256KB
    await sandbox.init();
    const skill = `
      var runtime = {
        name: "mem-bomb",
        onActivate: function() {
          var arr = [];
          for (var i = 0; i < 1000000; i++) {
            arr.push("x".repeat(1000));
          }
        },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
    sandbox.dispose();
  });
});

// ============================================================================
// Execution timeout enforcement
// ============================================================================

describe("QuickJSSandbox — execution timeout", () => {
  it("interrupts infinite loop during loadSkill", async () => {
    const sandbox = new QuickJSSandbox({ executionTimeoutMs: 500 });
    await sandbox.init();
    const skill = `
      while (true) {}
      export default { name: "infinite" };
    `;
    await expect(sandbox.loadSkill(skill, "skill.js")).rejects.toThrow();
    sandbox.dispose();
  });

  it("interrupts infinite loop during onActivate", async () => {
    const sandbox = new QuickJSSandbox({ executionTimeoutMs: 500 });
    await sandbox.init();
    const skill = `
      var runtime = {
        name: "loop-skill",
        onActivate: function() { while (true) {} },
      };
      export default runtime;
    `;
    await sandbox.loadSkill(skill, "skill.js");
    const rt = sandbox.createRuntimeProxy(makeMockGraphClient(), makeMockLogger());
    await expect(
      rt.onActivate!({
        namespace: "ns",
        agentId: "a1",
        graphClient: makeMockGraphClient() as any,
        logger: makeMockLogger() as any,
      }),
    ).rejects.toThrow();
    sandbox.dispose();
  });
});

/**
 * Tests for the unified CortexClient + config helpers.
 */

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  CortexClient,
  CortexError,
  type CortexConfig,
  type CortexClientLike,
  type CortexLike,
  type TripleDto,
  type PatternQueryResponse,
  type TripleMatch,
} from "./cortex-client.js";
import { parseCortexConfig, assertAllowedKeys, resolveEnvVars } from "./cortex-config.js";

// ============================================================================
// Config helpers
// ============================================================================

describe("assertAllowedKeys", () => {
  it("passes when all keys are allowed", () => {
    expect(() => assertAllowedKeys({ a: 1, b: 2 }, ["a", "b", "c"], "test")).not.toThrow();
  });

  it("throws on unknown keys", () => {
    expect(() => assertAllowedKeys({ a: 1, x: 2 }, ["a", "b"], "test")).toThrow(
      "test has unknown keys: x",
    );
  });
});

describe("resolveEnvVars", () => {
  beforeEach(() => {
    process.env.TEST_VAR = "hello";
  });

  afterEach(() => {
    delete process.env.TEST_VAR;
  });

  it("resolves ${VAR} patterns", () => {
    expect(resolveEnvVars("Bearer ${TEST_VAR}")).toBe("Bearer hello");
  });

  it("throws for missing env vars", () => {
    expect(() => resolveEnvVars("${NOPE_NOT_SET}")).toThrow(
      "Environment variable NOPE_NOT_SET is not set",
    );
  });

  it("returns string unchanged when no vars", () => {
    expect(resolveEnvVars("plain")).toBe("plain");
  });
});

describe("parseCortexConfig", () => {
  it("returns defaults for undefined input", () => {
    const cfg = parseCortexConfig(undefined);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.port).toBe(8080);
    expect(cfg.authToken).toBeUndefined();
    expect(cfg.resilience).toBeUndefined();
    expect(cfg.strictVersionCheck).toBe(false);
  });

  it("parses all fields", () => {
    const cfg = parseCortexConfig({
      host: "10.0.0.1",
      port: 9090,
      binaryPath: "/usr/bin/cortex",
      autoStart: true,
      authToken: "Bearer secret",
    });
    expect(cfg.host).toBe("10.0.0.1");
    expect(cfg.port).toBe(9090);
    expect(cfg.binaryPath).toBe("/usr/bin/cortex");
    expect(cfg.autoStart).toBe(true);
    expect(cfg.authToken).toBe("Bearer secret");
  });

  it("rejects unknown keys", () => {
    expect(() => parseCortexConfig({ host: "x", bogus: true })).toThrow("unknown keys: bogus");
  });

  it("rejects invalid port", () => {
    expect(() => parseCortexConfig({ port: 0 })).toThrow("between 1 and 65535");
    expect(() => parseCortexConfig({ port: 99999 })).toThrow("between 1 and 65535");
  });

  it("parses strictVersionCheck", () => {
    const cfg = parseCortexConfig({ strictVersionCheck: true });
    expect(cfg.strictVersionCheck).toBe(true);
  });

  it("strictVersionCheck defaults to false", () => {
    const cfg = parseCortexConfig({});
    expect(cfg.strictVersionCheck).toBe(false);
  });

  it("parses resilience sub-config", () => {
    const cfg = parseCortexConfig({
      resilience: {
        timeoutMs: 3000,
        maxRetries: 1,
        retryDelayMs: 100,
        circuitThreshold: 3,
        circuitResetMs: 10000,
      },
    });
    expect(cfg.resilience).toEqual({
      timeoutMs: 3000,
      maxRetries: 1,
      retryDelayMs: 100,
      circuitThreshold: 3,
      circuitResetMs: 10000,
    });
  });
});

// ============================================================================
// CortexError
// ============================================================================

describe("CortexError", () => {
  it("has structured fields", () => {
    const err = new CortexError("bad request", 400, "INVALID", "nope");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("CortexError");
    expect(err.message).toBe("bad request");
    expect(err.status).toBe(400);
    expect(err.code).toBe("INVALID");
    expect(err.details).toBe("nope");
  });
});

// ============================================================================
// CortexClient
// ============================================================================

describe("CortexClient", () => {
  let client: CortexClient;

  beforeEach(() => {
    client = new CortexClient({ host: "127.0.0.1", port: 8080 });
    // Mock global fetch
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  function mockFetch(status: number, body: unknown = {}) {
    (fetch as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(JSON.stringify(body)),
    } as unknown as Response);
  }

  it("builds correct base URL", () => {
    expect(client.baseUrl).toBe("http://127.0.0.1:8080");
  });

  it("createTriple sends POST to /api/v1/triples", async () => {
    const triple: TripleDto = { id: "1", subject: "s", predicate: "p", object: "o" };
    mockFetch(200, triple);

    const result = await client.createTriple({ subject: "s", predicate: "p", object: "o" });
    expect(result).toEqual(triple);

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("http://127.0.0.1:8080/api/v1/triples");
    expect(JSON.parse(call[1].body)).toEqual({ subject: "s", predicate: "p", object: "o" });
  });

  it("listTriples sends GET with query string", async () => {
    mockFetch(200, { triples: [], total: 0 });

    await client.listTriples({ subject: "s", limit: 10 });

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("subject=s");
    expect(call[0]).toContain("limit=10");
  });

  it("patternQuery sends POST to /api/v1/query", async () => {
    mockFetch(200, { matches: [], total: 0 });

    await client.patternQuery({ predicate: "p", limit: 5 });

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("http://127.0.0.1:8080/api/v1/query");
  });

  it("deleteTriple sends DELETE", async () => {
    mockFetch(204);

    await client.deleteTriple("abc");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/triples/abc");
    expect(call[1].method).toBe("DELETE");
  });

  it("isHealthy returns true for healthy status", async () => {
    mockFetch(200, { status: "healthy" });
    expect(await client.isHealthy()).toBe(true);
  });

  it("isHealthy returns true for ok status", async () => {
    mockFetch(200, { status: "ok" });
    expect(await client.isHealthy()).toBe(true);
  });

  it("isHealthy returns false on error", async () => {
    (fetch as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("fail"));
    expect(await client.isHealthy()).toBe(false);
  });

  it("stats returns graph and server data", async () => {
    const body = {
      graph: { triple_count: 100, subject_count: 30, predicate_count: 10 },
      server: { connected_clients: 2, uptime_seconds: 3600, version: "0.2.4" },
    };
    mockFetch(200, body);

    const result = await client.stats();
    expect(result.graph.triple_count).toBe(100);
    expect(result.server.version).toBe("0.2.4");
  });

  it("throws CortexError on non-2xx response", async () => {
    mockFetch(404, { error: "not found", code: "NOT_FOUND" });

    await expect(client.getTriple("missing")).rejects.toThrow(CortexError);
  });

  // --- Skill verification ---

  it("validateSkillManifest sends POST", async () => {
    mockFetch(200, { valid: true, errors: [] });

    const result = await client.validateSkillManifest({
      assertions: [{ predicate: "p", requireProof: true }],
      namespace: "ns",
    });
    expect(result.valid).toBe(true);
  });

  it("createSandbox sends POST", async () => {
    mockFetch(200, { id: "sb1", namespace: "test" });

    const result = await client.createSandbox("test", 60);
    expect(result.id).toBe("sb1");
  });

  it("deleteSandbox sends DELETE", async () => {
    mockFetch(204);

    await client.deleteSandbox("sb1");

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toContain("/api/v1/skills/sandbox/sb1");
  });

  // --- Reputation ---

  it("getConsistency sends GET", async () => {
    mockFetch(200, { score: 0.9, total: 50, verified: 45 });

    const result = await client.getConsistency("agent1");
    expect(result.score).toBe(0.9);
  });

  it("batchVerifyAssertions sends POST", async () => {
    mockFetch(200, { results: [{ subject: "s", predicate: "p", verified: true }] });

    const result = await client.batchVerifyAssertions([{ subject: "s", predicate: "p" }]);
    expect(result.results).toHaveLength(1);
  });

  // --- Events ---

  it("emitEvents sends POST to /api/v1/events", async () => {
    mockFetch(200);

    await client.emitEvents([
      {
        subject: "ns:event:1",
        type: "tool_call",
        agentId: "a",
        timestamp: "2024-01-01T00:00:00Z",
        fields: { toolName: "test" },
      },
    ]);

    const call = (fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(call[0]).toBe("http://127.0.0.1:8080/api/v1/events");
  });

  it("getEvents sends GET with query params", async () => {
    mockFetch(200, { events: [] });

    const result = await client.getEvents({ agentId: "a1" });
    expect(result.events).toEqual([]);
  });

  // --- Proofs ---

  it("listPredicates sends GET to /api/v1/query/predicates", async () => {
    mockFetch(200, { predicates: ["p1", "p2"], total: 2 });

    const result = await client.listPredicates({ namespace: "ns", limit: 10 });
    expect(result.predicates).toEqual(["p1", "p2"]);
  });

  it("batchVerify sends POST to /api/v1/proofs/verify/batch", async () => {
    mockFetch(200, { results: [{ id: "p1", verified: true }] });

    const result = await client.batchVerify(["p1"]);
    expect(result.results).toHaveLength(1);
  });

  // --- destroy() ---

  it("destroy() resets breaker state", () => {
    client.breaker.recordFailure();
    expect(client.breaker.getFailures()).toBe(1);
    client.destroy();
    expect(client.breaker.getFailures()).toBe(0);
    expect(client.breaker.getState()).toBe("closed");
    expect(client.isDestroyed).toBe(true);
  });

  it("request() after destroy() throws CLIENT_DESTROYED", async () => {
    client.destroy();
    await expect(client.isHealthy()).resolves.toBe(false);
    await expect(
      client.createTriple({ subject: "s", predicate: "p", object: "o" }),
    ).rejects.toThrow("Client has been destroyed");

    // Verify error code
    try {
      await client.createTriple({ subject: "s", predicate: "p", object: "o" });
    } catch (err) {
      expect((err as CortexError).code).toBe("CLIENT_DESTROYED");
    }
  });

  it("multiple destroy() calls are idempotent", () => {
    client.destroy();
    client.destroy();
    expect(client.isDestroyed).toBe(true);
  });

  it("isDestroyed is false initially", () => {
    expect(client.isDestroyed).toBe(false);
  });
});

// ============================================================================
// Type compatibility
// ============================================================================

describe("type compatibility", () => {
  it("CortexClient satisfies CortexClientLike", () => {
    const client = new CortexClient({ host: "localhost", port: 8080 });
    const _like: CortexClientLike = client;
    expect(_like).toBeDefined();
  });

  it("CortexClient satisfies CortexLike", () => {
    const client = new CortexClient({ host: "localhost", port: 8080 });
    const _like: CortexLike = client;
    expect(_like).toBeDefined();
  });

  it("TripleMatch is a valid type alias", () => {
    const match: TripleMatch = { subject: "s", predicate: "p", object: "o" };
    expect(match.subject).toBe("s");
  });
});

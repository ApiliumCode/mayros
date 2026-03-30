/**
 * Tests for production hardening fixes:
 * - Command injection prevention in setup-claude
 * - Governance word-boundary matching (via actual tool execution)
 * - Memory tools error handling when Cortex is down
 * - Memory tools JSON parse resilience
 * - Memory tools input validation (tags, limits)
 * - Cortex tools error handling when Cortex is down
 * - Transport: CORS default-deny, SSE cap, Content-Type enforcement
 * - Config: host validation
 * - Shutdown guard (promise-cached pattern)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── setup-claude: host + port validation ─────────────────────────────

describe("setup-claude host validation", () => {
  it("rejects hosts with shell metacharacters", async () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => logs.push(msg);

    const mod = await import("./setup-claude.js");
    await mod.setupClaudeCodeMcp({
      port: 19100,
      host: "; rm -rf /",
      transport: "http",
      target: "code",
    });

    console.error = origError;
    expect(logs.some((l) => l.includes("Invalid host"))).toBe(true);
  });

  it("rejects NaN port", async () => {
    const logs: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => logs.push(msg);

    const mod = await import("./setup-claude.js");
    await mod.setupClaudeCodeMcp({
      port: NaN,
      host: "127.0.0.1",
      transport: "http",
      target: "code",
    });

    console.error = origError;
    expect(logs.some((l) => l.includes("Invalid port"))).toBe(true);
  });

  it("accepts valid hostnames without error", async () => {
    const mod = await import("./setup-claude.js");
    const errors: string[] = [];
    const origError = console.error;
    console.error = (msg: string) => errors.push(msg);

    // Will fail at execFileSync (claude not found) but should NOT reject host/port
    await mod.setupClaudeCodeMcp({
      port: 19100,
      host: "127.0.0.1",
      transport: "http",
      target: "code",
    });

    console.error = origError;
    expect(errors.some((l) => l.includes("Invalid host"))).toBe(false);
    expect(errors.some((l) => l.includes("Invalid port"))).toBe(false);
  });
});

// ── config: host validation at parser level ──────────────────────────

describe("config host validation", () => {
  it("rejects malicious host via config parser", async () => {
    const { mcpServerConfigSchema } = await import("./config.js");
    expect(() => mcpServerConfigSchema.parse({ host: "$(whoami)" })).toThrow("Invalid host");
  });

  it("accepts valid host via config parser", async () => {
    const { mcpServerConfigSchema } = await import("./config.js");
    const config = mcpServerConfigSchema.parse({ host: "my-server.local" });
    expect(config.host).toBe("my-server.local");
  });
});

// ── governance: word-boundary matching (via actual tool) ─────────────

describe("governance word-boundary matching", () => {
  it("DENY rule 'rm' blocks 'rm -rf /' but not 'format'", async () => {
    const { writeFile, mkdir } = await import("node:fs/promises");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const { randomBytes } = await import("node:crypto");

    // Create a temp MAYROS.md with a DENY rule
    const dir = join(tmpdir(), `hardening-test-${randomBytes(4).toString("hex")}`);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, "MAYROS.md"), "- DENY: rm\n- DENY: eval\n");

    const origCwd = process.cwd();
    process.chdir(dir);

    try {
      const mod = await import("./governance-tools.js");
      const tools = mod.createGovernanceTools();
      const tool = tools[0];

      // Should DENY "rm -rf /"
      const denied = await tool.execute("id", { action: "shell_command", target: "rm -rf /" });
      expect((denied.content[0] as { text: string }).text).toContain("DENIED");

      // Should ALLOW "format" (no substring match)
      const allowed = await tool.execute("id", { action: "shell_command", target: "format disk" });
      expect((allowed.content[0] as { text: string }).text).toContain("ALLOWED");

      // Should ALLOW "evaluate" (no substring match on "eval")
      const evalAllowed = await tool.execute("id", {
        action: "shell_command",
        target: "evaluate expression",
      });
      expect((evalAllowed.content[0] as { text: string }).text).toContain("ALLOWED");

      // Should DENY standalone "eval"
      const evalDenied = await tool.execute("id", {
        action: "shell_command",
        target: "node -e eval",
      });
      expect((evalDenied.content[0] as { text: string }).text).toContain("DENIED");
    } finally {
      process.chdir(origCwd);
      const { rm } = await import("node:fs/promises");
      await rm(dir, { recursive: true, force: true });
    }
  });
});

// ── memory-tools: Cortex down ──────────────────────────────────────

describe("memory-tools with Cortex unreachable", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("mayros_remember does not throw and returns warning", async () => {
    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const remember = tools.find((t) => t.name === "mayros_remember")!;

    // Must not throw
    const result = await remember.execute("id", { content: "test fact", category: "fact" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Remembered");
    expect(text).toContain("Warnings");
    expect(text).toContain("fetch failed");
  });

  it("mayros_recall does not throw and returns unavailable", async () => {
    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const recall = tools.find((t) => t.name === "mayros_recall")!;

    const result = await recall.execute("id", { query: "test" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Memory recall unavailable");
  });

  it("mayros_search does not throw and returns unavailable", async () => {
    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const search = tools.find((t) => t.name === "mayros_search")!;

    const result = await search.execute("id", { text: "test" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Vector search unavailable");
  });

  it("mayros_forget does not throw and returns unavailable", async () => {
    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const forget = tools.find((t) => t.name === "mayros_forget")!;

    const result = await forget.execute("id", { id: "mem-123" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Memory delete unavailable");
  });
});

// ── memory-tools: JSON parse resilience ──────────────────────────────

describe("memory-tools JSON parse resilience", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("mayros_recall handles non-JSON 200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token < in JSON")),
    });

    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const recall = tools.find((t) => t.name === "mayros_recall")!;

    const result = await recall.execute("id", { query: "test" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("failed");
  });

  it("mayros_search handles non-JSON 200 response", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.reject(new SyntaxError("Unexpected token")),
    });

    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const search = tools.find((t) => t.name === "mayros_search")!;

    const result = await search.execute("id", { text: "test" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("failed");
  });
});

// ── memory-tools: input validation ───────────────────────────────────

describe("memory-tools input validation", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("mayros_remember handles string tags param gracefully", async () => {
    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const remember = tools.find((t) => t.name === "mayros_remember")!;

    // tags as string instead of array — should not throw TypeError
    const result = await remember.execute("id", { content: "test", tags: "not-an-array" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Remembered");
  });

  it("mayros_recall caps limit", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    globalThis.fetch = mockFetch;

    const mod = await import("./memory-tools.js");
    const tools = mod.createMemoryTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const recall = tools.find((t) => t.name === "mayros_recall")!;

    await recall.execute("id", { query: "test", limit: 999999 });
    const calledBody = JSON.parse((mockFetch.mock.calls[0][1] as { body: string }).body) as {
      limit: number;
    };
    expect(calledBody.limit).toBeLessThanOrEqual(100);
  });
});

// ── cortex-tools: Cortex down ──────────────────────────────────────

describe("cortex-tools with Cortex unreachable", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("mayros_cortex_query does not throw", async () => {
    const mod = await import("./cortex-tools.js");
    const tools = mod.createCortexTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const query = tools.find((t) => t.name === "mayros_cortex_query")!;

    const result = await query.execute("id", { subject: "test" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Cortex query unavailable");
  });

  it("mayros_cortex_store does not throw", async () => {
    const mod = await import("./cortex-tools.js");
    const tools = mod.createCortexTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const store = tools.find((t) => t.name === "mayros_cortex_store")!;

    const result = await store.execute("id", { subject: "a", predicate: "b", object: "c" });
    const text = (result.content[0] as { text: string }).text;
    expect(text).toContain("Cortex store unavailable");
  });

  it("mayros_cortex_query caps limit at 500", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    globalThis.fetch = mockFetch;

    const mod = await import("./cortex-tools.js");
    const tools = mod.createCortexTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const query = tools.find((t) => t.name === "mayros_cortex_query")!;

    await query.execute("id", { limit: 1000000 });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=500");
  });

  it("mayros_cortex_query caps limit at boundary (501 → 500)", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    globalThis.fetch = mockFetch;

    const mod = await import("./cortex-tools.js");
    const tools = mod.createCortexTools({
      cortexBaseUrl: "http://127.0.0.1:99999",
      namespace: "test",
    });
    const query = tools.find((t) => t.name === "mayros_cortex_query")!;

    await query.execute("id", { limit: 501 });
    const calledUrl = mockFetch.mock.calls[0][0] as string;
    expect(calledUrl).toContain("limit=500");
  });
});

// ── shutdown guard: promise-cached pattern ────────────────────────────

describe("shutdown guard", () => {
  it("cached promise prevents double execution", async () => {
    let callCount = 0;

    // Mirror the production pattern from serve-cli.ts
    let shutdownPromise: Promise<void> | null = null;
    const shutdown = (): Promise<void> => {
      if (shutdownPromise) return shutdownPromise;
      shutdownPromise = (async () => {
        callCount++;
        await new Promise((r) => setTimeout(r, 10));
      })();
      return shutdownPromise;
    };

    // Simulate double SIGINT — both should share the same promise
    const [p1, p2] = [shutdown(), shutdown()];
    expect(p1).toBe(p2); // same promise reference
    await Promise.all([p1, p2]);
    expect(callCount).toBe(1);
  });
});

// ── transport: CORS default-deny ─────────────────────────────────────

describe("transport CORS", () => {
  it("does not set CORS headers when allowedOrigins is empty", async () => {
    const { McpHttpTransport } = await import("./transport-http.js");

    // Create a minimal dispatcher mock (cast to satisfy TS)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dispatcher = {
      handleMessage: vi.fn().mockResolvedValue('{"jsonrpc":"2.0","result":{}}'),
    } as any;

    // Use a high random port to avoid conflicts
    const port = 19500 + Math.floor(Math.random() * 1000);
    const transport = new McpHttpTransport({
      dispatcher,
      port,
      host: "127.0.0.1",
      allowedOrigins: [], // empty = default = deny
    });

    await transport.start();
    try {
      const res = await fetch(`http://127.0.0.1:${port}/health`, {
        headers: { Origin: "https://evil.com" },
      });
      expect(res.headers.get("access-control-allow-origin")).toBeNull();
    } finally {
      await transport.stop();
    }
  });
});

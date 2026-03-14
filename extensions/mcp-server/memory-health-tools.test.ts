/**
 * Tests for memory-health-tools.ts: conflicts and digest.
 *
 * Validates conflict detection (duplicates, graph conflicts),
 * digest summary, and graceful degradation when Cortex is down.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createMemoryHealthTools } from "./memory-health-tools.js";

// ── helpers ──────────────────────────────────────────────────────────

const deps = { cortexBaseUrl: "http://127.0.0.1:19090", namespace: "test" };
const originalFetch = globalThis.fetch;

function getTools() {
  return createMemoryHealthTools(deps);
}

function extractText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

function findTool(name: string) {
  const tool = getTools().find((t) => t.name === name);
  if (!tool) throw new Error(`Tool ${name} not found`);
  return tool;
}

// ── conflicts tool ──────────────────────────────────────────────────

describe("mayros_memory_conflicts", () => {
  beforeEach(() => {
    // Reset
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // 1
  it("reports no conflicts when memories are unique", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        matches: [
          { subject: "test:memory:1", object: "fact A", created_at: "2026-01-01" },
          { subject: "test:memory:2", object: "fact B", created_at: "2026-01-02" },
        ],
        total: 2,
      }),
    });

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("2 memories scanned");
    expect(text).toContain("No conflicts detected");
  });

  // 2
  it("detects exact duplicate memories", async () => {
    const duplicateContent = "The API uses REST with JSON payloads";

    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            matches: [
              { subject: "test:memory:1", object: duplicateContent, created_at: "2026-01-01" },
              { subject: "test:memory:2", object: duplicateContent, created_at: "2026-01-02" },
              { subject: "test:memory:3", object: "unique fact", created_at: "2026-01-03" },
            ],
            total: 3,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({ matches: [], total: 0 }),
      };
    });

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Duplicate Memories: 1");
    expect(text).toContain("[2x]");
    expect(text).toContain("API uses REST");
  });

  // 3
  it("detects graph-level subject-predicate conflicts", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            matches: [{ subject: "test:memory:1", object: "fact A" }],
            total: 1,
          }),
        };
      }
      return {
        ok: true,
        json: async () => ({
          matches: [
            { subject: "test:project:api", predicate: "test:config:port", object: "8080" },
            { subject: "test:project:api", predicate: "test:config:port", object: "19090" },
          ],
        }),
      };
    });

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Graph Conflicts");
    expect(text).toContain("test:project:api");
    expect(text).toContain("8080");
    expect(text).toContain("19090");
  });

  // 4
  it("returns empty scan message when no memories exist", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ matches: [], total: 0 }),
    });

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("No memories found to scan");
  });

  // 5
  it("does not throw when Cortex is down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Conflict scan unavailable");
  });

  // 6
  it("caps limit at 1000", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody ??= init.body as string;
      return {
        ok: true,
        json: async () => ({ matches: [], total: 0 }),
      };
    });

    const tool = findTool("mayros_memory_conflicts");
    await tool.execute("id", { limit: 5000 });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.limit).toBe(1000);
  });

  // 7
  it("handles HTTP error from Cortex", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Internal Server Error",
    });

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Cortex query failed");
  });

  // 8
  it("passes authToken in headers", async () => {
    let capturedHeaders: Record<string, string> | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedHeaders ??= init.headers as Record<string, string>;
      return {
        ok: true,
        json: async () => ({ matches: [], total: 0 }),
      };
    });

    const tools = createMemoryHealthTools({ ...deps, authToken: "Bearer secret" });
    const tool = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    await tool.execute("id", {});

    expect(capturedHeaders).toBeDefined();
    expect(capturedHeaders!["Authorization"]).toBe("Bearer secret");
  });

  // 9
  it("skips memory triples in graph conflict detection", async () => {
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            matches: [{ subject: "test:memory:1", object: "fact" }],
            total: 1,
          }),
        };
      }
      // All triples include memory triples with different values --
      // these should NOT be flagged as graph conflicts
      return {
        ok: true,
        json: async () => ({
          matches: [
            { subject: "test:memory:1", predicate: "test:memory:content", object: "fact A" },
            { subject: "test:memory:2", predicate: "test:memory:content", object: "fact B" },
          ],
        }),
      };
    });

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).not.toContain("Graph Conflicts");
    expect(text).toContain("No conflicts detected");
  });

  // 10
  it("handles graph query failure gracefully (still reports duplicates)", async () => {
    let callCount = 0;
    const dup = "same content";
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          ok: true,
          json: async () => ({
            matches: [
              { subject: "test:memory:1", object: dup },
              { subject: "test:memory:2", object: dup },
            ],
            total: 2,
          }),
        };
      }
      // Graph query fails
      throw new Error("network error");
    });

    const tool = findTool("mayros_memory_conflicts");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Duplicate Memories: 1");
    expect(text).toContain("[2x]");
  });
});

// ── digest tool ─────────────────────────────────────────────────────

describe("mayros_memory_digest", () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  // 11
  it("returns full digest with categories and recent memories", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);

      if (urlStr.includes("/api/v1/query")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.predicate?.includes(":memory:content")) {
          return {
            ok: true,
            json: async () => ({
              matches: [
                {
                  subject: "test:memory:1",
                  object: "API uses REST",
                  created_at: "2026-03-14T10:00:00Z",
                },
                {
                  subject: "test:memory:2",
                  object: "Database is PostgreSQL",
                  created_at: "2026-03-13T10:00:00Z",
                },
                {
                  subject: "test:memory:3",
                  object: "Deploy with Docker",
                  created_at: "2026-03-12T10:00:00Z",
                },
              ],
              total: 3,
            }),
          };
        }
        if (body.predicate?.includes(":memory:category")) {
          return {
            ok: true,
            json: async () => ({
              matches: [
                { subject: "test:memory:1", object: "architecture" },
                { subject: "test:memory:2", object: "architecture" },
                { subject: "test:memory:3", object: "devops" },
              ],
              total: 3,
            }),
          };
        }
      }

      if (urlStr.includes("/api/v1/dag/stats")) {
        return { ok: true, json: async () => ({ action_count: 42, tip_count: 3 }) };
      }

      if (urlStr.includes("/api/v1/stats")) {
        return {
          ok: true,
          json: async () => ({ graph: { triple_count: 150, subject_count: 30 } }),
        };
      }

      return { ok: false, statusText: "Not Found" };
    });

    const tool = findTool("mayros_memory_digest");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Memory Digest");
    expect(text).toContain("Total memories: 3");
    expect(text).toContain("Total graph triples: 150");
    expect(text).toContain("DAG actions: 42 (3 tips)");
    expect(text).toContain("architecture: 2");
    expect(text).toContain("devops: 1");
    expect(text).toContain("API uses REST");
    expect(text).toContain("Database is PostgreSQL");
  });

  // 12
  it("shows empty state when no memories exist", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/query")) {
        return {
          ok: true,
          json: async () => ({ matches: [], total: 0 }),
        };
      }
      return { ok: false, statusText: "Not Found" };
    });

    const tool = findTool("mayros_memory_digest");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Total memories: 0");
    expect(text).toContain("No memories stored yet");
  });

  // 13
  it("does not throw when Cortex is down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const tool = findTool("mayros_memory_digest");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Memory digest unavailable");
  });

  // 14
  it("sorts recent memories by date (most recent first)", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/query")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.predicate?.includes(":memory:content")) {
          return {
            ok: true,
            json: async () => ({
              matches: [
                {
                  subject: "test:memory:old",
                  object: "old fact",
                  created_at: "2026-01-01T00:00:00Z",
                },
                {
                  subject: "test:memory:new",
                  object: "new fact",
                  created_at: "2026-03-14T00:00:00Z",
                },
                {
                  subject: "test:memory:mid",
                  object: "mid fact",
                  created_at: "2026-02-01T00:00:00Z",
                },
              ],
              total: 3,
            }),
          };
        }
        return { ok: true, json: async () => ({ matches: [], total: 0 }) };
      }
      return { ok: false, statusText: "Not Found" };
    });

    const tool = findTool("mayros_memory_digest");
    const result = await tool.execute("id", { limit: 3 });
    const text = extractText(result);

    const newIdx = text.indexOf("new fact");
    const midIdx = text.indexOf("mid fact");
    const oldIdx = text.indexOf("old fact");
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

  // 15
  it("respects limit parameter", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/query")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.predicate?.includes(":memory:content")) {
          return {
            ok: true,
            json: async () => ({
              matches: Array.from({ length: 10 }, (_, i) => ({
                subject: `test:memory:${i}`,
                object: `fact number ${i}`,
                created_at: `2026-03-${String(i + 1).padStart(2, "0")}T00:00:00Z`,
              })),
              total: 10,
            }),
          };
        }
        return { ok: true, json: async () => ({ matches: [], total: 0 }) };
      }
      return { ok: false, statusText: "Not Found" };
    });

    const tool = findTool("mayros_memory_digest");
    const result = await tool.execute("id", { limit: 3 });
    const text = extractText(result);

    expect(text).toContain("3 of 10");
    expect(text).toContain("fact number 9");
    expect(text).toContain("fact number 8");
    expect(text).toContain("fact number 7");
    expect(text).not.toContain("fact number 0");
  });

  // 16
  it("degrades gracefully when DAG is disabled", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/query")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.predicate?.includes(":memory:content")) {
          return {
            ok: true,
            json: async () => ({
              matches: [{ subject: "test:memory:1", object: "a fact" }],
              total: 1,
            }),
          };
        }
        return { ok: true, json: async () => ({ matches: [], total: 0 }) };
      }
      return { ok: false, statusText: "Not Found" };
    });

    const tool = findTool("mayros_memory_digest");
    const result = await tool.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Total memories: 1");
    expect(text).not.toContain("DAG actions");
    expect(text).not.toContain("Graph triples");
  });

  // 17
  it("passes authToken in headers", async () => {
    const capturedHeaders: Array<Record<string, string>> = [];
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedHeaders.push(init.headers as Record<string, string>);
      return {
        ok: true,
        json: async () => ({ matches: [], total: 0 }),
      };
    });

    const tools = createMemoryHealthTools({ ...deps, authToken: "Bearer secret" });
    const tool = tools.find((t) => t.name === "mayros_memory_digest")!;
    await tool.execute("id", {});

    expect(capturedHeaders.length).toBeGreaterThan(0);
    expect(capturedHeaders[0]!["Authorization"]).toBe("Bearer secret");
  });

  // 18
  it("caps limit at 100", async () => {
    globalThis.fetch = vi.fn().mockImplementation(async (url: string, init?: RequestInit) => {
      const urlStr = String(url);
      if (urlStr.includes("/api/v1/query")) {
        const body = JSON.parse((init?.body as string) ?? "{}");
        if (body.predicate?.includes(":memory:content")) {
          return {
            ok: true,
            json: async () => ({
              matches: Array.from({ length: 200 }, (_, i) => ({
                subject: `test:memory:${i}`,
                object: `fact ${i}`,
                created_at: `2026-03-01T00:00:00Z`,
              })),
              total: 200,
            }),
          };
        }
        return { ok: true, json: async () => ({ matches: [], total: 0 }) };
      }
      return { ok: false, statusText: "Not Found" };
    });

    const tool = findTool("mayros_memory_digest");
    const result = await tool.execute("id", { limit: 500 });
    const text = extractText(result);

    // The limit cap is 100, so "100 of 200" should appear
    expect(text).toContain("100 of 200");
  });
});

/**
 * Tests for memory health tools: conflicts and digest.
 *
 * Validates conflict detection (duplicates, graph conflicts),
 * digest summary, and graceful degradation when Cortex is down.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { createMemoryHealthTools } from "./memory-health-tools.js";

// ── helpers ──────────────────────────────────────────────────────────

function getTools() {
  return createMemoryHealthTools({
    cortexBaseUrl: "http://127.0.0.1:19090",
    namespace: "test",
  });
}

function extractText(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((c) => c.text ?? "").join("\n");
}

// ── conflicts tool ──────────────────────────────────────────────────

describe("mayros_memory_conflicts", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

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

    const tools = getTools();
    const conflicts = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    const result = await conflicts.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("2 memories scanned");
    expect(text).toContain("No conflicts detected");
  });

  it("detects exact duplicate memories", async () => {
    const duplicateContent = "The API uses REST with JSON payloads";

    // First call returns memory content triples, second returns all triples
    let callCount = 0;
    globalThis.fetch = vi.fn().mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // Memory content query
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
      // All triples query (no non-memory conflicts)
      return {
        ok: true,
        json: async () => ({ matches: [], total: 0 }),
      };
    });

    const tools = getTools();
    const conflicts = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    const result = await conflicts.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Duplicate Memories: 1");
    expect(text).toContain("[2x]");
    expect(text).toContain("API uses REST");
  });

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
      // All triples — has a conflict in non-memory space
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

    const tools = getTools();
    const conflicts = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    const result = await conflicts.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Graph Conflicts");
    expect(text).toContain("test:project:api");
    expect(text).toContain("8080");
    expect(text).toContain("19090");
  });

  it("returns empty scan message when no memories exist", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ matches: [], total: 0 }),
    });

    const tools = getTools();
    const conflicts = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    const result = await conflicts.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("No memories found to scan");
  });

  it("does not throw when Cortex is down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const tools = getTools();
    const conflicts = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    const result = await conflicts.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Conflict scan unavailable");
  });

  it("caps limit at 1000", async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
      capturedBody ??= init.body as string;
      return {
        ok: true,
        json: async () => ({ matches: [], total: 0 }),
      };
    });

    const tools = getTools();
    const conflicts = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    await conflicts.execute("id", { limit: 5000 });

    expect(capturedBody).toBeDefined();
    const parsed = JSON.parse(capturedBody!);
    expect(parsed.limit).toBe(1000);
  });

  it("handles HTTP error from Cortex", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      statusText: "Internal Server Error",
    });

    const tools = getTools();
    const conflicts = tools.find((t) => t.name === "mayros_memory_conflicts")!;
    const result = await conflicts.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Cortex query failed");
  });
});

// ── digest tool ─────────────────────────────────────────────────────

describe("mayros_memory_digest", () => {
  let origFetch: typeof globalThis.fetch;

  beforeEach(() => {
    origFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it("returns full digest with categories and recent memories", async () => {
    const responses: Record<string, unknown> = {
      "/api/v1/query": null, // handled per predicate
      "/api/v1/dag/stats": { action_count: 42, tip_count: 3 },
      "/api/v1/stats": { graph: { triple_count: 150, subject_count: 30 } },
    };

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
        return { ok: true, json: async () => responses["/api/v1/dag/stats"] };
      }

      if (urlStr.includes("/api/v1/stats")) {
        return { ok: true, json: async () => responses["/api/v1/stats"] };
      }

      return { ok: false, statusText: "Not Found" };
    });

    const tools = getTools();
    const digest = tools.find((t) => t.name === "mayros_memory_digest")!;
    const result = await digest.execute("id", {});
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

    const tools = getTools();
    const digest = tools.find((t) => t.name === "mayros_memory_digest")!;
    const result = await digest.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Total memories: 0");
    expect(text).toContain("No memories stored yet");
  });

  it("does not throw when Cortex is down", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new TypeError("fetch failed"));

    const tools = getTools();
    const digest = tools.find((t) => t.name === "mayros_memory_digest")!;
    const result = await digest.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Memory digest unavailable");
  });

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

    const tools = getTools();
    const digest = tools.find((t) => t.name === "mayros_memory_digest")!;
    const result = await digest.execute("id", { limit: 3 });
    const text = extractText(result);

    const newIdx = text.indexOf("new fact");
    const midIdx = text.indexOf("mid fact");
    const oldIdx = text.indexOf("old fact");
    expect(newIdx).toBeLessThan(midIdx);
    expect(midIdx).toBeLessThan(oldIdx);
  });

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

    const tools = getTools();
    const digest = tools.find((t) => t.name === "mayros_memory_digest")!;
    const result = await digest.execute("id", { limit: 3 });
    const text = extractText(result);

    // Should show "3 of 10" in the header
    expect(text).toContain("3 of 10");
    // Should NOT include fact 3 (0-indexed, showing only 3 most recent)
    expect(text).toContain("fact number 9");
    expect(text).toContain("fact number 8");
    expect(text).toContain("fact number 7");
    expect(text).not.toContain("fact number 0");
  });

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
      // DAG and stats return 404
      return { ok: false, statusText: "Not Found" };
    });

    const tools = getTools();
    const digest = tools.find((t) => t.name === "mayros_memory_digest")!;
    const result = await digest.execute("id", {});
    const text = extractText(result);

    expect(text).toContain("Total memories: 1");
    expect(text).not.toContain("DAG actions");
    expect(text).not.toContain("Graph triples");
  });
});

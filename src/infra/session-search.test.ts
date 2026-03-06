import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  discoverSessionFiles,
  extractSnippet,
  extractTextContent,
  searchSessionFile,
  searchSessions,
} from "./session-search.js";

function createSessionDir(base: string, agentId: string, sessionId: string, lines: string[]) {
  const dir = join(base, agentId, "sessions");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${sessionId}.jsonl`), lines.join("\n") + "\n");
}

describe("extractSnippet", () => {
  // 1
  it("extracts snippet around match", () => {
    const text = "This is a long text with the search term somewhere in the middle of it.";
    const snippet = extractSnippet(text, "search term", 10);
    expect(snippet).toContain("search term");
    expect(snippet.length).toBeLessThan(text.length + 5);
  });

  // 2
  it("adds ellipsis for truncated start", () => {
    const text = "A".repeat(200) + "needle" + "B".repeat(200);
    const snippet = extractSnippet(text, "needle", 20);
    expect(snippet).toMatch(/^\u2026/);
    expect(snippet).toMatch(/\u2026$/);
  });

  // 3
  it("handles no match gracefully", () => {
    const snippet = extractSnippet("hello world", "missing", 10);
    expect(snippet).toBe("hello world");
  });
});

describe("extractTextContent", () => {
  // 4
  it("extracts from string content", () => {
    expect(extractTextContent("hello")).toBe("hello");
  });

  // 5
  it("extracts from array content", () => {
    const content = [
      { type: "text", text: "first" },
      { type: "image", data: "..." },
      { type: "text", text: "second" },
    ];
    expect(extractTextContent(content)).toBe("first\nsecond");
  });

  // 6
  it("returns empty for null/undefined", () => {
    expect(extractTextContent(null)).toBe("");
    expect(extractTextContent(undefined)).toBe("");
  });
});

describe("discoverSessionFiles", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mayros-search-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 7
  it("discovers session files across agents", async () => {
    createSessionDir(dir, "agent-1", "sess-a", ['{"type":"session"}']);
    createSessionDir(dir, "agent-2", "sess-b", ['{"type":"session"}']);
    const files = await discoverSessionFiles(dir);
    expect(files).toHaveLength(2);
    expect(files.map((f) => f.sessionId).sort()).toEqual(["sess-a", "sess-b"]);
  });

  // 8
  it("returns empty for missing directory", async () => {
    const files = await discoverSessionFiles("/tmp/nonexistent-mayros-test");
    expect(files).toHaveLength(0);
  });

  // 9
  it("skips non-jsonl files", async () => {
    const sessDir = join(dir, "agent-1", "sessions");
    mkdirSync(sessDir, { recursive: true });
    writeFileSync(join(sessDir, "notes.txt"), "not a session");
    writeFileSync(join(sessDir, "real.jsonl"), '{"type":"session"}\n');
    const files = await discoverSessionFiles(dir);
    expect(files).toHaveLength(1);
    expect(files[0].sessionId).toBe("real");
  });
});

describe("searchSessionFile", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mayros-search-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 10
  it("finds matching messages", async () => {
    const lines = [
      '{"type":"session","id":"s1"}',
      '{"type":"message","id":"m1","message":{"role":"user","content":"How do I use TypeScript?","timestamp":1000}}',
      '{"type":"message","id":"m2","message":{"role":"assistant","content":"TypeScript is a typed superset of JavaScript.","timestamp":2000}}',
      '{"type":"message","id":"m3","message":{"role":"user","content":"What about Python?","timestamp":3000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines);
    const filePath = join(dir, "agent-1", "sessions", "sess-1.jsonl");

    const results = await searchSessionFile(filePath, "sess-1", {
      query: "TypeScript",
    });
    expect(results).toHaveLength(2);
    expect(results[0].role).toBe("user");
    expect(results[1].role).toBe("assistant");
  });

  // 11
  it("filters by role", async () => {
    const lines = [
      '{"type":"message","id":"m1","message":{"role":"user","content":"TypeScript help","timestamp":1000}}',
      '{"type":"message","id":"m2","message":{"role":"assistant","content":"TypeScript is great","timestamp":2000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines);
    const filePath = join(dir, "agent-1", "sessions", "sess-1.jsonl");

    const results = await searchSessionFile(filePath, "sess-1", {
      query: "TypeScript",
      role: "user",
    });
    expect(results).toHaveLength(1);
    expect(results[0].role).toBe("user");
  });

  // 12
  it("filters by timestamp", async () => {
    const lines = [
      '{"type":"message","id":"m1","message":{"role":"user","content":"old message","timestamp":1000}}',
      '{"type":"message","id":"m2","message":{"role":"user","content":"new message","timestamp":5000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines);
    const filePath = join(dir, "agent-1", "sessions", "sess-1.jsonl");

    const results = await searchSessionFile(filePath, "sess-1", {
      query: "message",
      since: 3000,
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("new");
  });

  // 13
  it("respects limit", async () => {
    const lines = Array.from({ length: 10 }, (_, i) =>
      JSON.stringify({
        type: "message",
        id: `m${i}`,
        message: {
          role: "user",
          content: `message ${i} about search`,
          timestamp: i * 1000,
        },
      }),
    );
    createSessionDir(dir, "agent-1", "sess-1", lines);
    const filePath = join(dir, "agent-1", "sessions", "sess-1.jsonl");

    const results = await searchSessionFile(filePath, "sess-1", {
      query: "search",
      limit: 3,
    });
    expect(results).toHaveLength(3);
  });

  // 14
  it("handles array content blocks", async () => {
    const lines = [
      JSON.stringify({
        type: "message",
        id: "m1",
        message: {
          role: "assistant",
          content: [{ type: "text", text: "Here is the answer about Rust." }],
          timestamp: 1000,
        },
      }),
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines);
    const filePath = join(dir, "agent-1", "sessions", "sess-1.jsonl");

    const results = await searchSessionFile(filePath, "sess-1", {
      query: "Rust",
    });
    expect(results).toHaveLength(1);
    expect(results[0].content).toContain("Rust");
  });

  // 15
  it("is case-insensitive", async () => {
    const lines = [
      '{"type":"message","id":"m1","message":{"role":"user","content":"TYPESCRIPT IS GREAT","timestamp":1000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines);
    const filePath = join(dir, "agent-1", "sessions", "sess-1.jsonl");

    const results = await searchSessionFile(filePath, "sess-1", {
      query: "typescript",
    });
    expect(results).toHaveLength(1);
  });

  // 16
  it("skips malformed JSON lines", async () => {
    const lines = [
      "not json",
      '{"type":"message","id":"m1","message":{"role":"user","content":"valid match","timestamp":1000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines);
    const filePath = join(dir, "agent-1", "sessions", "sess-1.jsonl");

    const results = await searchSessionFile(filePath, "sess-1", {
      query: "valid",
    });
    expect(results).toHaveLength(1);
  });
});

describe("searchSessions", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mayros-search-test-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 17
  it("searches across multiple sessions", async () => {
    const lines1 = [
      '{"type":"message","id":"m1","message":{"role":"user","content":"Docker help needed","timestamp":1000}}',
    ];
    const lines2 = [
      '{"type":"message","id":"m2","message":{"role":"user","content":"Docker compose question","timestamp":2000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines1);
    createSessionDir(dir, "agent-1", "sess-2", lines2);

    const summary = await searchSessions({ query: "Docker", basePath: dir });
    expect(summary.results).toHaveLength(2);
    expect(summary.sessionsSearched).toBe(2);
  });

  // 18
  it("sorts results by timestamp descending", async () => {
    const lines1 = [
      '{"type":"message","id":"m1","message":{"role":"user","content":"query old","timestamp":1000}}',
    ];
    const lines2 = [
      '{"type":"message","id":"m2","message":{"role":"user","content":"query new","timestamp":5000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines1);
    createSessionDir(dir, "agent-1", "sess-2", lines2);

    const summary = await searchSessions({ query: "query", basePath: dir });
    expect(summary.results[0].timestamp).toBeGreaterThan(summary.results[1].timestamp);
  });

  // 19
  it("filters to specific sessionIds", async () => {
    const lines1 = [
      '{"type":"message","id":"m1","message":{"role":"user","content":"match here","timestamp":1000}}',
    ];
    const lines2 = [
      '{"type":"message","id":"m2","message":{"role":"user","content":"match here too","timestamp":2000}}',
    ];
    createSessionDir(dir, "agent-1", "sess-1", lines1);
    createSessionDir(dir, "agent-1", "sess-2", lines2);

    const summary = await searchSessions({
      query: "match",
      basePath: dir,
      sessionIds: ["sess-1"],
    });
    expect(summary.results).toHaveLength(1);
    expect(summary.results[0].sessionId).toBe("sess-1");
  });

  // 20
  it("returns timing info", async () => {
    createSessionDir(dir, "agent-1", "sess-1", ['{"type":"session"}']);
    const summary = await searchSessions({ query: "anything", basePath: dir });
    expect(summary.durationMs).toBeGreaterThanOrEqual(0);
    expect(summary.sessionsSearched).toBe(1);
  });

  // 21
  it("handles empty search results", async () => {
    createSessionDir(dir, "agent-1", "sess-1", [
      '{"type":"message","id":"m1","message":{"role":"user","content":"no match here","timestamp":1000}}',
    ]);
    const summary = await searchSessions({
      query: "xyz_not_found",
      basePath: dir,
    });
    expect(summary.results).toHaveLength(0);
    expect(summary.totalMatches).toBe(0);
  });
});

import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { openSearchDb, syncSearchIndex, searchSessionsFTS } from "./session-search-fts.js";

/**
 * FTS5 session search tests.
 *
 * Exercises the full path: schema creation, file indexing, and BM25-ranked
 * search with filters. Uses temp directories and real SQLite databases.
 */

let tempDir: string;
let dbPath: string;

function setupTempSessions(files: Record<string, string>): { sessionsDir: string; dbPath: string } {
  tempDir = mkdtempSync(join(tmpdir(), "mayros-fts-test-"));
  const sessionsDir = join(tempDir, "sessions");
  const { mkdirSync } = require("node:fs") as typeof import("node:fs");
  mkdirSync(sessionsDir, { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    writeFileSync(join(sessionsDir, name), content);
  }
  dbPath = join(sessionsDir, "search.sqlite");
  return { sessionsDir, dbPath };
}

afterEach(() => {
  if (tempDir) {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // best effort
    }
  }
});

function makeJsonLine(
  type: string,
  id: string,
  role: string,
  content: string,
  timestamp: number,
): string {
  return JSON.stringify({
    type,
    id,
    message: { role, content, timestamp },
  });
}

describe("FTS5 session search", () => {
  it("creates the schema and indexes a session file", () => {
    const { sessionsDir, dbPath } = setupTempSessions({
      "sess-1.jsonl":
        [
          makeJsonLine("session", "hdr", "", "", 0),
          makeJsonLine(
            "message",
            "m1",
            "user",
            "How do I configure authentication?",
            1700000000000,
          ),
          makeJsonLine(
            "message",
            "m2",
            "assistant",
            "You can use JWT tokens for auth.",
            1700000001000,
          ),
        ].join("\n") + "\n",
    });

    const db = openSearchDb(dbPath);
    try {
      const count = syncSearchIndex(db, sessionsDir, "main");
      expect(count).toBe(1); // one file indexed

      const rows = db.prepare("SELECT COUNT(*) as n FROM session_messages").get() as { n: number };
      expect(rows.n).toBe(2); // user + assistant messages (session header skipped)
    } finally {
      db.close();
    }
  });

  it("returns BM25-ranked results for a keyword query", () => {
    const { sessionsDir, dbPath } = setupTempSessions({
      "sess-1.jsonl":
        [
          makeJsonLine(
            "message",
            "m1",
            "user",
            "How do I configure authentication?",
            1700000000000,
          ),
          makeJsonLine(
            "message",
            "m2",
            "assistant",
            "Use JWT for authentication setup.",
            1700000001000,
          ),
          makeJsonLine("message", "m3", "user", "What about database connections?", 1700000002000),
        ].join("\n") + "\n",
    });

    const db = openSearchDb(dbPath);
    try {
      syncSearchIndex(db, sessionsDir, "main");
      const result = searchSessionsFTS(db, { query: "authentication" });
      expect(result.results.length).toBeGreaterThanOrEqual(1);
      expect(result.results[0].content).toContain("authentication");
      expect(result.results[0].sessionId).toBe("sess-1");
    } finally {
      db.close();
    }
  });

  it("filters by role", () => {
    const { sessionsDir, dbPath } = setupTempSessions({
      "sess-1.jsonl":
        [
          makeJsonLine("message", "m1", "user", "Tell me about authentication", 1700000000000),
          makeJsonLine(
            "message",
            "m2",
            "assistant",
            "Authentication uses JWT tokens",
            1700000001000,
          ),
        ].join("\n") + "\n",
    });

    const db = openSearchDb(dbPath);
    try {
      syncSearchIndex(db, sessionsDir, "main");
      const result = searchSessionsFTS(db, { query: "authentication", role: "user" });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].role).toBe("user");
    } finally {
      db.close();
    }
  });

  it("filters by time range", () => {
    const { sessionsDir, dbPath } = setupTempSessions({
      "sess-1.jsonl":
        [
          makeJsonLine("message", "m1", "user", "old authentication message", 1000),
          makeJsonLine("message", "m2", "user", "new authentication message", 5000),
        ].join("\n") + "\n",
    });

    const db = openSearchDb(dbPath);
    try {
      syncSearchIndex(db, sessionsDir, "main");
      const result = searchSessionsFTS(db, {
        query: "authentication",
        since: 2000,
      });
      expect(result.results).toHaveLength(1);
      expect(result.results[0].timestamp).toBe(5000);
    } finally {
      db.close();
    }
  });

  it("skips unchanged files on re-index (incremental)", () => {
    const { sessionsDir, dbPath } = setupTempSessions({
      "sess-1.jsonl":
        [makeJsonLine("message", "m1", "user", "authentication help", 1000)].join("\n") + "\n",
    });

    const db = openSearchDb(dbPath);
    try {
      const first = syncSearchIndex(db, sessionsDir, "main");
      expect(first).toBe(1);
      const second = syncSearchIndex(db, sessionsDir, "main");
      expect(second).toBe(0); // no changes → skip
    } finally {
      db.close();
    }
  });

  it("returns empty results for no match", () => {
    const { sessionsDir, dbPath } = setupTempSessions({
      "sess-1.jsonl":
        [makeJsonLine("message", "m1", "user", "hello world", 1000)].join("\n") + "\n",
    });

    const db = openSearchDb(dbPath);
    try {
      syncSearchIndex(db, sessionsDir, "main");
      const result = searchSessionsFTS(db, { query: "nonexistent_term_xyz" });
      expect(result.results).toHaveLength(0);
    } finally {
      db.close();
    }
  });
});

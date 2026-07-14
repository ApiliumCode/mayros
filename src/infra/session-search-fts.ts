/**
 * FTS5-backed session search.
 *
 * A dedicated SQLite database with a full-text search virtual table over
 * session messages. Provides BM25-ranked search with role/timestamp/session
 * filters, replacing the linear substring scan for users whose Node runtime
 * includes the built-in `node:sqlite` module.
 *
 * The index lives at `~/.mayros/agents/<agentId>/sessions/search.sqlite` and
 * is synced lazily (on each query) by checking file mtimes against a tracking
 * table — no background watchers needed.
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, statSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { createHash } from "node:crypto";
import { requireNodeSqlite } from "../memory/sqlite.js";
import { buildFtsQuery } from "../memory/hybrid.js";
import type { SearchOptions, SearchResult, SearchSummary } from "./session-search.js";
import { extractTextContent } from "./session-search.js";

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS session_messages (
  rowid INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  role TEXT NOT NULL,
  line_index INTEGER NOT NULL,
  timestamp INTEGER NOT NULL DEFAULT 0,
  source_path TEXT NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sm_session ON session_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_sm_role ON session_messages(role);
CREATE INDEX IF NOT EXISTS idx_sm_time ON session_messages(timestamp);

CREATE TABLE IF NOT EXISTS session_files_meta (
  path TEXT PRIMARY KEY,
  mtime INTEGER NOT NULL,
  size INTEGER NOT NULL,
  hash TEXT NOT NULL,
  last_indexed_line INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS session_messages_fts USING fts5(
  content,
  content='session_messages',
  content_rowid='rowid',
  tokenize = 'unicode61'
);

CREATE TRIGGER IF NOT EXISTS sm_ai AFTER INSERT ON session_messages BEGIN
  INSERT INTO session_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
CREATE TRIGGER IF NOT EXISTS sm_ad AFTER DELETE ON session_messages BEGIN
  INSERT INTO session_messages_fts(session_messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
END;
CREATE TRIGGER IF NOT EXISTS sm_au AFTER UPDATE ON session_messages BEGIN
  INSERT INTO session_messages_fts(session_messages_fts, rowid, content)
    VALUES ('delete', old.rowid, old.content);
  INSERT INTO session_messages_fts(rowid, content) VALUES (new.rowid, new.content);
END;
`;

// ---------------------------------------------------------------------------
// DB lifecycle
// ---------------------------------------------------------------------------

/** Resolve the search DB path for a given agent. */
export function resolveSearchDbPath(agentId: string = "main"): string {
  return join(homedir(), ".mayros", "agents", agentId, "sessions", "search.sqlite");
}

/** Open (or create) the search database, initializing the schema. */
export function openSearchDb(dbPath: string): DatabaseSync {
  const dir = join(dbPath, "..");
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const sqlite = requireNodeSqlite();
  const db = new sqlite.DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA synchronous = NORMAL");
  db.exec(SCHEMA_SQL);
  return db;
}

// ---------------------------------------------------------------------------
// Indexing
// ---------------------------------------------------------------------------

type SessionFileEntry = {
  type: string;
  id?: string;
  message?: {
    role?: string;
    content?: unknown;
    timestamp?: number;
  };
};

/**
 * Sync the search index for a given sessions directory. Only re-indexes files
 * whose mtime or size has changed since the last sync. Returns the number of
 * files that were (re)indexed.
 */
export function syncSearchIndex(db: DatabaseSync, sessionsDir: string, agentId: string): number {
  if (!existsSync(sessionsDir)) return 0;

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const files = readdirSync(sessionsDir).filter(
    (f) => f.endsWith(".jsonl") && !f.endsWith(".search.sqlite"),
  );

  let reindexed = 0;

  for (const fileName of files) {
    const filePath = join(sessionsDir, fileName);
    const stats = statSync(filePath);
    const meta = db
      .prepare("SELECT mtime, size, last_indexed_line FROM session_files_meta WHERE path = ?")
      .get(filePath) as { mtime: number; size: number; last_indexed_line: number } | undefined;

    if (meta && meta.mtime === stats.mtimeMs && meta.size === stats.size) {
      continue; // unchanged
    }

    // Parse the file and index its messages.
    const sessionId = fileName.replace(/\.jsonl$/, "");
    const content = readFileSync(filePath, "utf8");
    const hash = createHash("sha256").update(content).digest("hex").slice(0, 16);
    const lines = content.split("\n").filter((l) => l.trim());

    // Delete old entries for this file, then reinsert.
    db.prepare("DELETE FROM session_messages WHERE source_path = ?").run(filePath);

    const insertStmt = db.prepare(
      `INSERT INTO session_messages (session_id, agent_id, message_id, role, line_index, timestamp, source_path, content)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    );

    for (let i = 0; i < lines.length; i++) {
      try {
        const entry = JSON.parse(lines[i]) as SessionFileEntry;
        if (entry.type !== "message" || !entry.message?.role) continue;
        const role = entry.message.role;
        if (role !== "user" && role !== "assistant") continue;
        const text = extractTextContent(entry.message.content);
        if (!text.trim()) continue;
        insertStmt.run(
          sessionId,
          agentId,
          entry.id ?? `${sessionId}-${i}`,
          role,
          i,
          entry.message.timestamp ?? 0,
          filePath,
          text,
        );
      } catch {
        // Skip malformed lines.
      }
    }

    db.prepare(
      `INSERT INTO session_files_meta (path, mtime, size, hash, last_indexed_line)
       VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(path) DO UPDATE SET mtime=excluded.mtime, size=excluded.size, hash=excluded.hash, last_indexed_line=excluded.last_indexed_line`,
    ).run(filePath, stats.mtimeMs, stats.size, hash, lines.length);

    reindexed++;
  }

  return reindexed;
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

/**
 * Search session messages using FTS5 with BM25 ranking.
 *
 * Returns results shaped to match the existing SearchResult type so callers
 * (search-cli.ts, TUI /search) need no changes.
 */
export function searchSessionsFTS(db: DatabaseSync, opts: SearchOptions): SearchSummary {
  const ftsQuery = buildFtsQuery(opts.query);
  if (!ftsQuery) {
    return { results: [], totalMatches: 0, sessionsSearched: 0, durationMs: 0 };
  }

  const limit = Math.max(1, Math.min(opts.limit ?? 20, 200));
  const conditions: string[] = ["session_messages_fts MATCH ?"];
  const params: Array<string | number> = [ftsQuery];

  if (opts.role) {
    conditions.push("m.role = ?");
    params.push(opts.role);
  }
  if (opts.since) {
    conditions.push("m.timestamp >= ?");
    params.push(opts.since);
  }
  if (opts.before) {
    conditions.push("m.timestamp <= ?");
    params.push(opts.before);
  }
  if (opts.sessionIds && opts.sessionIds.length > 0) {
    const placeholders = opts.sessionIds.map(() => "?").join(",");
    conditions.push(`m.session_id IN (${placeholders})`);
    params.push(...opts.sessionIds);
  }

  const whereClause = conditions.join(" AND ");

  const rows = db
    .prepare(
      `SELECT m.session_id, m.message_id, m.role, m.timestamp, m.line_index,
              m.source_path, m.content,
              bm25(session_messages_fts) AS rank,
              snippet(session_messages_fts, 0, '«', '»', '…', 16) AS snippet
       FROM session_messages_fts
       JOIN session_messages m ON m.rowid = session_messages_fts.rowid
       WHERE ${whereClause}
       ORDER BY rank ASC
       LIMIT ?`,
    )
    .all(...params, limit) as Array<{
    session_id: string;
    message_id: string;
    role: string;
    timestamp: number;
    line_index: number;
    source_path: string;
    content: string;
    rank: number;
    snippet: string;
  }>;

  const results: SearchResult[] = rows.map((row) => ({
    sessionId: row.session_id,
    messageId: row.message_id,
    role: row.role as "user" | "assistant",
    content: row.content,
    snippet: row.snippet,
    timestamp: row.timestamp,
    lineIndex: row.line_index,
  }));

  return {
    results,
    totalMatches: results.length,
    sessionsSearched: new Set(rows.map((r) => r.session_id)).size,
    durationMs: 0, // caller fills this if needed
  };
}

// ---------------------------------------------------------------------------
// FTS5 availability check
// ---------------------------------------------------------------------------

/** Check whether the FTS5 search backend is available (node:sqlite present). */
export function isFtsSearchAvailable(): boolean {
  try {
    requireNodeSqlite();
    return true;
  } catch {
    return false;
  }
}

/**
 * Session Search — cross-session full-text search in conversation history.
 *
 * Streams JSONL session files and matches messages against search queries.
 * Supports keyword matching, date filtering, and role filtering.
 */

import { readdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { join, basename } from "node:path";
import { homedir } from "node:os";

export type SearchOptions = {
  /** Search query (case-insensitive substring match). */
  query: string;
  /** Filter by message role. */
  role?: "user" | "assistant";
  /** Only search messages after this timestamp (ms). */
  since?: number;
  /** Only search messages before this timestamp (ms). */
  before?: number;
  /** Max results to return (default: 20). */
  limit?: number;
  /** Specific session IDs to search (default: all). */
  sessionIds?: string[];
  /** Base directory override for sessions (default: ~/.mayros/agents). */
  basePath?: string;
};

export type SearchResult = {
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  content: string;
  /** Snippet of content around the match. */
  snippet: string;
  timestamp: number;
  /** 0-based line index in the JSONL file. */
  lineIndex: number;
};

export type SearchSummary = {
  results: SearchResult[];
  totalMatches: number;
  sessionsSearched: number;
  durationMs: number;
};

/** Default sessions base path. */
function defaultBasePath(): string {
  return join(homedir(), ".mayros", "agents");
}

/**
 * Discover all session JSONL files across all agents.
 */
export async function discoverSessionFiles(
  basePath?: string,
): Promise<Array<{ sessionId: string; filePath: string; agentId: string }>> {
  const base = basePath ?? defaultBasePath();
  const results: Array<{ sessionId: string; filePath: string; agentId: string }> = [];

  let agentDirs: string[];
  try {
    agentDirs = await readdir(base);
  } catch {
    return results;
  }

  for (const agentId of agentDirs) {
    const sessionsDir = join(base, agentId, "sessions");
    let files: string[];
    try {
      files = await readdir(sessionsDir);
    } catch {
      continue;
    }
    for (const file of files) {
      if (!file.endsWith(".jsonl")) continue;
      const sessionId = basename(file, ".jsonl");
      results.push({
        sessionId,
        filePath: join(sessionsDir, file),
        agentId,
      });
    }
  }

  return results;
}

/**
 * Extract a snippet of text around a match position.
 */
export function extractSnippet(text: string, query: string, contextChars = 80): string {
  const lower = text.toLowerCase();
  const qLower = query.toLowerCase();
  const idx = lower.indexOf(qLower);
  if (idx === -1) return text.slice(0, contextChars * 2);

  const start = Math.max(0, idx - contextChars);
  const end = Math.min(text.length, idx + query.length + contextChars);
  let snippet = text.slice(start, end);
  if (start > 0) snippet = "\u2026" + snippet;
  if (end < text.length) snippet = snippet + "\u2026";
  return snippet;
}

/**
 * Extract text content from a message content field.
 * Handles both string and array-of-blocks formats.
 */
export function extractTextContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter(
        (block: Record<string, unknown>) => block.type === "text" && typeof block.text === "string",
      )
      .map((block: Record<string, unknown>) => block.text as string)
      .join("\n");
  }
  return "";
}

/**
 * Search a single JSONL session file for matching messages.
 */
export async function searchSessionFile(
  filePath: string,
  sessionId: string,
  opts: SearchOptions,
): Promise<SearchResult[]> {
  const results: SearchResult[] = [];
  const queryLower = opts.query.toLowerCase();
  const limit = opts.limit ?? 20;

  const rl = createInterface({
    input: createReadStream(filePath, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });

  let lineIndex = 0;
  for await (const line of rl) {
    lineIndex++;
    if (results.length >= limit) break;

    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }

    if (entry.type !== "message") continue;
    const msg = entry.message as Record<string, unknown> | undefined;
    if (!msg) continue;

    const role = msg.role as string;
    if (role !== "user" && role !== "assistant") continue;
    if (opts.role && role !== opts.role) continue;

    const timestamp = typeof msg.timestamp === "number" ? msg.timestamp : 0;
    if (opts.since && timestamp < opts.since) continue;
    if (opts.before && timestamp > opts.before) continue;

    const text = extractTextContent(msg.content);
    if (!text.toLowerCase().includes(queryLower)) continue;

    results.push({
      sessionId,
      messageId: (entry.id as string) ?? `line-${lineIndex}`,
      role: role as "user" | "assistant",
      content: text,
      snippet: extractSnippet(text, opts.query),
      timestamp,
      lineIndex,
    });
  }

  return results;
}

/**
 * Search across all sessions for matching messages.
 */
export async function searchSessions(opts: SearchOptions): Promise<SearchSummary> {
  const startTime = Date.now();
  const limit = opts.limit ?? 20;

  const sessionFiles = await discoverSessionFiles(opts.basePath);

  // Filter to specific sessions if requested
  const filtered = opts.sessionIds
    ? sessionFiles.filter((sf) => opts.sessionIds!.includes(sf.sessionId))
    : sessionFiles;

  const allResults: SearchResult[] = [];

  for (const sf of filtered) {
    if (allResults.length >= limit) break;
    const remaining = limit - allResults.length;
    const results = await searchSessionFile(sf.filePath, sf.sessionId, {
      ...opts,
      limit: remaining,
    });
    allResults.push(...results);
  }

  // Sort by timestamp descending (most recent first)
  allResults.sort((a, b) => b.timestamp - a.timestamp);

  return {
    results: allResults.slice(0, limit),
    totalMatches: allResults.length,
    sessionsSearched: filtered.length,
    durationMs: Date.now() - startTime,
  };
}

/**
 * Shared types and helpers for session search.
 *
 * Extracted to break a circular dependency between session-search.ts
 * (linear scan) and session-search-fts.ts (FTS5 backend). Both modules
 * import from here instead of from each other.
 */

export type SearchOptions = {
  query: string;
  role?: "user" | "assistant";
  since?: number;
  before?: number;
  limit?: number;
  sessionIds?: string[];
  basePath?: string;
};

export type SearchResult = {
  sessionId: string;
  messageId: string;
  role: "user" | "assistant";
  content: string;
  snippet: string;
  timestamp: number;
  lineIndex: number;
};

export type SearchSummary = {
  results: SearchResult[];
  totalMatches: number;
  sessionsSearched: number;
  durationMs: number;
};

/**
 * Extract text from a message content field that may be a string or an
 * array of content blocks.
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

/**
 * MCP-friendly memory tools.
 *
 * Wraps Cortex/Ineru APIs with a simple remember/recall/search/forget interface
 * designed for external MCP clients (Claude Code, Cursor, etc.).
 */

import { randomBytes } from "node:crypto";
import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export type MemoryToolDeps = {
  cortexBaseUrl: string;
  namespace: string;
  authToken?: string;
};

/** Default timeout for Cortex HTTP requests (30 s). */
const REQUEST_TIMEOUT_MS = 30_000;

export function createMemoryTools(deps: MemoryToolDeps): AdaptableTool[] {
  const { cortexBaseUrl, namespace } = deps;

  const defaultHeaders: Record<string, string> = {};
  if (deps.authToken) {
    defaultHeaders["Authorization"] = deps.authToken;
  }

  const postHeaders: Record<string, string> = {
    ...defaultHeaders,
    "Content-Type": "application/json",
  };

  return [
    // ── mayros_remember ──────────────────────────────────────────────
    {
      name: "mayros_remember",
      description:
        "Store information in persistent semantic memory. " +
        "Use this to remember facts, decisions, preferences, patterns, " +
        "or any context that should persist across sessions.",
      parameters: Type.Object({
        content: Type.String({
          description: "The information to remember (natural language)",
        }),
        category: Type.Optional(
          Type.String({
            description:
              'Category: "fact", "decision", "preference", "pattern", "code", "architecture"',
          }),
        ),
        tags: Type.Optional(
          Type.Array(Type.String(), {
            description: "Tags for easier recall (e.g., ['payments', 'api'])",
          }),
        ),
        importance: Type.Optional(
          Type.Number({
            description: "Importance 0.0-1.0 (default 0.7). Higher = kept longer in memory",
          }),
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const content = params.content as string;
        const category = (params.category as string) ?? "general";
        const tags = Array.isArray(params.tags) ? (params.tags as string[]) : [];
        const importance = Number(params.importance ?? 0.7);

        // Store as RDF triple in Cortex (timestamp + random suffix to avoid collisions)
        const subject = `${namespace}:memory:${Date.now()}-${randomBytes(4).toString("hex")}`;
        const triples = [
          { subject, predicate: `${namespace}:memory:content`, object: content },
          { subject, predicate: `${namespace}:memory:category`, object: category },
          { subject, predicate: `${namespace}:memory:importance`, object: String(importance) },
          ...tags.map((tag) => ({
            subject,
            predicate: `${namespace}:memory:tag`,
            object: tag,
          })),
        ];

        // Store in Cortex graph (parallel) + Ineru STM
        const errors: string[] = [];

        const triplePromises = triples.map((triple) =>
          fetch(`${cortexBaseUrl}/api/v1/triples`, {
            method: "POST",
            headers: postHeaders,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify(triple),
          })
            .then((res) => {
              if (!res.ok) errors.push(`triple store: ${res.statusText}`);
            })
            .catch((err) => {
              errors.push(`triple store: ${err instanceof Error ? err.message : String(err)}`);
            }),
        );

        const ineruPromise = fetch(`${cortexBaseUrl}/api/v1/memory/remember`, {
          method: "POST",
          headers: postHeaders,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            entry_type: category,
            data: { content, tags },
            tags,
            importance,
          }),
        })
          .then((res) => {
            if (!res.ok) errors.push(`ineru store: ${res.statusText}`);
          })
          .catch((err) => {
            errors.push(`ineru store: ${err instanceof Error ? err.message : String(err)}`);
          });

        await Promise.allSettled([...triplePromises, ineruPromise]);

        const summary = `Remembered: "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}" [${category}]${tags.length > 0 ? ` #${tags.join(" #")}` : ""}`;
        return {
          content: [
            {
              type: "text" as const,
              text: errors.length > 0 ? `${summary}\nWarnings: ${errors.join("; ")}` : summary,
            },
          ],
        };
      },
    },

    // ── mayros_recall ────────────────────────────────────────────────
    {
      name: "mayros_recall",
      description:
        "Search persistent memory for previously stored information. " +
        "Query by text (semantic match), tags, or category. " +
        "Returns relevant memories from past sessions.",
      parameters: Type.Object({
        query: Type.Optional(Type.String({ description: "Text to search for (semantic match)" })),
        tags: Type.Optional(Type.Array(Type.String(), { description: "Filter by tags" })),
        category: Type.Optional(Type.String({ description: "Filter by category" })),
        limit: Type.Optional(Type.Number({ description: "Max results (default 10)" })),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const query = params.query as string | undefined;
        const tags = Array.isArray(params.tags) ? (params.tags as string[]) : undefined;
        const category = params.category as string | undefined;
        const limit = Math.min((params.limit as number) ?? 10, 100);

        // Query Ineru recall endpoint
        let recallRes: Response;
        try {
          recallRes = await fetch(`${cortexBaseUrl}/api/v1/memory/recall`, {
            method: "POST",
            headers: postHeaders,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              text: query,
              tags: tags ?? [],
              entry_type: category,
              limit,
            }),
          });
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Memory recall unavailable. Cortex may not be running.",
              },
            ],
          };
        }

        if (!recallRes.ok) {
          // Fallback: query Cortex graph directly
          try {
            const graphRes = await fetch(
              `${cortexBaseUrl}/api/v1/triples?predicate=${encodeURIComponent(`${namespace}:memory:content`)}&limit=${limit}`,
              { headers: defaultHeaders, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) },
            );
            if (!graphRes.ok) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: "Memory recall unavailable. Cortex may not be running.",
                  },
                ],
              };
            }
            const graphData = (await graphRes.json()) as {
              triples?: Array<{ object: string }>;
            };
            const triples = graphData.triples ?? [];

            return {
              content: [
                {
                  type: "text" as const,
                  text:
                    triples.length > 0
                      ? triples.map((t, i) => `${i + 1}. ${t.object}`).join("\n")
                      : "No memories found.",
                },
              ],
            };
          } catch {
            return {
              content: [
                {
                  type: "text" as const,
                  text: "Memory recall unavailable. Cortex may not be running.",
                },
              ],
            };
          }
        }

        let memories: Array<{
          id: string;
          entry_type: string;
          data: { content?: string };
          tags: string[];
          importance: number;
          relevance: number;
          source: string;
        }>;
        try {
          memories = (await recallRes.json()) as typeof memories;
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Memory recall failed: invalid response from Cortex.",
              },
            ],
          };
        }

        if (memories.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No memories found." }],
          };
        }

        const formatted = memories
          .map(
            (m, i) =>
              `${i + 1}. [${m.entry_type}] ${m.data.content ?? JSON.stringify(m.data)}` +
              (m.tags?.length > 0 ? ` #${m.tags.join(" #")}` : "") +
              ` (relevance: ${(m.relevance * 100).toFixed(0)}%, source: ${m.source})`,
          )
          .join("\n");

        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      },
    },

    // ── mayros_search ────────────────────────────────────────────────
    {
      name: "mayros_search",
      description:
        "Vector similarity search over memory. " +
        "Finds semantically similar memories even with different wording.",
      parameters: Type.Object({
        text: Type.String({
          description: "Text to search for. Will be matched against stored memories.",
        }),
        k: Type.Optional(Type.Number({ description: "Number of results (default 5)" })),
        min_similarity: Type.Optional(
          Type.Number({ description: "Minimum similarity 0.0-1.0 (default 0.3)" }),
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const text = params.text as string;
        const k = Math.min((params.k as number) ?? 5, 100);
        const minSim = Number(params.min_similarity ?? 0.3);

        let recallRes: Response;
        try {
          recallRes = await fetch(`${cortexBaseUrl}/api/v1/memory/recall`, {
            method: "POST",
            headers: postHeaders,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({ text, limit: k, min_similarity: minSim }),
          });
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Vector search unavailable. Cortex may not be running.",
              },
            ],
          };
        }

        if (!recallRes.ok) {
          return {
            content: [
              {
                type: "text" as const,
                text: "Vector search unavailable. Cortex may not be running.",
              },
            ],
          };
        }

        let results: Array<{
          data: { content?: string };
          relevance: number;
          entry_type: string;
          tags: string[];
        }>;
        try {
          results = (await recallRes.json()) as typeof results;
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Vector search failed: invalid response from Cortex.",
              },
            ],
          };
        }

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No similar memories found." }],
          };
        }

        const formatted = results
          .map(
            (r, i) =>
              `${i + 1}. [${(r.relevance * 100).toFixed(0)}%] ${r.data.content ?? JSON.stringify(r.data)}` +
              (r.tags?.length > 0 ? ` #${r.tags.join(" #")}` : ""),
          )
          .join("\n");

        return {
          content: [{ type: "text" as const, text: formatted }],
        };
      },
    },

    // ── mayros_forget ────────────────────────────────────────────────
    {
      name: "mayros_forget",
      description: "Delete a specific memory entry by ID.",
      parameters: Type.Object({
        id: Type.String({ description: "Memory ID to delete" }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const memoryId = params.id as string;
        try {
          const res = await fetch(
            `${cortexBaseUrl}/api/v1/memory/${encodeURIComponent(memoryId)}`,
            {
              method: "DELETE",
              headers: defaultHeaders,
              signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            },
          );
          return {
            content: [
              {
                type: "text" as const,
                text: res.ok
                  ? `Memory ${memoryId} forgotten.`
                  : `Failed to forget: ${res.statusText}`,
              },
            ],
          };
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Memory delete unavailable. Cortex may not be running.",
              },
            ],
          };
        }
      },
    },
  ];
}

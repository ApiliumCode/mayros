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

    // ── mayros_memory_conflicts ──────────────────────────────────────
    {
      name: "mayros_memory_conflicts",
      description:
        "Scan semantic memory for contradictions and duplicates. " +
        "Detects exact duplicate memories and graph-level conflicts " +
        "(same subject+predicate with different values). " +
        "Use before storing new information to avoid contradictions, " +
        "or periodically to audit memory health.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({
            description: "Max triples to scan (default 200, max 1000)",
          }),
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const limit = Math.min(Math.max(Number(params.limit ?? 200), 1), 1000);

        // Step 1: Get all memory content triples
        type ContentTriple = { subject: string; object: string; created_at?: string };
        let contentTriples: ContentTriple[];
        try {
          const res = await fetch(`${cortexBaseUrl}/api/v1/query`, {
            method: "POST",
            headers: postHeaders,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              predicate: `${namespace}:memory:content`,
              limit,
            }),
          });
          if (!res.ok) {
            return {
              content: [{ type: "text" as const, text: `Cortex query failed: ${res.statusText}` }],
            };
          }
          const data = (await res.json()) as { matches: ContentTriple[]; total: number };
          contentTriples = data.matches;
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Conflict scan unavailable. Cortex may not be running.",
              },
            ],
          };
        }

        if (contentTriples.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No memories found to scan for conflicts." }],
          };
        }

        // Step 2: Detect exact duplicates (same content text)
        const contentMap = new Map<string, Array<{ subject: string; created_at?: string }>>();
        for (const triple of contentTriples) {
          const content =
            typeof triple.object === "string" ? triple.object : JSON.stringify(triple.object);
          const group = contentMap.get(content) ?? [];
          group.push({ subject: triple.subject, created_at: triple.created_at });
          contentMap.set(content, group);
        }

        const duplicates = [...contentMap.entries()]
          .filter(([, group]) => group.length > 1)
          .map(([content, group]) => ({
            content: content.slice(0, 120) + (content.length > 120 ? "..." : ""),
            count: group.length,
            subjects: group.map((g) => g.subject),
          }));

        // Step 3: Scan for subject-predicate conflicts (non-memory graph triples)
        type GraphTriple = { subject: string; predicate: string; object: unknown };
        let subjectConflicts: Array<{
          subject: string;
          predicate: string;
          values: string[];
        }> = [];
        try {
          const res = await fetch(`${cortexBaseUrl}/api/v1/query`, {
            method: "POST",
            headers: postHeaders,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({ limit }),
          });
          if (res.ok) {
            const data = (await res.json()) as { matches: GraphTriple[] };

            // Group by (subject, predicate)
            const groups = new Map<string, Set<string>>();
            for (const triple of data.matches) {
              // Skip memory triples — already handled above
              if (typeof triple.predicate === "string" && triple.predicate.includes(":memory:")) {
                continue;
              }

              const key = `${triple.subject}\0${triple.predicate}`;
              const values = groups.get(key) ?? new Set<string>();
              const objStr =
                typeof triple.object === "string" ? triple.object : JSON.stringify(triple.object);
              values.add(objStr);
              groups.set(key, values);
            }

            subjectConflicts = [...groups.entries()]
              .filter(([, values]) => values.size > 1)
              .map(([key, values]) => {
                const sep = key.indexOf("\0");
                return {
                  subject: key.slice(0, sep),
                  predicate: key.slice(sep + 1),
                  values: [...values],
                };
              });
          }
        } catch {
          // Non-critical — report what we have
        }

        // Format report
        const lines: string[] = [];
        lines.push(`Memory Conflict Scan (${contentTriples.length} memories scanned)`);
        lines.push("");

        if (duplicates.length === 0 && subjectConflicts.length === 0) {
          lines.push("No conflicts detected.");
          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        }

        if (duplicates.length > 0) {
          lines.push(`Duplicate Memories: ${duplicates.length}`);
          for (const dup of duplicates.slice(0, 20)) {
            lines.push(`  [${dup.count}x] "${dup.content}"`);
            lines.push(`    Subjects: ${dup.subjects.map((s) => s.split(":").pop()).join(", ")}`);
          }
          lines.push("");
        }

        if (subjectConflicts.length > 0) {
          lines.push(
            `Graph Conflicts (same subject+predicate, different values): ${subjectConflicts.length}`,
          );
          for (const conflict of subjectConflicts.slice(0, 20)) {
            lines.push(`  ${conflict.subject} :: ${conflict.predicate}`);
            for (const val of conflict.values.slice(0, 5)) {
              lines.push(`    - ${val.slice(0, 100)}${val.length > 100 ? "..." : ""}`);
            }
          }
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      },
    },

    // ── mayros_memory_digest ─────────────────────────────────────────
    {
      name: "mayros_memory_digest",
      description:
        "Get a summary of what is stored in semantic memory. " +
        "Shows total count, category distribution, recent entries, " +
        "and DAG statistics. Use at session start to understand " +
        "available context, or periodically to review memory health.",
      parameters: Type.Object({
        limit: Type.Optional(
          Type.Number({
            description: "Max recent memories to show (default 20, max 100)",
          }),
        ),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const limit = Math.min(Math.max(Number(params.limit ?? 20), 1), 100);

        // Get all memory content triples
        type ContentTriple = { subject: string; object: string; created_at?: string };
        let contentTriples: ContentTriple[] = [];
        let totalMemories = 0;
        try {
          const res = await fetch(`${cortexBaseUrl}/api/v1/query`, {
            method: "POST",
            headers: postHeaders,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
            body: JSON.stringify({
              predicate: `${namespace}:memory:content`,
              limit: 500,
            }),
          });
          if (res.ok) {
            const data = (await res.json()) as {
              matches: ContentTriple[];
              total: number;
            };
            contentTriples = data.matches;
            totalMemories = data.total;
          }
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Memory digest unavailable. Cortex may not be running.",
              },
            ],
          };
        }

        // Get categories (parallel with other queries)
        type CatTriple = { subject: string; object: string };
        const categoryPromise = fetch(`${cortexBaseUrl}/api/v1/query`, {
          method: "POST",
          headers: postHeaders,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
          body: JSON.stringify({
            predicate: `${namespace}:memory:category`,
            limit: 500,
          }),
        })
          .then(async (r) => (r.ok ? ((await r.json()) as { matches: CatTriple[] }).matches : []))
          .catch(() => [] as CatTriple[]);

        // Get DAG stats
        const dagPromise = fetch(`${cortexBaseUrl}/api/v1/dag/stats`, {
          headers: defaultHeaders,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
          .then(async (r) =>
            r.ok ? ((await r.json()) as { action_count: number; tip_count: number }) : null,
          )
          .catch(() => null);

        // Get graph stats
        const graphPromise = fetch(`${cortexBaseUrl}/api/v1/stats`, {
          headers: defaultHeaders,
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        })
          .then(async (r) =>
            r.ok
              ? ((await r.json()) as {
                  graph: { triple_count: number; subject_count: number };
                })
              : null,
          )
          .catch(() => null);

        const [categories, dagStats, graphStats] = await Promise.all([
          categoryPromise,
          dagPromise,
          graphPromise,
        ]);

        // Build category distribution
        const categoryMap = new Map<string, number>();
        for (const cat of categories) {
          const catName = typeof cat.object === "string" ? cat.object : "unknown";
          categoryMap.set(catName, (categoryMap.get(catName) ?? 0) + 1);
        }

        // Sort memories by created_at (most recent first)
        const sorted = [...contentTriples].sort((a, b) => {
          const ta = a.created_at ?? "";
          const tb = b.created_at ?? "";
          return tb.localeCompare(ta);
        });

        // Format output
        const lines: string[] = [];
        lines.push("Memory Digest");
        lines.push("=============");
        lines.push("");
        lines.push(`Total memories: ${totalMemories}`);

        if (graphStats) {
          lines.push(`Total graph triples: ${graphStats.graph.triple_count}`);
          lines.push(`Unique subjects: ${graphStats.graph.subject_count}`);
        }

        if (dagStats) {
          lines.push(`DAG actions: ${dagStats.action_count} (${dagStats.tip_count} tips)`);
        }

        if (categoryMap.size > 0) {
          lines.push("");
          lines.push("Categories:");
          const sortedCats = [...categoryMap.entries()].sort((a, b) => b[1] - a[1]);
          for (const [cat, count] of sortedCats) {
            lines.push(`  ${cat}: ${count}`);
          }
        }

        if (sorted.length > 0) {
          lines.push("");
          lines.push(`Recent Memories (${Math.min(limit, sorted.length)} of ${totalMemories}):`);
          for (const mem of sorted.slice(0, limit)) {
            const content =
              typeof mem.object === "string" ? mem.object : JSON.stringify(mem.object);
            const preview = content.slice(0, 100) + (content.length > 100 ? "..." : "");
            const date = mem.created_at
              ? ` [${mem.created_at.split("T")[0] ?? mem.created_at}]`
              : "";
            lines.push(`  - ${preview}${date}`);
          }
        } else {
          lines.push("");
          lines.push("No memories stored yet.");
        }

        return { content: [{ type: "text" as const, text: lines.join("\n") }] };
      },
    },
  ];
}

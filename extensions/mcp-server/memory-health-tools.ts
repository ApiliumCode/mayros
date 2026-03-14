/**
 * MCP-friendly Memory Health tools.
 *
 * Provides two tools for auditing memory health:
 *   - mayros_memory_conflicts: Detect duplicates and graph-level conflicts
 *   - mayros_memory_digest: Summarize memory state, categories, and stats
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export type MemoryHealthToolDeps = {
  cortexBaseUrl: string;
  namespace: string;
  authToken?: string;
};

/** Default timeout for Cortex HTTP requests (30 s). */
const REQUEST_TIMEOUT_MS = 30_000;

type ToolContent = { content: Array<{ type: "text"; text: string }> };

function textResult(text: string): ToolContent {
  return { content: [{ type: "text" as const, text }] };
}

export function createMemoryHealthTools(deps: MemoryHealthToolDeps): AdaptableTool[] {
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
            return textResult(`Cortex query failed: ${res.statusText}`);
          }
          const data = (await res.json()) as { matches: ContentTriple[]; total: number };
          contentTriples = data.matches;
        } catch {
          return textResult("Conflict scan unavailable. Cortex may not be running.");
        }

        if (contentTriples.length === 0) {
          return textResult("No memories found to scan for conflicts.");
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
          return textResult(lines.join("\n"));
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

        return textResult(lines.join("\n"));
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
          return textResult("Memory digest unavailable. Cortex may not be running.");
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

        if (graphStats?.graph) {
          lines.push(`Total graph triples: ${graphStats.graph.triple_count}`);
          lines.push(`Unique subjects: ${graphStats.graph.subject_count}`);
        }

        if (dagStats?.action_count !== undefined) {
          lines.push(`DAG actions: ${dagStats.action_count} (${dagStats.tip_count ?? 0} tips)`);
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

        return textResult(lines.join("\n"));
      },
    },
  ];
}

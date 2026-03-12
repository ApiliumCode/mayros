/**
 * MCP-friendly Cortex graph query tools.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export type CortexToolDeps = {
  cortexBaseUrl: string;
  namespace: string;
};

export function createCortexTools(deps: CortexToolDeps): AdaptableTool[] {
  const { cortexBaseUrl } = deps;

  return [
    {
      name: "mayros_cortex_query",
      description:
        "Query the semantic knowledge graph. " +
        "Find triples by subject, predicate, or object pattern. " +
        "Use this for structured knowledge retrieval.",
      parameters: Type.Object({
        subject: Type.Optional(
          Type.String({ description: "Subject pattern (e.g., 'project:api')" }),
        ),
        predicate: Type.Optional(
          Type.String({ description: "Predicate pattern (e.g., 'uses_framework')" }),
        ),
        object: Type.Optional(Type.String({ description: "Object value to match" })),
        limit: Type.Optional(Type.Number({ description: "Max results (default 20)" })),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const limit = Math.min((params.limit as number) ?? 20, 500);
        const queryParams = new URLSearchParams();
        if (params.subject) queryParams.set("subject", params.subject as string);
        if (params.predicate) queryParams.set("predicate", params.predicate as string);
        if (params.object) queryParams.set("object", params.object as string);
        queryParams.set("limit", String(limit));

        try {
          const res = await fetch(`${cortexBaseUrl}/api/v1/triples?${queryParams}`);
          if (!res.ok) {
            return {
              content: [{ type: "text" as const, text: `Query failed: ${res.statusText}` }],
            };
          }

          const data = (await res.json()) as {
            triples: Array<{ subject: string; predicate: string; object: unknown }>;
          };
          if (!data.triples || data.triples.length === 0) {
            return { content: [{ type: "text" as const, text: "No triples found." }] };
          }

          const formatted = data.triples
            .map((t) => `  ${t.subject} -> ${t.predicate} -> ${JSON.stringify(t.object)}`)
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text: `Found ${data.triples.length} triples:\n${formatted}`,
              },
            ],
          };
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Cortex query unavailable. Cortex may not be running.",
              },
            ],
          };
        }
      },
    },

    {
      name: "mayros_cortex_store",
      description:
        "Store a fact in the semantic knowledge graph as an RDF triple. " +
        "Use subject-predicate-object structure for structured knowledge.",
      parameters: Type.Object({
        subject: Type.String({ description: "Subject (e.g., 'project:payments-api')" }),
        predicate: Type.String({
          description: "Predicate/relation (e.g., 'uses_framework')",
        }),
        object: Type.String({ description: "Object/value (e.g., 'Express.js')" }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        try {
          const res = await fetch(`${cortexBaseUrl}/api/v1/triples`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              subject: params.subject,
              predicate: params.predicate,
              object: params.object,
            }),
          });

          if (!res.ok) {
            return {
              content: [{ type: "text" as const, text: `Store failed: ${res.statusText}` }],
            };
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `Stored: ${params.subject as string} -> ${params.predicate as string} -> ${params.object as string}`,
              },
            ],
          };
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: "Cortex store unavailable. Cortex may not be running.",
              },
            ],
          };
        }
      },
    },

    {
      name: "mayros_memory_stats",
      description:
        "Get memory system statistics: STM entries, LTM entities, HNSW index size, graph triple count.",
      parameters: Type.Object({}),
      execute: async () => {
        const results: string[] = [];

        // Ineru stats
        try {
          const memRes = await fetch(`${cortexBaseUrl}/api/v1/memory/stats`);
          if (memRes.ok) {
            const stats = (await memRes.json()) as {
              stm_count: number;
              stm_capacity: number;
              ltm_entity_count: number;
              ltm_link_count: number;
              total_memory_bytes: number;
            };
            results.push(
              "Ineru Memory:",
              `  STM: ${stats.stm_count} / ${stats.stm_capacity} entries`,
              `  LTM: ${stats.ltm_entity_count} entities, ${stats.ltm_link_count} links`,
              `  Size: ${(stats.total_memory_bytes / 1024).toFixed(1)} KB`,
            );
          }
        } catch {
          /* Cortex unavailable */
        }

        // HNSW stats
        try {
          const idxRes = await fetch(`${cortexBaseUrl}/api/v1/memory/index/stats`);
          if (idxRes.ok) {
            const idx = (await idxRes.json()) as {
              point_count: number;
              dimensions: number;
              memory_bytes: number;
            };
            results.push(
              "HNSW Vector Index:",
              `  Points: ${idx.point_count}`,
              `  Dimensions: ${idx.dimensions}`,
              `  Size: ${(idx.memory_bytes / 1024).toFixed(1)} KB`,
            );
          }
        } catch {
          /* */
        }

        // Graph stats
        try {
          const graphRes = await fetch(`${cortexBaseUrl}/api/v1/stats`);
          if (graphRes.ok) {
            const stats = (await graphRes.json()) as {
              graph: {
                triple_count: number;
                subject_count: number;
                predicate_count: number;
              };
            };
            results.push(
              "Knowledge Graph:",
              `  Triples: ${stats.graph.triple_count}`,
              `  Subjects: ${stats.graph.subject_count}`,
              `  Predicates: ${stats.graph.predicate_count}`,
            );
          }
        } catch {
          /* */
        }

        return {
          content: [
            {
              type: "text" as const,
              text: results.length > 0 ? results.join("\n") : "Cortex sidecar not running.",
            },
          ],
        };
      },
    },
  ];
}

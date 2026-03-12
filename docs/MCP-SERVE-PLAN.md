# Mayros MCP Serve — Implementation Plan

Target: **v0.1.15**
Goal: `mayros serve` becomes the primary way Claude Code (and any MCP client) gets persistent memory, governance, and budget tracking.

## Current State

`mayros serve` **already exists** in `extensions/mcp-server/`. It:

- Starts an MCP server (stdio or HTTP transport on port 3100)
- Auto-discovers tools from the plugin registry via `resolvePluginTools()`
- Exposes resources (agents, conventions, rules, graph stats) via Cortex
- Has protocol dispatcher, tool adapter (TypeBox → JSON Schema), CORS, auth
- MCP protocol version: 2025-03-26

### What's Missing

| Gap                                                               | Impact                             | Status  |
| ----------------------------------------------------------------- | ---------------------------------- | ------- |
| Cortex sidecar doesn't auto-start with `mayros serve`             | Memory tools fail without Cortex   | Missing |
| SSE transport for Claude Desktop `/sse` endpoint                  | Claude Desktop can't connect       | Missing |
| Legacy HTTP+SSE transport (`/sse` endpoint)                       | Obsidian MCP pattern compatibility | Missing |
| Dedicated memory tools (simpler API than `semantic_memory_store`) | UX friction                        | Missing |
| Vector search tool                                                | Core differentiator not exposed    | Missing |
| `claude mcp add` auto-config                                      | User must manually configure       | Missing |
| Health check includes Cortex status                               | Can't diagnose issues              | Partial |
| Tool naming convention (`mayros_*` prefix)                        | Tools mixed with internal names    | Missing |
| Documentation for Claude Code users                               | No onboarding guide                | Missing |

---

## Architecture

```
                  ┌───────────────────────────┐
                  │     Claude Code / IDE      │
                  │     (MCP Client)           │
                  └─────────┬─────────────────┘
                            │
              ┌─────────────┼──────────────┐
              │ stdio       │ HTTP POST    │ SSE
              │             │ /mcp         │ /sse
              ▼             ▼              ▼
         ┌──────────────────────────────────────┐
         │          McpServer                    │
         │  ┌──────────────────────────────┐     │
         │  │   McpProtocolDispatcher      │     │
         │  │   (JSON-RPC 2.0)             │     │
         │  └──────────┬───────────────────┘     │
         │             │                         │
         │  ┌──────────▼───────────────────┐     │
         │  │   Tool Registry              │     │
         │  │                              │     │
         │  │  mayros_remember             │     │
         │  │  mayros_recall               │     │
         │  │  mayros_search               │     │
         │  │  mayros_forget               │     │
         │  │  mayros_budget               │     │
         │  │  mayros_policy_check         │     │
         │  │  mayros_cortex_query         │     │
         │  │  mayros_cortex_store         │     │
         │  │  + all existing plugin tools │     │
         │  └──────────┬───────────────────┘     │
         └─────────────┼────────────────────────┘
                       │
              ┌────────▼────────┐
              │  Cortex Sidecar │  (auto-started)
              │  :19090         │
              │  ┌────────────┐ │
              │  │ GraphDB    │ │
              │  │ (Sled)     │ │
              │  ├────────────┤ │
              │  │ Ineru      │ │
              │  │ STM/LTM    │ │
              │  │ HNSW       │ │
              │  └────────────┘ │
              └─────────────────┘
```

---

## Task 1: Auto-start Cortex with `mayros serve`

### Problem

Currently `mayros serve` collects tools and starts the MCP server, but does NOT start the Cortex sidecar. Memory tools that depend on Cortex will fail silently.

### Solution

In `extensions/mcp-server/index.ts`, the `serve` CLI action must start Cortex before collecting tools.

### Files to modify

#### `extensions/mcp-server/index.ts` — serve action (line 159)

Before `const tools = await collectTools({})`, add:

```typescript
// Auto-start Cortex sidecar for memory and graph tools
let sidecar: CortexSidecar | null = null;
try {
  const { CortexSidecar } = await import("../memory-semantic/cortex-sidecar.js");
  const { resolveCortexConfig } = await import("../memory-semantic/cortex-config.js");
  const cortexCfg = resolveCortexConfig(api.config);
  sidecar = new CortexSidecar(cortexCfg);
  const started = await sidecar.start();
  if (started) {
    api.logger.info("Cortex sidecar started for MCP server");
  } else {
    api.logger.warn("Cortex sidecar failed to start — memory tools will be unavailable");
  }
} catch (err) {
  api.logger.warn(`Cortex sidecar not available: ${String(err)}`);
}
```

And on shutdown (inside the SIGINT/SIGTERM handler):

```typescript
process.on("SIGINT", () => {
  void (async () => {
    if (sidecar) await sidecar.stop();
    await server?.stop();
    resolve();
  })();
});
```

### Dependencies

- `extensions/memory-semantic/cortex-sidecar.ts` — `CortexSidecar` class (already exists)
- `extensions/memory-semantic/cortex-config.ts` — `resolveCortexConfig()` (already exists)

---

## Task 2: Dedicated MCP Memory Tools

### Problem

The existing `semantic_memory_store` tool is designed for internal agent use. Its API is complex (RDF triples, subjects, predicates). MCP clients need a simpler, more intuitive API.

### Solution

Register dedicated `mayros_*` prefixed tools in the MCP server plugin that wrap the existing Cortex client with a user-friendly API.

### New file: `extensions/mcp-server/memory-tools.ts`

```typescript
/**
 * MCP-friendly memory tools.
 *
 * Wraps Cortex/Ineru APIs with a simple remember/recall/search interface
 * designed for external MCP clients (Claude Code, Cursor, etc.).
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export type MemoryToolDeps = {
  cortexBaseUrl: string;
  namespace: string;
};

export function createMemoryTools(deps: MemoryToolDeps): AdaptableTool[] {
  const { cortexBaseUrl, namespace } = deps;

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
        const tags = (params.tags as string[]) ?? [];
        const importance = (params.importance as number) ?? 0.7;

        // Store as RDF triple in Cortex
        const subject = `${namespace}:memory:${Date.now()}`;
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

        // Store in Cortex graph
        for (const triple of triples) {
          await fetch(`${cortexBaseUrl}/api/v1/triples`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(triple),
          });
        }

        // Also store in Ineru STM for vector search
        await fetch(`${cortexBaseUrl}/api/v1/memory/remember`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entry_type: category,
            data: { content, tags },
            tags,
            importance,
          }),
        });

        return {
          content: [
            {
              type: "text" as const,
              text: `Remembered: "${content.slice(0, 80)}${content.length > 80 ? "..." : ""}" [${category}]${tags.length > 0 ? ` #${tags.join(" #")}` : ""}`,
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
        const tags = params.tags as string[] | undefined;
        const category = params.category as string | undefined;
        const limit = (params.limit as number) ?? 10;

        // Query Ineru recall endpoint
        const recallRes = await fetch(`${cortexBaseUrl}/api/v1/memory/recall`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            text: query,
            tags: tags ?? [],
            entry_type: category,
            limit,
          }),
        });

        if (!recallRes.ok) {
          // Fallback: query Cortex graph directly
          const pattern: Record<string, unknown> = {};
          if (query) pattern.object = query;
          const graphRes = await fetch(
            `${cortexBaseUrl}/api/v1/triples?predicate=${namespace}:memory:content&limit=${limit}`,
          );
          const graphData = (await graphRes.json()) as { triples?: Array<{ object: string }> };
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
        }

        const memories = (await recallRes.json()) as Array<{
          id: string;
          entry_type: string;
          data: { content?: string };
          tags: string[];
          importance: number;
          relevance: number;
          source: string;
        }>;

        if (memories.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No memories found." }],
          };
        }

        const formatted = memories
          .map(
            (m, i) =>
              `${i + 1}. [${m.entry_type}] ${m.data.content ?? JSON.stringify(m.data)}` +
              (m.tags.length > 0 ? ` #${m.tags.join(" #")}` : "") +
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
        "Vector similarity search over memory using HNSW index. " +
        "Finds semantically similar memories even with different wording. " +
        "Requires an embedding vector (or text for future auto-embedding).",
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
        const k = (params.k as number) ?? 5;

        // For now, fall back to Ineru recall with text matching
        // TODO: Auto-embed text via LLM and call /api/v1/memory/search
        const recallRes = await fetch(`${cortexBaseUrl}/api/v1/memory/recall`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text, limit: k }),
        });

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

        const results = (await recallRes.json()) as Array<{
          data: { content?: string };
          relevance: number;
          entry_type: string;
          tags: string[];
        }>;

        if (results.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No similar memories found." }],
          };
        }

        const formatted = results
          .map(
            (r, i) =>
              `${i + 1}. [${(r.relevance * 100).toFixed(0)}%] ${r.data.content ?? JSON.stringify(r.data)}` +
              (r.tags.length > 0 ? ` #${r.tags.join(" #")}` : ""),
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
        const res = await fetch(`${cortexBaseUrl}/api/v1/memory/${memoryId}`, {
          method: "DELETE",
        });
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
      },
    },
  ];
}
```

### New file: `extensions/mcp-server/budget-tools.ts`

```typescript
/**
 * MCP-friendly budget/token economy tools.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export function createBudgetTools(): AdaptableTool[] {
  return [
    {
      name: "mayros_budget",
      description:
        "Check token usage and budget status. " +
        "Shows session spend, daily spend, and remaining budget.",
      parameters: Type.Object({}),
      execute: async () => {
        // Read budget state from disk
        const budgetPath = `${process.env.HOME ?? "."}/.mayros/budget-state.json`;
        try {
          const { readFile } = await import("node:fs/promises");
          const data = JSON.parse(await readFile(budgetPath, "utf-8")) as {
            sessionTokens?: number;
            dailyTokens?: number;
            monthlyTokens?: number;
            sessionCostUsd?: number;
            dailyCostUsd?: number;
            monthlyCostUsd?: number;
            sessionLimit?: number;
            dailyLimit?: number;
          };

          const lines = [
            "Token Budget Status:",
            `  Session: ${data.sessionTokens?.toLocaleString() ?? 0} tokens ($${(data.sessionCostUsd ?? 0).toFixed(4)})`,
            `  Daily:   ${data.dailyTokens?.toLocaleString() ?? 0} tokens ($${(data.dailyCostUsd ?? 0).toFixed(4)})`,
            `  Monthly: ${data.monthlyTokens?.toLocaleString() ?? 0} tokens ($${(data.monthlyCostUsd ?? 0).toFixed(4)})`,
          ];
          if (data.sessionLimit) {
            lines.push(`  Session limit: ${data.sessionLimit.toLocaleString()} tokens`);
          }
          if (data.dailyLimit) {
            lines.push(`  Daily limit: ${data.dailyLimit.toLocaleString()} tokens`);
          }

          return { content: [{ type: "text" as const, text: lines.join("\n") }] };
        } catch {
          return {
            content: [{ type: "text" as const, text: "No budget data available yet." }],
          };
        }
      },
    },
  ];
}
```

### New file: `extensions/mcp-server/governance-tools.ts`

```typescript
/**
 * MCP-friendly governance tools.
 */

import { Type } from "@sinclair/typebox";
import type { AdaptableTool } from "./tool-adapter.js";

export function createGovernanceTools(): AdaptableTool[] {
  return [
    {
      name: "mayros_policy_check",
      description:
        "Check if an action is allowed by the project governance policies. " +
        "Evaluates tool calls, file operations, and commands against MAYROS.md rules.",
      parameters: Type.Object({
        action: Type.String({
          description: 'Action type: "tool_call", "file_write", "file_delete", "shell_command"',
        }),
        target: Type.String({
          description: "Target of the action (tool name, file path, or command)",
        }),
        details: Type.Optional(Type.String({ description: "Additional context about the action" })),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
        const action = params.action as string;
        const target = params.target as string;

        // Load policy rules from MAYROS.md if exists
        const { readFile, access } = await import("node:fs/promises");
        const policyPath = `${process.cwd()}/MAYROS.md`;

        try {
          await access(policyPath);
          const content = await readFile(policyPath, "utf-8");

          // Simple pattern matching against DENY/ALLOW rules
          const denyPatterns: string[] = [];
          const allowPatterns: string[] = [];
          for (const line of content.split("\n")) {
            const trimmed = line.trim();
            if (trimmed.startsWith("- DENY:")) {
              denyPatterns.push(trimmed.slice(7).trim());
            } else if (trimmed.startsWith("- ALLOW:")) {
              allowPatterns.push(trimmed.slice(8).trim());
            }
          }

          // Check deny rules
          for (const pattern of denyPatterns) {
            if (target.includes(pattern) || action.includes(pattern)) {
              return {
                content: [
                  {
                    type: "text" as const,
                    text: `DENIED: "${target}" matches deny rule "${pattern}"`,
                  },
                ],
              };
            }
          }

          return {
            content: [
              {
                type: "text" as const,
                text: `ALLOWED: "${action}" on "${target}" — no deny rules matched (${denyPatterns.length} rules checked)`,
              },
            ],
          };
        } catch {
          return {
            content: [
              {
                type: "text" as const,
                text: `ALLOWED (no policy): No MAYROS.md found at ${policyPath}. All actions permitted.`,
              },
            ],
          };
        }
      },
    },
  ];
}
```

### New file: `extensions/mcp-server/cortex-tools.ts`

```typescript
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
  const { cortexBaseUrl, namespace } = deps;

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
        const limit = (params.limit as number) ?? 20;
        const queryParams = new URLSearchParams();
        if (params.subject) queryParams.set("subject", params.subject as string);
        if (params.predicate) queryParams.set("predicate", params.predicate as string);
        if (params.object) queryParams.set("object", params.object as string);
        queryParams.set("limit", String(limit));

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
          .map((t) => `  ${t.subject} → ${t.predicate} → ${JSON.stringify(t.object)}`)
          .join("\n");

        return {
          content: [
            { type: "text" as const, text: `Found ${data.triples.length} triples:\n${formatted}` },
          ],
        };
      },
    },

    {
      name: "mayros_cortex_store",
      description:
        "Store a fact in the semantic knowledge graph as an RDF triple. " +
        "Use subject-predicate-object structure for structured knowledge.",
      parameters: Type.Object({
        subject: Type.String({ description: "Subject (e.g., 'project:payments-api')" }),
        predicate: Type.String({ description: "Predicate/relation (e.g., 'uses_framework')" }),
        object: Type.String({ description: "Object/value (e.g., 'Express.js')" }),
      }),
      execute: async (_id: string, params: Record<string, unknown>) => {
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
              text: `Stored: ${params.subject as string} → ${params.predicate as string} → ${params.object as string}`,
            },
          ],
        };
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
            const g = (await graphRes.json()) as {
              triple_count: number;
              subject_count: number;
              predicate_count: number;
            };
            results.push(
              "Knowledge Graph:",
              `  Triples: ${g.triple_count}`,
              `  Subjects: ${g.subject_count}`,
              `  Predicates: ${g.predicate_count}`,
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
```

---

## Task 3: Wire MCP Tools into Server

### Modify `extensions/mcp-server/index.ts`

In the `serve` CLI action, after Cortex starts and before `server.start()`:

```typescript
// Register dedicated MCP tools
const cortexPort = cortexCfg?.port ?? 19090;
const cortexBase = `http://127.0.0.1:${cortexPort}`;
const ns = serverCfg.agentNamespace || "mayros";

const { createMemoryTools } = await import("./memory-tools.js");
const { createBudgetTools } = await import("./budget-tools.js");
const { createGovernanceTools } = await import("./governance-tools.js");
const { createCortexTools } = await import("./cortex-tools.js");

const mcpTools: AdaptableTool[] = [
  ...createMemoryTools({ cortexBaseUrl: cortexBase, namespace: ns }),
  ...createBudgetTools(),
  ...createGovernanceTools(),
  ...createCortexTools({ cortexBaseUrl: cortexBase, namespace: ns }),
];

// Combine with auto-discovered plugin tools
const allTools = [...mcpTools, ...tools];
```

Pass `allTools` to `McpServerOptions` instead of `tools`.

---

## Task 4: Legacy SSE Transport (Claude Desktop compatibility)

### Problem

Claude Desktop uses the legacy MCP "HTTP with SSE" transport (`/sse` endpoint + POST to returned URL). The current HTTP transport only supports Streamable HTTP (`POST /mcp`).

The obsidian-claude-code-mcp plugin serves on port 22360 with `/sse` for this reason.

### Modify `extensions/mcp-server/transport-http.ts`

Add `/sse` endpoint handling alongside existing `/mcp`:

```typescript
// In handleRequest(), add before the "Not found" fallback:

// Legacy SSE transport (Claude Desktop compatibility)
if (url === "/sse" && method === "GET") {
  this.handleLegacySse(req, res);
  return;
}
```

The legacy SSE transport:

1. Client does `GET /sse` → server returns SSE stream with `endpoint` event
2. `endpoint` event contains URL for client to POST JSON-RPC requests to
3. Server responses come back through the SSE stream

```typescript
private handleLegacySse(req: IncomingMessage, res: ServerResponse): void {
  const sessionId = crypto.randomUUID();
  const postUrl = `/mcp/session/${sessionId}`;

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  // Send endpoint URL
  res.write(`event: endpoint\ndata: ${postUrl}\n\n`);

  // Store SSE connection for this session
  this.sseSessions.set(sessionId, res);

  // Keep alive
  const keepAlive = setInterval(() => {
    if (res.destroyed) { clearInterval(keepAlive); return; }
    res.write(": ping\n\n");
  }, 15_000);

  res.on("close", () => {
    clearInterval(keepAlive);
    this.sseSessions.delete(sessionId);
  });
}
```

And handle `POST /mcp/session/:id`:

```typescript
if (url.startsWith("/mcp/session/") && method === "POST") {
  const sessionId = url.split("/mcp/session/")[1];
  const sseRes = this.sseSessions.get(sessionId);
  if (!sseRes) {
    res.writeHead(404);
    res.end();
    return;
  }

  const body = await readBody(req);
  const response = await this.dispatcher.handleMessage(body);

  // Send response through SSE stream
  if (response) {
    sseRes.write(`event: message\ndata: ${response}\n\n`);
  }

  // Ack the POST
  res.writeHead(202);
  res.end();
  return;
}
```

Add field to class:

```typescript
private sseSessions = new Map<string, ServerResponse>();
```

---

## Task 5: `claude mcp add` Auto-Configuration

### New file: `extensions/mcp-server/setup-claude.ts`

```typescript
/**
 * Auto-configure Claude Code to use Mayros MCP server.
 *
 * Writes the MCP server config to Claude Code's settings.
 */

export async function setupClaudeCodeMcp(opts: { port: number; host: string }): Promise<void> {
  const { execSync } = await import("node:child_process");

  try {
    // Use claude CLI to add MCP server
    execSync(
      `claude mcp add mayros -- mayros serve --http --port ${opts.port} --host ${opts.host}`,
      { stdio: "inherit" },
    );
    console.log("Mayros MCP server registered with Claude Code.");
  } catch {
    // Fallback: show manual instructions
    console.log("\nTo connect Mayros to Claude Code, run:\n");
    console.log(
      `  claude mcp add mayros -- mayros serve --http --port ${opts.port} --host ${opts.host}\n`,
    );
  }
}
```

### Add CLI subcommand in `extensions/mcp-server/index.ts`

```typescript
const setup = program
  .command("mcp-setup")
  .description("Register Mayros as an MCP server in Claude Code")
  .option("--port <port>", "HTTP port (default: 3100)", parseInt)
  .action(async (opts: { port?: number }) => {
    const { setupClaudeCodeMcp } = await import("./setup-claude.js");
    await setupClaudeCodeMcp({ port: opts.port ?? 3100, host: "127.0.0.1" });
  });
```

---

## Task 6: Enhanced Health Check

### Modify `extensions/mcp-server/transport-http.ts`

Change health endpoint to include Cortex status:

```typescript
if (url === "/health" && method === "GET") {
  // Check Cortex health
  let cortexHealthy = false;
  try {
    const cortexRes = await fetch("http://127.0.0.1:19090/health");
    cortexHealthy = cortexRes.ok;
  } catch {
    /* */
  }

  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(
    JSON.stringify({
      status: "ok",
      transport: "streamable-http",
      cortex: cortexHealthy ? "healthy" : "unavailable",
      tools: this.dispatcher.toolCount(),
    }),
  );
  return;
}
```

---

## Files Summary

### New Files

| File                                        | Purpose                                                       | LOC est. |
| ------------------------------------------- | ------------------------------------------------------------- | -------- |
| `extensions/mcp-server/memory-tools.ts`     | mayros_remember, mayros_recall, mayros_search, mayros_forget  | ~220     |
| `extensions/mcp-server/budget-tools.ts`     | mayros_budget                                                 | ~60      |
| `extensions/mcp-server/governance-tools.ts` | mayros_policy_check                                           | ~80      |
| `extensions/mcp-server/cortex-tools.ts`     | mayros_cortex_query, mayros_cortex_store, mayros_memory_stats | ~150     |
| `extensions/mcp-server/setup-claude.ts`     | `mayros mcp-setup` auto-config                                | ~30      |

### Modified Files

| File                                      | Change                                                 |
| ----------------------------------------- | ------------------------------------------------------ |
| `extensions/mcp-server/index.ts`          | Auto-start Cortex, wire MCP tools, add `mcp-setup` CLI |
| `extensions/mcp-server/transport-http.ts` | Add `/sse` legacy transport, enhanced `/health`        |

### Tools Exposed via MCP

| Tool                        | Category    | Description                          |
| --------------------------- | ----------- | ------------------------------------ |
| `mayros_remember`           | Memory      | Store information persistently       |
| `mayros_recall`             | Memory      | Search memory by text/tags/category  |
| `mayros_search`             | Memory      | Vector similarity search             |
| `mayros_forget`             | Memory      | Delete a memory entry                |
| `mayros_budget`             | Economy     | Token usage and budget status        |
| `mayros_policy_check`       | Governance  | Check action against MAYROS.md rules |
| `mayros_cortex_query`       | Knowledge   | Query semantic graph                 |
| `mayros_cortex_store`       | Knowledge   | Store fact in semantic graph         |
| `mayros_memory_stats`       | Diagnostics | Memory and index statistics          |
| + all existing plugin tools | Various     | Auto-discovered from plugin registry |

---

## User Experience

### Installation (2 commands)

```bash
npm install -g mayros
claude mcp add mayros -- mayros serve --http
```

### Or with auto-setup

```bash
npm install -g mayros
mayros mcp-setup
```

### What Claude Code sees

After connection, Claude Code has 9+ new tools available:

```
Connected to MCP server: Mayros (9 tools)
  mayros_remember     — Store information in persistent semantic memory
  mayros_recall       — Search persistent memory
  mayros_search       — Vector similarity search over memory
  mayros_forget       — Delete a memory entry
  mayros_budget       — Check token usage and budget
  mayros_policy_check — Check governance policies
  mayros_cortex_query — Query semantic knowledge graph
  mayros_cortex_store — Store fact in knowledge graph
  mayros_memory_stats — Memory system statistics
```

### Example session

```
User: "Remember that the payments API uses Stripe with rate limit 100/min"

Claude Code → mayros_remember(
  content: "The payments API uses Stripe with rate limit of 100 requests per minute",
  category: "architecture",
  tags: ["payments", "stripe", "api", "rate-limit"]
)

[3 days later, new session]

User: "What do we know about the payments module?"

Claude Code → mayros_recall(
  query: "payments module",
  limit: 5
)

→ 1. [architecture] The payments API uses Stripe with rate limit of 100/min #payments #stripe (relevance: 95%, source: LongTerm)
```

---

## Implementation Sequence

```
Task 1 — Auto-start Cortex (~30 lines in index.ts)
Task 2 — Memory tools (memory-tools.ts, ~220 LOC)
Task 3 — Wire tools + budget + governance + cortex tools (~100 LOC new files + ~20 lines in index.ts)
Task 4 — Legacy SSE transport (~80 lines in transport-http.ts)
Task 5 — claude mcp add setup (~30 LOC + CLI command)
Task 6 — Enhanced health check (~15 lines)

Total: ~6 files new/modified, ~550 LOC net
```

---

## Constraints

- No new npm dependencies (uses Node built-in `http`, `fs`, `crypto`)
- Backward compatible: `mayros serve --stdio` unchanged
- Cortex failure is non-fatal: server starts, memory tools return "unavailable"
- Tool names prefixed `mayros_*` to avoid collision with user's MCP tools
- MCP protocol: 2025-03-26 (Streamable HTTP) + 2024-11-05 (legacy SSE) dual support
- Auth token optional (disabled by default for local use)

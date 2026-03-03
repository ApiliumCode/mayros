/**
 * Mayros Code Indexer Plugin
 *
 * Scans TypeScript/JS files using regex, generates RDF triples for
 * codebase structure, and supports incremental updates via content hashing.
 *
 * Provides:
 *   - 1 tool: `code_index_query` — search code entities in the graph
 *   - 1 CLI: `mayros code-index run|status|query`
 *   - 1 service: background indexer
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { codeIndexerConfigSchema } from "./config.js";
import { codePredicate } from "./rdf-mapper.js";
import { runIncrementalIndex, getIndexStats } from "./incremental.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const codeIndexerPlugin = {
  id: "code-indexer",
  name: "Code Indexer",
  description:
    "Regex-based codebase indexer — scans TypeScript/JS files and stores structure as RDF triples in Cortex",
  kind: "indexer" as const,
  configSchema: codeIndexerConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = codeIndexerConfigSchema.parse(api.pluginConfig);
    const ns = cfg.agentNamespace;
    const client = new CortexClient(cfg.cortex);

    let cortexAvailable = false;

    async function ensureCortex(): Promise<boolean> {
      if (cortexAvailable) return true;
      cortexAvailable = await client.isHealthy();
      return cortexAvailable;
    }

    api.logger.info(`code-indexer: plugin registered (ns: ${ns}, paths: ${cfg.paths.join(", ")})`);

    // ========================================================================
    // Tool: code_index_query
    // ========================================================================

    api.registerTool(
      {
        name: "code_index_query",
        label: "Code Index Query",
        description:
          "Search the code knowledge graph for symbols, files, imports, and dependencies.",
        parameters: Type.Object({
          query: Type.String({ description: "Search term (symbol name, file path, or module)" }),
          type: Type.Optional(
            Type.Unsafe<string>({
              type: "string",
              enum: ["function", "class", "import", "file"],
            }),
          ),
          limit: Type.Optional(Type.Number({ description: "Max results (default: 10)" })),
        }),
        async execute(_toolCallId, params) {
          const {
            query,
            type,
            limit = 10,
          } = params as {
            query: string;
            type?: string;
            limit?: number;
          };

          if (!(await ensureCortex())) {
            return {
              content: [{ type: "text", text: "Cortex unavailable. Code index not accessible." }],
              details: { count: 0, reason: "cortex_unavailable" },
            };
          }

          const results: Array<{
            subject: string;
            type: string;
            name: string;
            path: string;
            line: number;
          }> = [];

          try {
            // Search by name predicate
            const nameMatches = await client.patternQuery({
              predicate: codePredicate(ns, "name"),
              object: query,
              limit: limit * 3,
            });

            for (const match of nameMatches.matches) {
              const tripleResult = await client.listTriples({ subject: match.subject, limit: 10 });
              const entity = parseCodeEntity(ns, tripleResult.triples);
              if (!entity) continue;
              if (type && entity.type !== type) continue;
              results.push(entity);
              if (results.length >= limit) break;
            }

            // If not enough results, also search by path
            if (results.length < limit) {
              const pathMatches = await client.patternQuery({
                predicate: codePredicate(ns, "path"),
                object: query,
                limit: limit * 2,
              });

              for (const match of pathMatches.matches) {
                if (results.some((r) => r.subject === match.subject)) continue;
                const tripleResult = await client.listTriples({
                  subject: match.subject,
                  limit: 10,
                });
                const entity = parseCodeEntity(ns, tripleResult.triples);
                if (!entity) continue;
                if (type && entity.type !== type) continue;
                results.push(entity);
                if (results.length >= limit) break;
              }
            }
          } catch (err) {
            return {
              content: [{ type: "text", text: `Query failed: ${String(err)}` }],
              details: { count: 0, error: String(err) },
            };
          }

          if (results.length === 0) {
            return {
              content: [{ type: "text", text: `No code entities found for "${query}".` }],
              details: { count: 0, query },
            };
          }

          const text = results
            .map((r, i) => `${i + 1}. [${r.type}] ${r.name} — ${r.path}:${r.line}`)
            .join("\n");

          return {
            content: [{ type: "text", text: `Found ${results.length} code entities:\n\n${text}` }],
            details: { count: results.length, query, results },
          };
        },
      },
      { name: "code_index_query" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(({ program }) => {
      const codeIndex = program
        .command("code-index")
        .description("Code indexer — scan codebase structure into knowledge graph");

      // mayros code-index run [--path <dir>]
      codeIndex
        .command("run")
        .description("Run full or incremental code index")
        .option("--path <dir>", "Override project root directory")
        .action(async (opts: { path?: string }) => {
          const rootDir = opts.path ?? process.cwd();

          if (!(await ensureCortex())) {
            console.log("Cortex: OFFLINE — cannot index");
            return;
          }

          console.log(`Indexing ${rootDir}...`);
          console.log(`  Paths: ${cfg.paths.join(", ")}`);
          console.log(`  Extensions: ${cfg.extensions.join(", ")}`);

          const stats = await runIncrementalIndex(client, ns, rootDir, cfg, {
            info: (msg) => console.log(`  ${msg}`),
            warn: (msg) => console.warn(`  ${msg}`),
          });

          console.log("");
          console.log(`Index complete in ${stats.durationMs}ms:`);
          console.log(`  Total files: ${stats.totalFiles}`);
          console.log(`  New: ${stats.newFiles}`);
          console.log(`  Changed: ${stats.changedFiles}`);
          console.log(`  Unchanged: ${stats.unchangedFiles}`);
          console.log(`  Removed: ${stats.removedFiles}`);
          console.log(`  Entities: ${stats.totalEntities}`);
          console.log(`  Triples: ${stats.totalTriples}`);
        });

      // mayros code-index status
      codeIndex
        .command("status")
        .description("Show code index statistics")
        .action(async () => {
          if (!(await ensureCortex())) {
            console.log("Cortex: OFFLINE");
            return;
          }

          const stats = await getIndexStats(client, ns);
          console.log("Code Index Status:");
          console.log(`  Files: ${stats.files}`);
          console.log(`  Functions: ${stats.functions}`);
          console.log(`  Classes: ${stats.classes}`);
          console.log(`  Imports: ${stats.imports}`);
          console.log(`  Last indexed: ${stats.lastIndexed ?? "never"}`);
        });

      // mayros code-index query <term>
      codeIndex
        .command("query")
        .description("Search code entities in the graph")
        .argument("<term>", "Search term")
        .option("--type <type>", "Filter by entity type (function, class, import, file)")
        .option("--limit <n>", "Max results", "10")
        .action(async (term: string, opts: { type?: string; limit?: string }) => {
          if (!(await ensureCortex())) {
            console.log("Cortex: OFFLINE");
            return;
          }

          const limit = parseInt(opts.limit ?? "10", 10);
          const results: Array<{ type: string; name: string; path: string; line: number }> = [];

          try {
            const nameMatches = await client.patternQuery({
              predicate: codePredicate(ns, "name"),
              object: term,
              limit: limit * 3,
            });

            for (const match of nameMatches.matches) {
              const tripleResult = await client.listTriples({ subject: match.subject, limit: 10 });
              const entity = parseCodeEntity(ns, tripleResult.triples);
              if (!entity) continue;
              if (opts.type && entity.type !== opts.type) continue;
              results.push(entity);
              if (results.length >= limit) break;
            }
          } catch (err) {
            console.error(`Query failed: ${String(err)}`);
            return;
          }

          if (results.length === 0) {
            console.log(`No code entities found for "${term}".`);
            return;
          }

          for (const r of results) {
            console.log(`[${r.type}] ${r.name} — ${r.path}:${r.line}`);
          }
        });
    });

    // ========================================================================
    // Service
    // ========================================================================

    api.registerService({
      id: "code-indexer",
      async start() {
        api.logger.info("code-indexer: service started");
      },
      async stop() {
        client.destroy();
        api.logger.info("code-indexer: service stopped");
      },
    });
  },
};

// ============================================================================
// Helpers
// ============================================================================

function parseCodeEntity(
  ns: string,
  triples: Array<{ subject: string; predicate: string; object: unknown }>,
): { subject: string; type: string; name: string; path: string; line: number } | null {
  if (triples.length === 0) return null;

  let type = "";
  let name = "";
  let path = "";
  let line = 0;
  const subject = triples[0].subject;

  for (const t of triples) {
    const pred = t.predicate;
    const obj = t.object;
    const val = typeof obj === "string" ? obj : typeof obj === "number" ? obj : String(obj);

    if (pred === codePredicate(ns, "type")) {
      type = String(val);
    } else if (pred === codePredicate(ns, "name")) {
      name = String(val);
    } else if (pred === codePredicate(ns, "path")) {
      path = String(val);
    } else if (pred === codePredicate(ns, "line")) {
      line = typeof val === "number" ? val : parseInt(String(val), 10) || 0;
    }
  }

  if (!type || !name) return null;
  return { subject, type, name, path, line };
}

export default codeIndexerPlugin;

/**
 * `mayros kg` — Built-in CLI for the knowledge graph.
 *
 * Provides unified access to all memory types: personal, project,
 * code, and session. Connects directly to AIngle Cortex.
 *
 * Subcommands:
 *   search       — Search across all memory types
 *   conventions  — List active project conventions
 *   decisions    — List architecture decisions
 *   code         — Show code knowledge for a file or symbol
 *   explore      — Show all triples for a subject
 *   stats        — Comprehensive statistics
 *   status       — Cortex connectivity + graph health
 *   explain      — Show provenance chain for a memory/convention
 */

import type { Command } from "commander";
import { parseCortexConfig } from "../../extensions/shared/cortex-config.js";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import { ProjectMemory } from "../../extensions/memory-semantic/project-memory.js";
import { codePredicate } from "../../extensions/code-indexer/rdf-mapper.js";
import { getIndexStats } from "../../extensions/code-indexer/incremental.js";
import { loadConfig } from "../config/config.js";

// ============================================================================
// Cortex resolution
// ============================================================================

function resolveCortexClient(opts: { host?: string; port?: string; token?: string }): CortexClient {
  const host = opts.host ?? process.env.CORTEX_HOST ?? "127.0.0.1";
  const port = opts.port
    ? Number.parseInt(opts.port, 10)
    : process.env.CORTEX_PORT
      ? Number.parseInt(process.env.CORTEX_PORT, 10)
      : 8080;
  const authToken = opts.token ?? process.env.CORTEX_AUTH_TOKEN ?? undefined;

  if (!opts.host && !opts.port && !process.env.CORTEX_HOST && !process.env.CORTEX_PORT) {
    try {
      const cfg = loadConfig();
      const pluginCfg = cfg.plugins?.entries?.["memory-semantic"]?.config as
        | { cortex?: { host?: string; port?: number; authToken?: string } }
        | undefined;
      if (pluginCfg?.cortex) {
        const cortex = parseCortexConfig(pluginCfg.cortex);
        return new CortexClient(cortex);
      }
    } catch {
      // Config not available — use defaults
    }
  }

  return new CortexClient(parseCortexConfig({ host, port, authToken }));
}

function resolveNamespace(): string {
  try {
    const cfg = loadConfig();
    const pluginCfg = cfg.plugins?.entries?.["memory-semantic"]?.config as
      | { agentNamespace?: string }
      | undefined;
    return pluginCfg?.agentNamespace ?? "mayros";
  } catch {
    return "mayros";
  }
}

// ============================================================================
// Registration
// ============================================================================

export function registerKgCli(program: Command) {
  const kg = program
    .command("kg")
    .description("Knowledge graph — search, explore, and query project memory")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 8080 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ------------------------------------------------------------------
  // mayros kg search <query>
  // ------------------------------------------------------------------
  kg.command("search")
    .description("Search across all memory types (personal + project + code)")
    .argument("<query>", "Search query")
    .option("--limit <n>", "Max results per type", "5")
    .action(async (query: string, opts: { limit?: string }) => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const pm = new ProjectMemory(client, ns);
      const limit = parseInt(opts.limit ?? "5", 10);

      try {
        // Search project conventions
        const conventions = await pm.queryConventions(query, { limit });
        if (conventions.length > 0) {
          console.log("Project Conventions:");
          for (const c of conventions) {
            console.log(`  [${c.category}] ${c.text}`);
          }
          console.log("");
        }

        // Search personal memories
        const memoryMatches = await client.patternQuery({
          predicate: `${ns}:memory:text`,
          limit: limit * 10,
        });

        const lower = query.toLowerCase();
        const memories: Array<{ text: string; category: string }> = [];
        for (const m of memoryMatches.matches) {
          const val = typeof m.object === "string" ? m.object : String(m.object);
          if (val.toLowerCase().includes(lower)) {
            // Get category
            const catTriples = await client.listTriples({ subject: m.subject, limit: 10 });
            let cat = "other";
            for (const t of catTriples.triples) {
              if (t.predicate.endsWith(":category")) {
                cat = typeof t.object === "string" ? t.object : String(t.object);
              }
            }
            memories.push({ text: val, category: cat });
            if (memories.length >= limit) break;
          }
        }

        if (memories.length > 0) {
          console.log("Personal Memories:");
          for (const m of memories) {
            console.log(`  [${m.category}] ${m.text}`);
          }
          console.log("");
        }

        // Search code entities
        const nameMatches = await client.patternQuery({
          predicate: codePredicate(ns, "name"),
          object: query,
          limit,
        });

        if (nameMatches.matches.length > 0) {
          console.log("Code Entities:");
          for (const m of nameMatches.matches) {
            const sub = m.subject;
            // Extract type from subject  {ns}:code:{type}:{path}#{name}
            const parts = sub.replace(`${ns}:code:`, "").split(":");
            const entityType = parts[0] ?? "unknown";
            console.log(`  [${entityType}] ${sub}`);
          }
          console.log("");
        }

        if (conventions.length === 0 && memories.length === 0 && nameMatches.matches.length === 0) {
          console.log(`No results found for "${query}".`);
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kg conventions [--cat <category>]
  // ------------------------------------------------------------------
  kg.command("conventions")
    .description("List active project conventions")
    .option(
      "--cat <category>",
      "Filter by category (naming, architecture, testing, security, style, tooling)",
    )
    .option("--limit <n>", "Max results", "20")
    .action(async (opts: { cat?: string; limit?: string }) => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const pm = new ProjectMemory(client, ns);
      const limit = parseInt(opts.limit ?? "20", 10);

      try {
        const conventions = await pm.listActive({
          category: opts.cat as
            | import("../../extensions/memory-semantic/project-memory.js").ConventionCategory
            | undefined,
          limit,
        });

        if (conventions.length === 0) {
          console.log("No active conventions found.");
          return;
        }

        console.log(`Active conventions (${conventions.length}):\n`);
        for (const c of conventions) {
          const date = c.createdAt.split("T")[0] ?? "";
          console.log(`  [${c.category}] ${c.text}`);
          console.log(`    source: ${c.source}, confidence: ${c.confidence}, date: ${date}`);
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kg decisions [--recent]
  // ------------------------------------------------------------------
  kg.command("decisions")
    .description("List architecture decisions")
    .option("--recent", "Show only recent decisions")
    .option("--limit <n>", "Max results", "20")
    .action(async (opts: { recent?: boolean; limit?: string }) => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const pm = new ProjectMemory(client, ns);
      const limit = parseInt(opts.limit ?? "20", 10);

      try {
        const decisions = await pm.listDecisions({ limit, recent: opts.recent });

        if (decisions.length === 0) {
          console.log("No architecture decisions found.");
          return;
        }

        console.log(`Decisions (${decisions.length}):\n`);
        for (const d of decisions) {
          const date = d.createdAt.split("T")[0] ?? "";
          console.log(`  ${d.text}`);
          console.log(`    category: ${d.category}, source: ${d.source}, date: ${date}`);
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kg code [path]
  // ------------------------------------------------------------------
  kg.command("code")
    .description("Show code knowledge for a file or symbol")
    .argument("[path]", "File path or symbol name to look up")
    .action(async (pathOrSymbol?: string) => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();

      try {
        if (!pathOrSymbol) {
          // Show overall code index stats
          const stats = await getIndexStats(client, ns);
          console.log("Code Index:");
          console.log(`  Files: ${stats.files}`);
          console.log(`  Functions: ${stats.functions}`);
          console.log(`  Classes: ${stats.classes}`);
          console.log(`  Imports: ${stats.imports}`);
          console.log(`  Last indexed: ${stats.lastIndexed ?? "never"}`);
          return;
        }

        // Try as file path
        const fileTriples = await client.listTriples({
          subject: `${ns}:code:file:${pathOrSymbol}`,
          limit: 50,
        });

        if (fileTriples.triples.length > 0) {
          console.log(`File: ${pathOrSymbol}\n`);
          for (const t of fileTriples.triples) {
            const pred = t.predicate.replace(`${ns}:code:`, "");
            const val =
              typeof t.object === "object" && t.object !== null && "node" in t.object
                ? t.object.node
                : String(t.object);
            console.log(`  ${pred}: ${val}`);
          }
          return;
        }

        // Try as symbol name
        const nameMatches = await client.patternQuery({
          predicate: codePredicate(ns, "name"),
          object: pathOrSymbol,
          limit: 10,
        });

        if (nameMatches.matches.length > 0) {
          console.log(`Symbol: ${pathOrSymbol}\n`);
          for (const m of nameMatches.matches) {
            const entityTriples = await client.listTriples({ subject: m.subject, limit: 10 });
            console.log(`  ${m.subject}:`);
            for (const t of entityTriples.triples) {
              const pred = t.predicate.replace(`${ns}:code:`, "");
              console.log(
                `    ${pred}: ${typeof t.object === "object" ? JSON.stringify(t.object) : t.object}`,
              );
            }
          }
        } else {
          console.log(`No code knowledge found for "${pathOrSymbol}".`);
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kg explore <subject>
  // ------------------------------------------------------------------
  kg.command("explore")
    .description("Show all triples for a subject (with linked entities)")
    .argument("<subject>", "Subject URI to explore")
    .option("--depth <n>", "Follow links to this depth", "1")
    .action(async (subject: string, opts: { depth?: string }) => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const depth = parseInt(opts.depth ?? "1", 10);

      // Auto-prefix with namespace if not already
      const fullSubject = subject.includes(":") ? subject : `${ns}:${subject}`;

      try {
        const visited = new Set<string>();
        await exploreSubject(client, fullSubject, 0, depth, visited);

        if (visited.size === 0) {
          console.log(`No triples found for "${fullSubject}".`);
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kg stats
  // ------------------------------------------------------------------
  kg.command("stats")
    .description("Comprehensive knowledge graph statistics")
    .action(async () => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const pm = new ProjectMemory(client, ns);

      try {
        const healthy = await client.isHealthy();
        if (!healthy) {
          console.log("Cortex: OFFLINE");
          return;
        }

        // Graph stats
        try {
          const graphStats = await client.stats();
          console.log("Graph:");
          console.log(`  Triples: ${graphStats.graph.triple_count}`);
          console.log(`  Subjects: ${graphStats.graph.subject_count}`);
          console.log(`  Predicates: ${graphStats.graph.predicate_count}`);
        } catch {
          console.log("Graph: stats unavailable");
        }

        console.log("");

        // Project memory stats
        const pmStats = await pm.stats();
        console.log("Project Memory:");
        console.log(`  Conventions: ${pmStats.conventions}`);
        console.log(`  Decisions: ${pmStats.decisions}`);
        console.log(`  Session findings: ${pmStats.findings}`);

        console.log("");

        // Code index stats
        const codeStats = await getIndexStats(client, ns);
        console.log("Code Index:");
        console.log(`  Files: ${codeStats.files}`);
        console.log(`  Functions: ${codeStats.functions}`);
        console.log(`  Classes: ${codeStats.classes}`);
        console.log(`  Imports: ${codeStats.imports}`);
        console.log(`  Last indexed: ${codeStats.lastIndexed ?? "never"}`);

        console.log("");

        // Personal memories count
        const memCount = await client.patternQuery({
          predicate: `${ns}:memory:text`,
          limit: 1,
        });
        console.log("Personal Memories:");
        console.log(`  Total: ${memCount.total}`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kg status
  // ------------------------------------------------------------------
  kg.command("status")
    .description("Check Cortex connectivity and graph health")
    .action(async () => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();

      try {
        console.log(`Cortex endpoint: ${client.baseUrl}`);
        console.log(`Namespace: ${ns}`);

        const healthy = await client.isHealthy();
        console.log(`Connection: ${healthy ? "ONLINE" : "OFFLINE"}`);

        if (healthy) {
          try {
            const stats = await client.stats();
            console.log(`Triples: ${stats.graph.triple_count}`);
            console.log(`Subjects: ${stats.graph.subject_count}`);
            console.log(`Uptime: ${stats.server.uptime_seconds}s`);
            console.log(`Version: ${stats.server.version}`);
          } catch {
            // Stats endpoint may not be available
          }
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros kg explain <id>
  // ------------------------------------------------------------------
  kg.command("explain")
    .description("Show provenance chain for a memory, convention, or decision")
    .argument("<id>", "Entity ID to explain")
    .action(async (id: string) => {
      const parent = kg.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const pm = new ProjectMemory(client, ns);

      try {
        // Try as project convention/decision
        const convention = await pm.getById(id);
        if (convention) {
          console.log(`Type: ${convention.supersedes ? "decision" : "convention"}`);
          console.log(`Text: ${convention.text}`);
          console.log(`Category: ${convention.category}`);
          console.log(`Source: ${convention.source}`);
          console.log(`Confidence: ${convention.confidence}`);
          console.log(`Status: ${convention.status}`);
          console.log(`Created: ${convention.createdAt}`);
          if (convention.context) {
            console.log(`Context: ${convention.context}`);
          }
          if (convention.supersedes) {
            console.log(`Supersedes: ${convention.supersedes}`);
            // Follow chain
            const prev = await pm.getById(convention.supersedes);
            if (prev) {
              console.log(`  Previous: ${prev.text} (${prev.status})`);
            }
          }
          return;
        }

        // Try as memory ID
        const memTriples = await client.listTriples({
          subject: `${ns}:memory:${id}`,
          limit: 20,
        });

        if (memTriples.triples.length > 0) {
          console.log(`Memory: ${id}\n`);
          for (const t of memTriples.triples) {
            const pred = t.predicate.replace(`${ns}:memory:`, "");
            const val =
              typeof t.object === "object" && t.object !== null && "node" in t.object
                ? t.object.node
                : String(t.object);
            console.log(`  ${pred}: ${val}`);
          }
          return;
        }

        console.log(`No entity found with ID "${id}".`);
      } finally {
        client.destroy();
      }
    });
}

// ============================================================================
// Helpers
// ============================================================================

async function exploreSubject(
  client: CortexClient,
  subject: string,
  currentDepth: number,
  maxDepth: number,
  visited: Set<string>,
): Promise<void> {
  if (visited.has(subject)) return;
  visited.add(subject);

  const result = await client.listTriples({ subject, limit: 50 });
  if (result.triples.length === 0) return;

  const indent = "  ".repeat(currentDepth);
  console.log(`${indent}${subject}:`);

  for (const t of result.triples) {
    const pred = t.predicate.split(":").slice(-1)[0] ?? t.predicate;
    const isNode = typeof t.object === "object" && t.object !== null && "node" in t.object;
    const val = isNode ? (t.object as { node: string }).node : String(t.object);

    console.log(`${indent}  ${pred}: ${val}`);

    // Follow linked nodes if within depth
    if (isNode && currentDepth < maxDepth) {
      await exploreSubject(
        client,
        (t.object as { node: string }).node,
        currentDepth + 1,
        maxDepth,
        visited,
      );
    }
  }
}

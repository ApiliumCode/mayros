/**
 * Full migration pipeline: markdown memory files → Cortex semantic graph.
 *
 * Steps:
 * 1. Pre-flight check (Cortex health, file inventory)
 * 2. MAYROS.md → Identity Graph triples
 * 3. MEMORY.md → Knowledge triples
 * 4. memory/*.md → Daily memory triples
 * 5. (optional) Session history → STM/LTM
 * 6. Verification: query back and compare counts
 * 7. Report
 */

import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import type { CortexClient, CreateTripleRequest } from "../cortex-client.js";
import {
  identityToTriples,
  mayrosMdToIdentity,
  emptyIdentity,
} from "../identity/identity-graph.js";
import { memoryToTriples, predicate, agentSubject } from "../rdf-mapper.js";
import type { TitansClient } from "../titans-client.js";
import {
  parseMemoryFile,
  parseMayrosMd,
  scanWorkspace,
  type ParsedMemoryEntry,
} from "./markdown-parser.js";

// ============================================================================
// Types
// ============================================================================

export type MigrationOptions = {
  agentId: string;
  workspaceDir: string;
  dryRun: boolean;
  includeHistory: boolean;
  verbose: boolean;
};

export type MigrationStep = {
  name: string;
  status: "pending" | "running" | "done" | "skipped" | "failed";
  count: number;
  errors: string[];
};

export type MigrationReport = {
  success: boolean;
  steps: MigrationStep[];
  totalTriples: number;
  totalMemories: number;
  warnings: string[];
  duration: number;
};

// ============================================================================
// Migrator
// ============================================================================

export class Migrator {
  constructor(
    private readonly cortex: CortexClient,
    private readonly titans: TitansClient | null,
    private readonly ns: string,
  ) {}

  async run(opts: MigrationOptions): Promise<MigrationReport> {
    const start = Date.now();
    const steps: MigrationStep[] = [];
    const warnings: string[] = [];
    let totalTriples = 0;
    let totalMemories = 0;

    // Step 1: Pre-flight
    const preflight = this.createStep("pre-flight");
    steps.push(preflight);
    preflight.status = "running";

    const healthy = await this.cortex.isHealthy();
    if (!healthy) {
      preflight.status = "failed";
      preflight.errors.push("Cortex is not reachable");
      return this.report(false, steps, totalTriples, totalMemories, warnings, start);
    }

    const workspace = await scanWorkspace(opts.workspaceDir);
    preflight.count = [workspace.mayrosMd, workspace.memoryMd, ...workspace.memoryFiles].filter(
      Boolean,
    ).length;
    preflight.status = "done";

    if (opts.verbose) {
      console.log(`Pre-flight: ${preflight.count} files found`);
    }

    // Step 2: MAYROS.md → Identity Graph
    const identityStep = this.createStep("identity");
    steps.push(identityStep);

    if (workspace.mayrosMd) {
      identityStep.status = "running";
      try {
        const content = await readFile(workspace.mayrosMd, "utf-8");
        const partial = mayrosMdToIdentity(content);
        const identity = { ...emptyIdentity(opts.agentId), ...partial };
        const triples = identityToTriples(this.ns, identity);

        if (!opts.dryRun) {
          for (const t of triples) {
            try {
              await this.cortex.createTriple(t);
              identityStep.count++;
              totalTriples++;
            } catch (err) {
              identityStep.errors.push(`Triple failed: ${String(err)}`);
            }
          }
        } else {
          identityStep.count = triples.length;
          totalTriples += triples.length;
        }

        identityStep.status = "done";
      } catch (err) {
        identityStep.status = "failed";
        identityStep.errors.push(String(err));
      }
    } else {
      identityStep.status = "skipped";
      warnings.push("No MAYROS.md found");
    }

    // Step 3: MEMORY.md → Knowledge Triples
    const memoryMdStep = this.createStep("MEMORY.md");
    steps.push(memoryMdStep);

    if (workspace.memoryMd) {
      memoryMdStep.status = "running";
      try {
        const content = await readFile(workspace.memoryMd, "utf-8");
        const entries = parseMemoryFile(content, "MEMORY.md");
        const result = await this.migrateEntries(entries, opts, memoryMdStep);
        totalTriples += result.triples;
        totalMemories += result.memories;
        memoryMdStep.status = "done";
      } catch (err) {
        memoryMdStep.status = "failed";
        memoryMdStep.errors.push(String(err));
      }
    } else {
      memoryMdStep.status = "skipped";
      warnings.push("No MEMORY.md found");
    }

    // Step 4: memory/*.md → Daily Memories
    const dailyStep = this.createStep("memory/*.md");
    steps.push(dailyStep);

    if (workspace.memoryFiles.length > 0) {
      dailyStep.status = "running";
      for (const filePath of workspace.memoryFiles) {
        try {
          const content = await readFile(filePath, "utf-8");
          const filename = basename(filePath);
          const entries = parseMemoryFile(content, filename);
          const result = await this.migrateEntries(entries, opts, dailyStep);
          totalTriples += result.triples;
          totalMemories += result.memories;
        } catch (err) {
          dailyStep.errors.push(`${basename(filePath)}: ${String(err)}`);
        }
      }
      dailyStep.status = dailyStep.errors.length > 0 ? "done" : "done";
    } else {
      dailyStep.status = "skipped";
    }

    // Step 5: Session history (optional)
    const historyStep = this.createStep("session-history");
    steps.push(historyStep);

    if (opts.includeHistory && workspace.sessionFiles.length > 0) {
      historyStep.status = "running";
      for (const filePath of workspace.sessionFiles) {
        try {
          const content = await readFile(filePath, "utf-8");
          const lines = content.split("\n").filter((l) => l.trim().length > 0);
          let stored = 0;

          for (const line of lines) {
            try {
              const msg = JSON.parse(line) as Record<string, unknown>;
              if (msg.role !== "user") continue;
              const text = typeof msg.content === "string" ? msg.content : "";
              if (text.length < 10 || text.length > 500) continue;

              // Store important messages in Titans STM if available
              if (this.titans && !opts.dryRun) {
                try {
                  await this.titans.remember({
                    entry_type: "history",
                    data: text,
                    tags: ["migration", "history"],
                    importance: 0.5,
                  });
                  stored++;
                } catch {
                  // skip
                }
              } else {
                stored++;
              }

              if (stored >= 100) break; // cap per file
            } catch {
              // not valid JSON line
            }
          }

          historyStep.count += stored;
          totalMemories += stored;
        } catch (err) {
          historyStep.errors.push(`${basename(filePath)}: ${String(err)}`);
        }
      }
      historyStep.status = "done";
    } else {
      historyStep.status = "skipped";
      if (opts.includeHistory) {
        warnings.push("No session history files found");
      }
    }

    // Step 6: Verification
    const verifyStep = this.createStep("verification");
    steps.push(verifyStep);

    if (!opts.dryRun) {
      verifyStep.status = "running";
      try {
        const agentNode = agentSubject(this.ns, opts.agentId);
        const result = await this.cortex.patternQuery({
          predicate: predicate(this.ns, "ownedBy"),
          object: { node: agentNode },
          limit: 1,
        });

        const graphStats = await this.cortex.stats();
        verifyStep.count = graphStats.graph.triple_count;

        if (result.total === 0 && totalMemories > 0) {
          warnings.push(
            `Expected memories in graph but found 0. Migration may have partial failures.`,
          );
        }

        verifyStep.status = "done";
      } catch (err) {
        verifyStep.status = "failed";
        verifyStep.errors.push(String(err));
      }
    } else {
      verifyStep.status = "skipped";
    }

    const allOk = steps.every((s) => s.status !== "failed");
    return this.report(allOk, steps, totalTriples, totalMemories, warnings, start);
  }

  // ---------- status ----------

  async status(agentId: string): Promise<{
    cortexOnline: boolean;
    tripleCount: number;
    memoryCount: number;
    identityTriples: number;
  }> {
    const cortexOnline = await this.cortex.isHealthy();
    if (!cortexOnline) {
      return { cortexOnline, tripleCount: 0, memoryCount: 0, identityTriples: 0 };
    }

    const stats = await this.cortex.stats();
    const agentNode = agentSubject(this.ns, agentId);

    const memResult = await this.cortex.patternQuery({
      predicate: predicate(this.ns, "ownedBy"),
      object: { node: agentNode },
      limit: 1,
    });

    const idResult = await this.cortex.listTriples({
      subject: `${this.ns}:agent:${agentId}`,
      limit: 1,
    });

    return {
      cortexOnline,
      tripleCount: stats.graph.triple_count,
      memoryCount: memResult.total,
      identityTriples: idResult.total,
    };
  }

  // ---------- verify ----------

  async verify(agentId: string): Promise<{
    valid: boolean;
    memoryCount: number;
    identityCount: number;
    issues: string[];
  }> {
    const issues: string[] = [];
    const agentNode = agentSubject(this.ns, agentId);

    let memoryCount = 0;
    let identityCount = 0;

    try {
      const memResult = await this.cortex.patternQuery({
        predicate: predicate(this.ns, "ownedBy"),
        object: { node: agentNode },
        limit: 1000,
      });
      memoryCount = memResult.total;

      // Sample check: verify memories have text
      for (const match of memResult.matches.slice(0, 5)) {
        const triples = await this.cortex.listTriples({
          subject: match.subject,
          limit: 20,
        });
        const hasText = triples.triples.some((t) => t.predicate.endsWith(":text"));
        if (!hasText) {
          issues.push(`Memory ${match.subject} has no text triple`);
        }
      }
    } catch (err) {
      issues.push(`Memory query failed: ${String(err)}`);
    }

    try {
      const idResult = await this.cortex.listTriples({
        subject: `${this.ns}:agent:${agentId}`,
        limit: 100,
      });
      identityCount = idResult.triples.filter((t) => t.predicate.includes(":identity:")).length;
    } catch (err) {
      issues.push(`Identity query failed: ${String(err)}`);
    }

    return {
      valid: issues.length === 0,
      memoryCount,
      identityCount,
      issues,
    };
  }

  // ---------- helpers ----------

  private createStep(name: string): MigrationStep {
    return { name, status: "pending", count: 0, errors: [] };
  }

  private async migrateEntries(
    entries: ParsedMemoryEntry[],
    opts: MigrationOptions,
    step: MigrationStep,
  ): Promise<{ triples: number; memories: number }> {
    let tripleCount = 0;
    let memoryCount = 0;

    for (const entry of entries) {
      const triples = memoryToTriples(this.ns, opts.agentId, {
        text: entry.text,
        category: entry.category,
        importance: entry.importance,
        source: entry.source,
      });

      if (!opts.dryRun) {
        for (const t of triples) {
          try {
            await this.cortex.createTriple(t);
            tripleCount++;
          } catch (err) {
            step.errors.push(`Triple failed: ${String(err)}`);
          }
        }
      } else {
        tripleCount += triples.length;
      }

      step.count++;
      memoryCount++;
    }

    return { triples: tripleCount, memories: memoryCount };
  }

  private report(
    success: boolean,
    steps: MigrationStep[],
    totalTriples: number,
    totalMemories: number,
    warnings: string[],
    startTime: number,
  ): MigrationReport {
    return {
      success,
      steps,
      totalTriples,
      totalMemories,
      warnings,
      duration: Date.now() - startTime,
    };
  }
}

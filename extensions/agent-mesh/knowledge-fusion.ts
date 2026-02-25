/**
 * Knowledge Fusion
 *
 * Merges, detects conflicts, and synthesizes knowledge across
 * multiple namespaces in the agent mesh.
 */

import type { CortexClient, TripleDto, ValueDto } from "../shared/cortex-client.js";
import type {
  Conflict,
  FusionReport,
  MergeStrategy,
  ConflictResolution,
  SynthesisResult,
} from "./mesh-protocol.js";

// ============================================================================
// Knowledge Fusion
// ============================================================================

export class KnowledgeFusion {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  // ---------- helpers ----------

  private objectToString(obj: ValueDto): string {
    if (typeof obj === "object" && obj !== null && "node" in obj) {
      return obj.node;
    }
    return String(obj);
  }

  // ---------- Namespace triple queries ----------

  private async getNamespaceTriples(namespace: string): Promise<TripleDto[]> {
    // Get all memory subjects owned by this namespace
    const result = await this.client.patternQuery({
      predicate: `${this.ns}:memory:ownedBy`,
      object: { node: namespace },
      limit: 500,
    });

    const allTriples: TripleDto[] = [];

    for (const match of result.matches) {
      const tripleResult = await this.client.listTriples({
        subject: match.subject,
        limit: 20,
      });
      allTriples.push(...tripleResult.triples);
    }

    return allTriples;
  }

  // ---------- Public API ----------

  /**
   * Merge knowledge from sourceNs into targetNs using the specified strategy.
   *
   * Strategies:
   * - "additive": only add triples that don't exist in target
   * - "replace": overwrite target triples with source values when subjects match
   * - "conflict-flag": add new triples but flag conflicts instead of resolving them
   * - "newest-wins": on conflict, keep the triple with the most recent timestamp; fallback to source
   * - "majority-wins": when merging 3+ namespaces, keep the most common value (requires additionalNs)
   */
  async merge(
    sourceNs: string,
    targetNs: string,
    strategy: MergeStrategy,
    additionalNs?: string[],
  ): Promise<FusionReport> {
    const sourceTriples = await this.getNamespaceTriples(sourceNs);
    const targetTriples = await this.getNamespaceTriples(targetNs);

    // Build a lookup of target triples by (subject, predicate)
    const targetIndex = new Map<string, TripleDto[]>();
    for (const t of targetTriples) {
      const key = `${t.subject}||${t.predicate}`;
      if (!targetIndex.has(key)) {
        targetIndex.set(key, []);
      }
      targetIndex.get(key)!.push(t);
    }

    let added = 0;
    let skipped = 0;
    let conflicts = 0;
    const details: string[] = [];

    for (const sourceTriple of sourceTriples) {
      // Skip ownership triples — they'll be re-owned
      if (sourceTriple.predicate === `${this.ns}:memory:ownedBy`) continue;

      const key = `${sourceTriple.subject}||${sourceTriple.predicate}`;
      const existing = targetIndex.get(key);

      if (!existing || existing.length === 0) {
        // No conflict: add the triple
        await this.client.createTriple({
          subject: sourceTriple.subject,
          predicate: sourceTriple.predicate,
          object: sourceTriple.object,
        });
        added++;
        continue;
      }

      // There is an existing triple with the same subject and predicate
      const sourceVal = this.objectToString(sourceTriple.object);
      const existingVal = this.objectToString(existing[0].object);

      if (sourceVal === existingVal) {
        skipped++;
        continue;
      }

      // Conflict detected
      const resolutions: ConflictResolution[] = [];

      switch (strategy) {
        case "additive":
          // Skip conflicting triples
          skipped++;
          details.push(
            `Skipped conflict: ${sourceTriple.subject} ${sourceTriple.predicate} (source: "${sourceVal}", target: "${existingVal}")`,
          );
          break;

        case "replace":
          // Delete existing and add source
          for (const e of existing) {
            if (e.id) {
              await this.client.deleteTriple(e.id);
            }
          }
          await this.client.createTriple({
            subject: sourceTriple.subject,
            predicate: sourceTriple.predicate,
            object: sourceTriple.object,
          });
          added++;
          details.push(
            `Replaced: ${sourceTriple.subject} ${sourceTriple.predicate} ("${existingVal}" -> "${sourceVal}")`,
          );
          break;

        case "conflict-flag":
          // Add with a conflict marker
          await this.client.createTriple({
            subject: sourceTriple.subject,
            predicate: `${this.ns}:conflict:${sourceTriple.predicate.split(":").pop()}`,
            object: sourceTriple.object,
          });
          conflicts++;
          details.push(
            `Flagged conflict: ${sourceTriple.subject} ${sourceTriple.predicate} (values: "${existingVal}" vs "${sourceVal}")`,
          );
          break;

        case "newest-wins": {
          // Compare timestamps if available, fallback to source-wins
          const sourceTs = this.extractTimestamp(sourceTriple);
          const existingTs = this.extractTimestamp(existing[0]);
          const winner = sourceTs >= existingTs ? sourceVal : existingVal;
          const loser = winner === sourceVal ? existingVal : sourceVal;

          if (winner === sourceVal) {
            for (const e of existing) {
              if (e.id) {
                await this.client.deleteTriple(e.id);
              }
            }
            await this.client.createTriple({
              subject: sourceTriple.subject,
              predicate: sourceTriple.predicate,
              object: sourceTriple.object,
            });
            added++;
          } else {
            skipped++;
          }

          resolutions.push({
            subject: sourceTriple.subject,
            predicate: sourceTriple.predicate,
            resolvedValue: winner,
            strategy: "newest-wins",
            discardedValues: [loser],
          });
          details.push(
            `Resolved (newest-wins): ${sourceTriple.subject} ${sourceTriple.predicate} -> "${winner}" (discarded: "${loser}")`,
          );
          break;
        }

        case "majority-wins": {
          // Collect values from all namespaces
          const allValues: string[] = [existingVal, sourceVal];
          if (additionalNs) {
            for (const extra of additionalNs) {
              const extraTriples = await this.getNamespaceTriples(extra);
              for (const et of extraTriples) {
                if (
                  et.subject === sourceTriple.subject &&
                  et.predicate === sourceTriple.predicate
                ) {
                  allValues.push(this.objectToString(et.object));
                }
              }
            }
          }

          // Count occurrences
          const counts = new Map<string, number>();
          for (const v of allValues) {
            counts.set(v, (counts.get(v) ?? 0) + 1);
          }

          // Find the most common value
          let winner = existingVal;
          let maxCount = 0;
          for (const [val, count] of counts) {
            if (count > maxCount) {
              maxCount = count;
              winner = val;
            }
          }

          const discarded = [...new Set(allValues.filter((v) => v !== winner))];

          if (winner !== existingVal) {
            for (const e of existing) {
              if (e.id) {
                await this.client.deleteTriple(e.id);
              }
            }
            await this.client.createTriple({
              subject: sourceTriple.subject,
              predicate: sourceTriple.predicate,
              object: winner,
            });
            added++;
          } else {
            skipped++;
          }

          resolutions.push({
            subject: sourceTriple.subject,
            predicate: sourceTriple.predicate,
            resolvedValue: winner,
            strategy: "majority-wins",
            discardedValues: discarded,
          });
          details.push(
            `Resolved (majority-wins): ${sourceTriple.subject} ${sourceTriple.predicate} -> "${winner}" (${maxCount}/${allValues.length} votes)`,
          );
          break;
        }
      }
    }

    return {
      added,
      skipped,
      conflicts,
      details,
      strategy,
      sourceNs,
      targetNs,
    };
  }

  /**
   * Extract a numeric timestamp from a triple's metadata (id-based heuristic).
   * Returns 0 if no timestamp can be inferred.
   */
  private extractTimestamp(triple: TripleDto): number {
    // Cortex triple IDs may embed a timestamp; otherwise fallback to 0
    if (triple.id) {
      const parts = triple.id.split("-");
      const last = parts[parts.length - 1];
      const ts = Number(last);
      if (!isNaN(ts) && ts > 1_000_000_000) return ts;
    }
    return 0;
  }

  /**
   * Resolve previously-flagged conflicts in a target namespace.
   * Scans for `{ns}:conflict:*` predicates, applies the given strategy, and cleans up markers.
   */
  async resolveConflicts(
    targetNs: string,
    resolutionStrategy: "newest-wins" | "majority-wins" | "source-wins" = "source-wins",
  ): Promise<ConflictResolution[]> {
    const allTriples = await this.getNamespaceTriples(targetNs);
    const conflictPrefix = `${this.ns}:conflict:`;
    const resolutions: ConflictResolution[] = [];

    // Find conflict-flagged triples
    const conflictTriples = allTriples.filter((t) => t.predicate.startsWith(conflictPrefix));
    if (conflictTriples.length === 0) return resolutions;

    for (const ct of conflictTriples) {
      const originalPredSuffix = ct.predicate.slice(conflictPrefix.length);
      // Find the original triple with matching subject
      const originalPred = allTriples.find(
        (t) =>
          t.subject === ct.subject &&
          t.predicate.endsWith(`:${originalPredSuffix}`) &&
          !t.predicate.startsWith(conflictPrefix),
      );

      const conflictVal = this.objectToString(ct.object);
      const originalVal = originalPred ? this.objectToString(originalPred.object) : undefined;

      let winner: string;
      let discarded: string[];

      if (!originalVal) {
        // No original found — accept the conflict value
        winner = conflictVal;
        discarded = [];
      } else if (resolutionStrategy === "source-wins") {
        winner = conflictVal;
        discarded = [originalVal];
      } else if (resolutionStrategy === "newest-wins") {
        const ctTs = this.extractTimestamp(ct);
        const origTs = originalPred ? this.extractTimestamp(originalPred) : 0;
        winner = ctTs >= origTs ? conflictVal : originalVal;
        discarded = [winner === conflictVal ? originalVal : conflictVal];
      } else {
        // majority-wins with only 2 values defaults to original-wins (existing)
        winner = originalVal;
        discarded = [conflictVal];
      }

      // Apply resolution: replace original if winner differs
      if (originalPred && winner !== originalVal) {
        if (originalPred.id) {
          await this.client.deleteTriple(originalPred.id);
        }
        await this.client.createTriple({
          subject: ct.subject,
          predicate: originalPred.predicate,
          object: winner,
        });
      }

      // Remove conflict marker
      if (ct.id) {
        await this.client.deleteTriple(ct.id);
      }

      resolutions.push({
        subject: ct.subject,
        predicate: ct.predicate,
        resolvedValue: winner,
        strategy: resolutionStrategy,
        discardedValues: discarded,
      });
    }

    return resolutions;
  }

  /**
   * Detect conflicting facts between two namespaces.
   * A conflict exists when the same (subject, predicate) has different object values.
   */
  async detectConflicts(ns1: string, ns2: string): Promise<Conflict[]> {
    const triples1 = await this.getNamespaceTriples(ns1);
    const triples2 = await this.getNamespaceTriples(ns2);

    // Build index of ns1 triples by (subject, predicate) excluding ownership
    const index1 = new Map<string, string[]>();
    for (const t of triples1) {
      if (t.predicate === `${this.ns}:memory:ownedBy`) continue;
      const key = `${t.subject}||${t.predicate}`;
      if (!index1.has(key)) index1.set(key, []);
      index1.get(key)!.push(this.objectToString(t.object));
    }

    const conflicts: Conflict[] = [];
    const seen = new Set<string>();

    for (const t of triples2) {
      if (t.predicate === `${this.ns}:memory:ownedBy`) continue;
      const key = `${t.subject}||${t.predicate}`;

      if (seen.has(key)) continue;
      const ns1Values = index1.get(key);
      if (!ns1Values) continue;

      const ns2Value = this.objectToString(t.object);

      // Check if values differ
      const allSame = ns1Values.every((v) => v === ns2Value);
      if (!allSame) {
        const allValues = [...new Set([...ns1Values, ns2Value])];
        conflicts.push({
          subject: t.subject,
          predicate: t.predicate,
          values: allValues,
          namespaces: [ns1, ns2],
        });
        seen.add(key);
      }
    }

    return conflicts;
  }

  /**
   * Synthesize knowledge from multiple namespaces into a summary.
   * Collects all triples, extracts key facts, and produces a human-readable summary.
   */
  async synthesize(namespaces: string[]): Promise<SynthesisResult> {
    const allTriples: TripleDto[] = [];
    const nsSet = new Set<string>();

    for (const namespace of namespaces) {
      nsSet.add(namespace);
      const triples = await this.getNamespaceTriples(namespace);
      allTriples.push(...triples);
    }

    // Extract key facts — triples with text content
    const keyFacts: string[] = [];
    const factPredicates = [`${this.ns}:memory:text`, `${this.ns}:memory:category`];

    const textTriples = allTriples.filter((t) => factPredicates.includes(t.predicate));

    // Group by subject to reconstruct facts
    const bySubject = new Map<string, Map<string, string>>();
    for (const t of textTriples) {
      if (!bySubject.has(t.subject)) {
        bySubject.set(t.subject, new Map());
      }
      bySubject.get(t.subject)!.set(t.predicate, this.objectToString(t.object));
    }

    for (const [_subject, predicates] of bySubject) {
      const text = predicates.get(`${this.ns}:memory:text`);
      const category = predicates.get(`${this.ns}:memory:category`) ?? "other";
      if (text) {
        keyFacts.push(`[${category}] ${text}`);
      }
    }

    // Build summary
    const uniqueSubjects = new Set(allTriples.map((t) => t.subject));
    const summaryParts: string[] = [
      `Synthesized ${allTriples.length} triples across ${namespaces.length} namespace(s).`,
      `${uniqueSubjects.size} unique subjects found.`,
      `${keyFacts.length} key facts extracted.`,
    ];

    return {
      totalTriples: allTriples.length,
      namespaces: [...nsSet],
      summary: summaryParts.join(" "),
      keyFacts: keyFacts.slice(0, 50),
    };
  }
}

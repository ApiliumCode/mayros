/**
 * Delegation Engine
 *
 * Manages task delegation between parent and child agents in the mesh.
 * Prepares context from the parent's knowledge graph, injects it into
 * child sessions, and merges results back after completion.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import type { DelegationContext, MergeReport, Triple } from "./mesh-protocol.js";
import type { NamespaceManager } from "./namespace-manager.js";

// ============================================================================
// Delegation Engine
// ============================================================================

export class DelegationEngine {
  private readonly injectedContexts: Map<string, string> = new Map();

  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    private readonly nsMgr: NamespaceManager,
  ) {}

  // ---------- helpers ----------

  private tripleToSimple(t: { subject: string; predicate: string; object: unknown }): Triple {
    const obj = t.object;
    let objectStr: string;
    if (typeof obj === "object" && obj !== null && "node" in (obj as Record<string, unknown>)) {
      objectStr = (obj as { node: string }).node;
    } else {
      objectStr = String(obj);
    }
    return { subject: t.subject, predicate: t.predicate, object: objectStr };
  }

  // ---------- Public API ----------

  /**
   * Prepare a delegation context for a child agent.
   * Queries the parent agent's namespace for triples relevant to the task
   * and assembles them as context for the child.
   */
  async prepareContext(task: string, parentAgentId: string): Promise<DelegationContext> {
    const parentNs = this.nsMgr.getPrivateNs(parentAgentId);

    // Query triples owned by the parent agent
    const result = await this.client.patternQuery({
      predicate: `${this.ns}:memory:ownedBy`,
      object: { node: parentNs },
      limit: 50,
    });

    // For each matching memory subject, fetch its triples in batches of 5
    const relevantTriples: Triple[] = [];
    const relatedMemories: string[] = [];
    const taskLower = task.toLowerCase();
    const taskWords = taskLower.split(/\s+/).filter((w) => w.length > 2);
    const CONTEXT_BATCH_SIZE = 5;

    for (let i = 0; i < result.matches.length; i += CONTEXT_BATCH_SIZE) {
      if (relevantTriples.length >= 100) break;

      const batch = result.matches.slice(i, i + CONTEXT_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((match) => this.client.listTriples({ subject: match.subject, limit: 20 })),
      );

      for (let j = 0; j < batch.length; j++) {
        if (relevantTriples.length >= 100) break;

        const memSubject = batch[j].subject;
        const tripleResult = batchResults[j];

        // Check relevance: does any triple's text contain task keywords?
        let isRelevant = false;
        for (const t of tripleResult.triples) {
          const objStr = String(
            typeof t.object === "object" && t.object !== null && "node" in t.object
              ? t.object.node
              : t.object,
          ).toLowerCase();

          for (const word of taskWords) {
            if (objStr.includes(word)) {
              isRelevant = true;
              break;
            }
          }
          if (isRelevant) break;
        }

        if (isRelevant) {
          for (const t of tripleResult.triples) {
            relevantTriples.push(this.tripleToSimple(t));
          }
          // Extract memory ID from subject: {ns}:memory:{uuid}
          const memPrefix = `${this.ns}:memory:`;
          if (memSubject.startsWith(memPrefix)) {
            relatedMemories.push(memSubject.slice(memPrefix.length));
          }
        }
      }
    }

    return {
      task,
      parentAgentId,
      relevantTriples,
      relatedMemories,
      namespace: parentNs,
      timestamp: Date.now(),
    };
  }

  /**
   * Inject delegation context into a child session.
   * Formats the context as a string prefix that can be prepended to the
   * child's system prompt or first message.
   */
  injectContext(childSessionKey: string, ctx: DelegationContext): void {
    const lines: string[] = [
      `<delegation-context>`,
      `Task: ${ctx.task}`,
      `Parent Agent: ${ctx.parentAgentId}`,
      `Namespace: ${ctx.namespace}`,
      `Timestamp: ${new Date(ctx.timestamp).toISOString()}`,
      ``,
      `Relevant Knowledge (${ctx.relevantTriples.length} triples):`,
    ];

    for (const t of ctx.relevantTriples.slice(0, 50)) {
      lines.push(`  ${t.subject} ${t.predicate} ${JSON.stringify(t.object)}`);
    }

    if (ctx.relatedMemories.length > 0) {
      lines.push(``);
      lines.push(`Related Memory IDs: ${ctx.relatedMemories.join(", ")}`);
    }

    lines.push(`</delegation-context>`);

    const contextString = lines.join("\n");
    this.injectedContexts.set(childSessionKey, contextString);
  }

  /**
   * Get the injected context string for a child session key.
   */
  getInjectedContext(childSessionKey: string): string | undefined {
    return this.injectedContexts.get(childSessionKey);
  }

  /**
   * Remove injected context for a child session that has ended.
   * Prevents memory leaks from accumulated delegation contexts.
   */
  removeInjectedContext(childSessionKey: string): void {
    this.injectedContexts.delete(childSessionKey);
  }

  /**
   * Merge results from a child agent's namespace back into the parent's namespace.
   * Copies new triples from the child run into the parent's knowledge graph,
   * skipping duplicates.
   */
  async mergeResults(
    runId: string,
    parentAgentId: string,
    childAgentId: string,
  ): Promise<MergeReport> {
    const parentNs = this.nsMgr.getPrivateNs(parentAgentId);
    const childNs = this.nsMgr.getPrivateNs(childAgentId);

    // Query child's triples
    const childResult = await this.client.patternQuery({
      predicate: `${this.ns}:memory:ownedBy`,
      object: { node: childNs },
      limit: 200,
    });

    // Query parent's existing triples for deduplication
    const parentResult = await this.client.patternQuery({
      predicate: `${this.ns}:memory:ownedBy`,
      object: { node: parentNs },
      limit: 500,
    });

    const parentSubjects = parentResult.matches.map((m) => m.subject);

    // Pre-fetch all parent text values to avoid N+1 queries during dedup
    const parentTextSet = new Set<string>();
    const BATCH_SIZE = 5;
    for (let i = 0; i < parentSubjects.length; i += BATCH_SIZE) {
      const batch = parentSubjects.slice(i, i + BATCH_SIZE);
      const results = await Promise.all(
        batch.map((subj) => this.client.listTriples({ subject: subj, limit: 20 })),
      );
      for (const result of results) {
        for (const t of result.triples) {
          if (t.predicate === `${this.ns}:memory:text`) {
            parentTextSet.add(String(t.object));
          }
        }
      }
    }

    let added = 0;
    let skipped = 0;
    let conflicts = 0;
    const details: string[] = [];

    for (const childMatch of childResult.matches) {
      const childSubject = childMatch.subject;

      // Fetch child memory triples
      const childTriples = await this.client.listTriples({
        subject: childSubject,
        limit: 20,
      });

      // Find the text triple for dedup
      let textValue = "";
      for (const t of childTriples.triples) {
        if (t.predicate === `${this.ns}:memory:text`) {
          textValue = String(t.object);
          break;
        }
      }

      // Check if parent already has the same text (simple dedup)
      const isDuplicate = parentTextSet.has(textValue);

      if (isDuplicate) {
        skipped++;
        details.push(`Skipped duplicate: "${textValue.slice(0, 60)}..."`);
        continue;
      }

      // Copy child triples with updated ownership to parent namespace
      for (const t of childTriples.triples) {
        if (t.predicate === `${this.ns}:memory:ownedBy`) {
          // Re-own to parent
          await this.client.createTriple({
            subject: t.subject,
            predicate: t.predicate,
            object: { node: parentNs },
          });
        } else {
          // Copy as-is
          await this.client.createTriple({
            subject: t.subject,
            predicate: t.predicate,
            object: t.object,
          });
        }
      }

      // Add merge provenance
      await this.client.createTriple({
        subject: childSubject,
        predicate: `${this.ns}:memory:mergedFrom`,
        object: `run:${runId}:child:${childAgentId}`,
      });

      added++;
      details.push(`Merged: "${textValue.slice(0, 60)}..."`);
    }

    return { added, skipped, conflicts, details };
  }
}

/**
 * CI Cortex Registry.
 *
 * Stores CI pipeline run results as RDF triples in AIngle Cortex
 * for queryability and historical tracking.
 *
 * Triple namespace:
 *   Subject: ${ns}:ci:run:${provider}:${runId}
 *   Predicates:
 *     ${ns}:ci:repo       → repository name
 *     ${ns}:ci:branch     → branch name
 *     ${ns}:ci:status     → queued|running|success|failure|cancelled
 *     ${ns}:ci:url        → run URL
 *     ${ns}:ci:startedAt  → ISO timestamp
 *     ${ns}:ci:completedAt → ISO timestamp
 *     ${ns}:ci:provider   → github|gitlab
 */

import type { CortexClientLike } from "../shared/cortex-client.js";
import type { CiPipelineRun } from "./providers/types.js";

// ============================================================================
// Helpers
// ============================================================================

function runSubject(ns: string, provider: string, runId: string): string {
  return `${ns}:ci:run:${provider}:${runId}`;
}

function ciPred(ns: string, field: string): string {
  return `${ns}:ci:${field}`;
}

// ============================================================================
// CiCortexRegistry
// ============================================================================

export class CiCortexRegistry {
  constructor(
    private readonly cortex: CortexClientLike,
    private readonly ns: string,
  ) {}

  /**
   * Record or update a CI pipeline run in Cortex.
   */
  async recordRun(run: CiPipelineRun): Promise<void> {
    const subject = runSubject(this.ns, run.provider, run.id);

    const fields: Array<[string, string]> = [
      ["repo", run.repo],
      ["branch", run.branch],
      ["status", run.status],
      ["url", run.url],
      ["provider", run.provider],
    ];

    if (run.startedAt) fields.push(["startedAt", run.startedAt]);
    if (run.completedAt) fields.push(["completedAt", run.completedAt]);

    for (const [field, value] of fields) {
      await this.updateField(subject, ciPred(this.ns, field), value);
    }
  }

  /**
   * Get recent CI runs from Cortex, optionally filtered.
   */
  async getRecentRuns(opts?: {
    provider?: string;
    repo?: string;
    limit?: number;
  }): Promise<CiPipelineRun[]> {
    const limit = opts?.limit ?? 20;

    // Query runs by status predicate (all runs have a status)
    const result = await this.cortex.patternQuery({
      predicate: ciPred(this.ns, "status"),
      limit: limit * 2, // over-fetch since we filter later
    });

    const prefix = `${this.ns}:ci:run:`;
    const runs: CiPipelineRun[] = [];

    for (const match of result.matches) {
      const sub = String(match.subject);
      if (!sub.startsWith(prefix)) continue;

      const fields = await this.getFields(sub, [
        "repo",
        "branch",
        "status",
        "url",
        "startedAt",
        "completedAt",
        "provider",
      ]);

      if (opts?.provider && fields.provider !== opts.provider) continue;
      if (opts?.repo && fields.repo !== opts.repo) continue;

      const parts = sub.slice(prefix.length);
      const firstColon = parts.indexOf(":");
      const provider = firstColon > 0 ? parts.slice(0, firstColon) : "unknown";
      const runId = firstColon > 0 ? parts.slice(firstColon + 1) : parts;

      runs.push({
        id: runId,
        provider: provider as "github" | "gitlab",
        repo: fields.repo ?? "",
        branch: fields.branch ?? "",
        status: (fields.status as CiPipelineRun["status"]) ?? "queued",
        url: fields.url ?? "",
        startedAt: fields.startedAt,
        completedAt: fields.completedAt,
      });
    }

    // Sort by startedAt descending
    runs.sort((a, b) => {
      const aTime = a.startedAt ? new Date(a.startedAt).getTime() : 0;
      const bTime = b.startedAt ? new Date(b.startedAt).getTime() : 0;
      return bTime - aTime;
    });

    return runs.slice(0, limit);
  }

  /**
   * Get CI runs filtered by repository.
   */
  async getRunsByRepo(repo: string): Promise<CiPipelineRun[]> {
    return this.getRecentRuns({ repo });
  }

  // ---------- internal helpers ----------

  private async updateField(subject: string, predicate: string, value: string): Promise<void> {
    const existing = await this.cortex.listTriples({
      subject,
      predicate,
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.cortex.deleteTriple(t.id);
    }

    await this.cortex.createTriple({ subject, predicate, object: value });
  }

  private async getFields(subject: string, fields: string[]): Promise<Record<string, string>> {
    const result: Record<string, string> = {};

    for (const field of fields) {
      const triples = await this.cortex.listTriples({
        subject,
        predicate: ciPred(this.ns, field),
        limit: 1,
      });
      if (triples.triples.length > 0) {
        const val = triples.triples[0].object;
        result[field] =
          typeof val === "object" && val !== null && "node" in val
            ? String((val as { node: string }).node)
            : String(val);
      }
    }

    return result;
  }
}

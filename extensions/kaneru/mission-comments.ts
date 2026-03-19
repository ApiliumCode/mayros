/**
 * Mission Comment Service
 *
 * Comments on missions stored as Cortex RDF triples. Enables discussion
 * threads on missions — agents report findings, operators provide feedback,
 * and decisions are recorded inline. Queryable by any agent, DAG-auditable.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets, sanitizeTripleValue } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type MissionComment = {
  id: string;
  missionId: string;
  author: string;
  content: string;
  createdAt: string;
};

// ============================================================================
// Helpers
// ============================================================================

function commentSubject(ns: string, id: string): string {
  return `${ns}:comment:${id}`;
}

function commentPredicate(ns: string, field: string): string {
  return `${ns}:comment:${field}`;
}

// ============================================================================
// MissionCommentService
// ============================================================================

export class MissionCommentService {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Add a comment to a mission. */
  async add(missionId: string, author: string, content: string): Promise<MissionComment> {
    if (!missionId.trim()) throw new Error("Mission ID is required");
    if (!author.trim()) throw new Error("Author is required");
    if (!content.trim()) throw new Error("Comment content is required");

    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = commentSubject(this.ns, id);

    const fields: Array<[string, string]> = [
      ["missionId", missionId],
      ["author", sanitizeTripleValue(author)],
      ["content", sanitizeTripleValue(content)],
      ["createdAt", now],
    ];

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: commentPredicate(this.ns, field),
        object: value,
      });
    }

    return { id, missionId, author, content, createdAt: now };
  }

  /** List comments for a mission, ordered by creation time. */
  async list(missionId: string, limit = 50): Promise<MissionComment[]> {
    const result = await this.client.patternQuery({
      predicate: commentPredicate(this.ns, "missionId"),
      object: missionId,
      limit,
    });

    const comments: MissionComment[] = [];
    const prefix = `${this.ns}:comment:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const comment = await this.get(id);
      if (comment) comments.push(comment);
    }

    return comments.sort((a, b) =>
      new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }

  /** Count comments on a mission. */
  async count(missionId: string): Promise<number> {
    const result = await this.client.patternQuery({
      predicate: commentPredicate(this.ns, "missionId"),
      object: missionId,
      limit: 500,
    });
    return result.matches.length;
  }

  /** Get a single comment by ID. */
  private async get(id: string): Promise<MissionComment | null> {
    const subject = commentSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 10 });

    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const prefix = `${this.ns}:comment:`;

    for (const t of result.triples) {
      const pred = stripBrackets(String(t.predicate));
      if (pred.startsWith(prefix)) {
        fields[pred.slice(prefix.length)] = String(t.object);
      }
    }

    return {
      id,
      missionId: fields.missionId ?? "",
      author: fields.author ?? "",
      content: fields.content ?? "",
      createdAt: fields.createdAt ?? "",
    };
  }
}

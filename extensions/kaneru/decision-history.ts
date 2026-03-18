/**
 * Decision History
 *
 * Persists consensus decisions as Cortex triples with full reasoning:
 * question, votes, strategy, outcome, participants, and confidence.
 *
 * Every decision is queryable — "Why did we block v2.1?" becomes a
 * triple query. Not possible with stateless architectures where decisions
 * are lost in ticket comments.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets, sanitizeTripleValue } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type DecisionRecord = {
  id: string;
  question: string;
  strategy: string;
  resolvedValue: string;
  confidence: number;
  participants: string[];
  votes: Record<string, number>;
  ventureId: string | null;
  missionId: string | null;
  decidedAt: string;
};

export type DecisionContext = {
  ventureId?: string;
  missionId?: string;
};

export type ConsensusResultLike = {
  id: string;
  resolved: boolean;
  strategy: string;
  confidence: number;
  resolutions: Array<{
    subject: string;
    resolvedValue: string;
    votes: Record<string, number>;
  }>;
};

// ============================================================================
// Helpers
// ============================================================================

function decisionSubject(ns: string, id: string): string {
  return `${ns}:decision:${id}`;
}

function decisionPredicate(ns: string, field: string): string {
  return `${ns}:decision:${field}`;
}

function parseDecisionTriples(
  ns: string,
  decisionId: string,
  triples: Array<{ predicate: string; object: unknown }>,
): DecisionRecord | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:decision:`;

  for (const t of triples) {
    const pred = stripBrackets(String(t.predicate));
    if (pred.startsWith(prefix)) {
      fields[pred.slice(prefix.length)] = String(t.object);
    }
  }

  if (!fields.question) return null;

  let votes: Record<string, number> = {};
  if (fields.votes) {
    try { votes = JSON.parse(fields.votes) as Record<string, number>; } catch { /* ignore */ }
  }

  let participants: string[] = [];
  if (fields.participants) {
    participants = fields.participants.split(",").map((s) => s.trim()).filter(Boolean);
  }

  return {
    id: decisionId,
    question: fields.question,
    strategy: fields.strategy ?? "unknown",
    resolvedValue: fields.resolvedValue ?? "",
    confidence: parseFloat(fields.confidence ?? "0"),
    participants,
    votes,
    ventureId: fields.ventureId ?? null,
    missionId: fields.missionId ?? null,
    decidedAt: fields.decidedAt ?? "",
  };
}

// ============================================================================
// DecisionHistory
// ============================================================================

export class DecisionHistory {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Record a consensus result as a decision. */
  async record(result: ConsensusResultLike, context?: DecisionContext): Promise<DecisionRecord> {
    const id = randomUUID().slice(0, 12);
    const now = new Date().toISOString();
    const subject = decisionSubject(this.ns, id);

    // Extract question and votes from first resolution
    const firstRes = result.resolutions[0];
    const question = firstRes?.subject ?? result.id;
    const resolvedValue = firstRes?.resolvedValue ?? (result.resolved ? "resolved" : "unresolved");
    const votes = firstRes?.votes ?? {};

    // Collect all participants from vote keys
    const participants = [...new Set(Object.keys(votes))];

    const fields: Array<[string, string | number]> = [
      ["question", sanitizeTripleValue(question)],
      ["strategy", result.strategy],
      ["resolvedValue", resolvedValue],
      ["confidence", Math.round(result.confidence * 1000) / 1000],
      ["participants", participants.join(",")],
      ["votes", JSON.stringify(votes)],
      ["decidedAt", now],
    ];

    if (context?.ventureId) fields.push(["ventureId", context.ventureId]);
    if (context?.missionId) fields.push(["missionId", context.missionId]);

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: decisionPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      question,
      strategy: result.strategy,
      resolvedValue,
      confidence: Math.round(result.confidence * 1000) / 1000,
      participants,
      votes,
      ventureId: context?.ventureId ?? null,
      missionId: context?.missionId ?? null,
      decidedAt: now,
    };
  }

  /** Get a decision by ID. */
  async get(id: string): Promise<DecisionRecord | null> {
    const subject = decisionSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 30 });
    return parseDecisionTriples(this.ns, id, result.triples);
  }

  /** Query decisions with optional filters. */
  async query(opts?: {
    ventureId?: string;
    limit?: number;
  }): Promise<DecisionRecord[]> {
    // Query all decisions by finding subjects with the "question" predicate
    const result = await this.client.patternQuery({
      predicate: decisionPredicate(this.ns, "question"),
      limit: opts?.limit ?? 100,
    });

    const decisions: DecisionRecord[] = [];
    const prefix = `${this.ns}:decision:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);

      const decision = await this.get(id);
      if (!decision) continue;

      // Apply filters
      if (opts?.ventureId && decision.ventureId !== opts.ventureId) continue;

      decisions.push(decision);
    }

    // Sort by decidedAt descending (most recent first)
    return decisions.sort((a, b) =>
      new Date(b.decidedAt).getTime() - new Date(a.decidedAt).getTime(),
    );
  }

  /** Generate a human-readable explanation of a decision. */
  async explain(id: string): Promise<string> {
    const decision = await this.get(id);
    if (!decision) return `Decision not found: ${id}`;

    const lines: string[] = [
      `Decision: ${decision.id}`,
      `Question: ${decision.question}`,
      `Strategy: ${decision.strategy}`,
      `Outcome: ${decision.resolvedValue}`,
      `Confidence: ${(decision.confidence * 100).toFixed(1)}%`,
      `Decided at: ${decision.decidedAt}`,
    ];

    if (decision.participants.length > 0) {
      lines.push(`Participants: ${decision.participants.join(", ")}`);
    }

    if (Object.keys(decision.votes).length > 0) {
      lines.push(`Votes:`);
      for (const [voter, weight] of Object.entries(decision.votes)) {
        lines.push(`  ${voter}: ${weight}`);
      }
    }

    if (decision.ventureId) lines.push(`Venture: ${decision.ventureId}`);
    if (decision.missionId) lines.push(`Mission: ${decision.missionId}`);

    return lines.join("\n");
  }
}

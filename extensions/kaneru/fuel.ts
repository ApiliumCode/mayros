/**
 * Fuel Controller
 *
 * Tracks fuel consumption (token costs) per venture, agent, and mission.
 * All fuel events are stored as Cortex RDF triples — no denormalized
 * counters, no monthly reset needed. Spend is computed on-the-fly from
 * event history using temporal queries.
 *
 * Fuel is tracked in integer cents to avoid floating-point drift.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets, sanitizeTripleValue } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type FuelEvent = {
  id: string;
  ventureId: string;
  agentId: string;
  missionId: string | null;
  runId: string | null;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  provider: string;
  model: string;
  occurredAt: string;
};

export type FuelEventCreateOpts = {
  ventureId: string;
  agentId: string;
  missionId?: string;
  runId?: string;
  costCents: number;
  inputTokens?: number;
  outputTokens?: number;
  provider: string;
  model: string;
};

export type FuelSummary = {
  ventureId: string;
  totalCents: number;
  fuelLimit: number;
  remaining: number;
  burnRate: number;
  byAgent: Array<{ agentId: string; totalCents: number }>;
  byMission: Array<{ missionId: string; totalCents: number }>;
};

export type FuelLimitCheck = {
  exceeded: boolean;
  remaining: number;
  totalSpent: number;
  limit: number;
};

// ============================================================================
// Helpers
// ============================================================================

function fuelSubject(ns: string, id: string): string {
  return `${ns}:fuel:${id}`;
}

function fuelPredicate(ns: string, field: string): string {
  return `${ns}:fuel:${field}`;
}

function parseFuelTriples(
  ns: string,
  eventId: string,
  triples: Array<{ predicate: string; object: unknown }>,
): FuelEvent | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:fuel:`;

  for (const t of triples) {
    const pred = stripBrackets(String(t.predicate));
    if (pred.startsWith(prefix)) {
      const field = pred.slice(prefix.length);
      const val =
        typeof t.object === "object" && t.object !== null && "node" in (t.object as Record<string, unknown>)
          ? stripBrackets(String((t.object as { node: string }).node))
          : String(t.object);
      fields[field] = val;
    }
  }

  if (!fields.ventureId && !fields.agentId) return null;

  return {
    id: eventId,
    ventureId: fields.ventureId ?? "",
    agentId: fields.agentId ?? "",
    missionId: fields.missionId ?? null,
    runId: fields.runId ?? null,
    costCents: parseInt(fields.costCents ?? "0", 10),
    inputTokens: parseInt(fields.inputTokens ?? "0", 10),
    outputTokens: parseInt(fields.outputTokens ?? "0", 10),
    provider: fields.provider ?? "",
    model: fields.model ?? "",
    occurredAt: fields.occurredAt ?? "",
  };
}

// ============================================================================
// FuelController
// ============================================================================

export class FuelController {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Record a fuel consumption event. */
  async record(opts: FuelEventCreateOpts): Promise<FuelEvent> {
    if (opts.costCents < 0) throw new Error("Cost cannot be negative");
    if (!opts.ventureId.trim()) throw new Error("Venture ID is required");
    if (!opts.agentId.trim()) throw new Error("Agent ID is required");

    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = fuelSubject(this.ns, id);

    const fields: Array<[string, string | number]> = [
      ["ventureId", opts.ventureId],
      ["agentId", opts.agentId],
      ["costCents", opts.costCents],
      ["inputTokens", opts.inputTokens ?? 0],
      ["outputTokens", opts.outputTokens ?? 0],
      ["provider", sanitizeTripleValue(opts.provider)],
      ["model", sanitizeTripleValue(opts.model)],
      ["occurredAt", now],
    ];

    if (opts.missionId) fields.push(["missionId", opts.missionId]);
    if (opts.runId) fields.push(["runId", opts.runId]);

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: fuelPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      ventureId: opts.ventureId,
      agentId: opts.agentId,
      missionId: opts.missionId ?? null,
      runId: opts.runId ?? null,
      costCents: opts.costCents,
      inputTokens: opts.inputTokens ?? 0,
      outputTokens: opts.outputTokens ?? 0,
      provider: opts.provider,
      model: opts.model,
      occurredAt: now,
    };
  }

  /** Get fuel summary for a venture. */
  async summary(ventureId: string, fuelLimit?: number): Promise<FuelSummary> {
    const events = await this.ventureEvents(ventureId);

    let totalCents = 0;
    const agentTotals = new Map<string, number>();
    const missionTotals = new Map<string, number>();

    for (const e of events) {
      totalCents += e.costCents;
      agentTotals.set(e.agentId, (agentTotals.get(e.agentId) ?? 0) + e.costCents);
      if (e.missionId) {
        missionTotals.set(e.missionId, (missionTotals.get(e.missionId) ?? 0) + e.costCents);
      }
    }

    // Compute burn rate (cents per hour) from event history
    let burnRate = 0;
    if (events.length >= 2) {
      const sorted = [...events].sort(
        (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
      );
      const first = new Date(sorted[0].occurredAt).getTime();
      const last = new Date(sorted[sorted.length - 1].occurredAt).getTime();
      const hours = (last - first) / (1000 * 60 * 60);
      if (hours > 0) burnRate = Math.round(totalCents / hours);
    }

    const limit = fuelLimit ?? 0;

    return {
      ventureId,
      totalCents,
      fuelLimit: limit,
      remaining: Math.max(0, limit - totalCents),
      burnRate,
      byAgent: [...agentTotals.entries()]
        .map(([agentId, total]) => ({ agentId, totalCents: total }))
        .sort((a, b) => b.totalCents - a.totalCents),
      byMission: [...missionTotals.entries()]
        .map(([missionId, total]) => ({ missionId, totalCents: total }))
        .sort((a, b) => b.totalCents - a.totalCents),
    };
  }

  /** Get total spend for an agent. */
  async agentSpend(agentId: string): Promise<number> {
    const events = await this.agentEvents(agentId);
    return events.reduce((sum, e) => sum + e.costCents, 0);
  }

  /** Check if venture fuel limit is exceeded. */
  async checkLimit(ventureId: string, fuelLimit: number): Promise<FuelLimitCheck> {
    const events = await this.ventureEvents(ventureId);
    const totalSpent = events.reduce((sum, e) => sum + e.costCents, 0);

    return {
      exceeded: fuelLimit > 0 && totalSpent >= fuelLimit,
      remaining: Math.max(0, fuelLimit - totalSpent),
      totalSpent,
      limit: fuelLimit,
    };
  }

  /** Check if agent fuel limit is exceeded within a venture context. */
  async checkAgentLimit(
    agentId: string,
    agentFuelLimit: number,
  ): Promise<FuelLimitCheck> {
    const totalSpent = await this.agentSpend(agentId);

    return {
      exceeded: agentFuelLimit > 0 && totalSpent >= agentFuelLimit,
      remaining: Math.max(0, agentFuelLimit - totalSpent),
      totalSpent,
      limit: agentFuelLimit,
    };
  }

  // ---------- Event queries ----------

  /** Get all fuel events for a venture. */
  private async ventureEvents(ventureId: string): Promise<FuelEvent[]> {
    const result = await this.client.patternQuery({
      predicate: fuelPredicate(this.ns, "ventureId"),
      object: ventureId,
      limit: 5000,
    });

    const events: FuelEvent[] = [];
    const prefix = `${this.ns}:fuel:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const event = await this.getEvent(id);
      if (event) events.push(event);
    }

    return events;
  }

  /** Get all fuel events for an agent. */
  private async agentEvents(agentId: string): Promise<FuelEvent[]> {
    const result = await this.client.patternQuery({
      predicate: fuelPredicate(this.ns, "agentId"),
      object: agentId,
      limit: 5000,
    });

    const events: FuelEvent[] = [];
    const prefix = `${this.ns}:fuel:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const event = await this.getEvent(id);
      if (event) events.push(event);
    }

    return events;
  }

  /** Get a fuel event by ID. */
  private async getEvent(id: string): Promise<FuelEvent | null> {
    const subject = fuelSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 30 });
    return parseFuelTriples(this.ns, id, result.triples);
  }
}

/**
 * Cost Analytics Service
 *
 * Advanced cost analytics: time-series trends, provider breakdown,
 * efficiency metrics, and burn rate forecasting.
 *
 * Builds on FuelController's event-sourced data to provide dashboardable
 * analytics with semantic query-powered insights.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets } from "../shared/rdf-utils.js";
import type { FuelEvent } from "./fuel.js";

// ============================================================================
// Types
// ============================================================================

export type TimeSeriesPoint = {
  date: string;
  costCents: number;
  eventCount: number;
};

export type CostTimeSeries = {
  period: "daily" | "weekly" | "monthly";
  points: TimeSeriesPoint[];
};

export type CostByProvider = Array<{
  provider: string;
  model: string;
  costCents: number;
  inputTokens: number;
  outputTokens: number;
  eventCount: number;
}>;

export type CostForecast = {
  projectedMonthlyCents: number;
  burnRateCentsPerHour: number;
  daysUntilExhausted: number | null;
  confidence: "low" | "medium" | "high";
};

export type CostEfficiency = {
  costPerMissionCents: number;
  avgCostPerEventCents: number;
  totalInputTokens: number;
  totalOutputTokens: number;
};

export type CostAnalytics = {
  ventureId: string;
  totalCents: number;
  fuelLimit: number;
  timeSeries: CostTimeSeries;
  byProvider: CostByProvider;
  byAgent: Array<{ agentId: string; costCents: number; eventCount: number }>;
  byProject: Array<{ projectId: string; costCents: number }>;
  forecast: CostForecast;
  efficiency: CostEfficiency;
};

// ============================================================================
// Helpers
// ============================================================================

function fuelPredicate(ns: string, field: string): string {
  return `${ns}:fuel:${field}`;
}

function dateKey(date: string, period: "daily" | "weekly" | "monthly"): string {
  const d = new Date(date);
  if (period === "daily") return d.toISOString().slice(0, 10);
  if (period === "weekly") {
    // ISO week: get Monday of the week
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }
  return d.toISOString().slice(0, 7); // monthly: YYYY-MM
}

// ============================================================================
// CostAnalyticsService
// ============================================================================

export class CostAnalyticsService {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Full cost analytics for a venture. */
  async analyze(
    ventureId: string,
    opts?: { period?: "daily" | "weekly" | "monthly"; fuelLimit?: number },
  ): Promise<CostAnalytics> {
    const events = await this.loadEvents(ventureId);
    const period = opts?.period ?? "daily";
    const fuelLimit = opts?.fuelLimit ?? 0;

    const totalCents = events.reduce((sum, e) => sum + e.costCents, 0);

    return {
      ventureId,
      totalCents,
      fuelLimit,
      timeSeries: this.buildTimeSeries(events, period),
      byProvider: this.buildByProvider(events),
      byAgent: this.buildByAgent(events),
      byProject: this.buildByProject(events),
      forecast: this.buildForecast(events, fuelLimit),
      efficiency: this.buildEfficiency(events),
    };
  }

  /** Time-series breakdown. */
  timeSeries(events: FuelEvent[], period: "daily" | "weekly" | "monthly"): CostTimeSeries {
    return this.buildTimeSeries(events, period);
  }

  /** Provider/model breakdown. */
  byProvider(events: FuelEvent[]): CostByProvider {
    return this.buildByProvider(events);
  }

  /** Burn rate forecast. */
  forecast(events: FuelEvent[], fuelLimit: number): CostForecast {
    return this.buildForecast(events, fuelLimit);
  }

  // ---------- Builders ----------

  private buildTimeSeries(events: FuelEvent[], period: "daily" | "weekly" | "monthly"): CostTimeSeries {
    const buckets = new Map<string, { costCents: number; eventCount: number }>();

    for (const e of events) {
      const key = dateKey(e.occurredAt, period);
      const bucket = buckets.get(key) ?? { costCents: 0, eventCount: 0 };
      bucket.costCents += e.costCents;
      bucket.eventCount += 1;
      buckets.set(key, bucket);
    }

    const points: TimeSeriesPoint[] = [...buckets.entries()]
      .map(([date, data]) => ({ date, ...data }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return { period, points };
  }

  private buildByProvider(events: FuelEvent[]): CostByProvider {
    const map = new Map<string, { provider: string; model: string; costCents: number; inputTokens: number; outputTokens: number; eventCount: number }>();

    for (const e of events) {
      const key = `${e.provider}:${e.model}`;
      const entry = map.get(key) ?? { provider: e.provider, model: e.model, costCents: 0, inputTokens: 0, outputTokens: 0, eventCount: 0 };
      entry.costCents += e.costCents;
      entry.inputTokens += e.inputTokens;
      entry.outputTokens += e.outputTokens;
      entry.eventCount += 1;
      map.set(key, entry);
    }

    return [...map.values()].sort((a, b) => b.costCents - a.costCents);
  }

  private buildByAgent(events: FuelEvent[]): Array<{ agentId: string; costCents: number; eventCount: number }> {
    const map = new Map<string, { costCents: number; eventCount: number }>();

    for (const e of events) {
      const entry = map.get(e.agentId) ?? { costCents: 0, eventCount: 0 };
      entry.costCents += e.costCents;
      entry.eventCount += 1;
      map.set(e.agentId, entry);
    }

    return [...map.entries()]
      .map(([agentId, data]) => ({ agentId, ...data }))
      .sort((a, b) => b.costCents - a.costCents);
  }

  private buildByProject(events: FuelEvent[]): Array<{ projectId: string; costCents: number }> {
    const map = new Map<string, number>();

    for (const e of events) {
      if (!e.missionId) continue; // Only events linked to missions count toward projects
      // Group by missionId as proxy — actual project mapping requires mission→project lookup
      const key = e.missionId;
      map.set(key, (map.get(key) ?? 0) + e.costCents);
    }

    return [...map.entries()]
      .map(([projectId, costCents]) => ({ projectId, costCents }))
      .sort((a, b) => b.costCents - a.costCents);
  }

  private buildForecast(events: FuelEvent[], fuelLimit: number): CostForecast {
    if (events.length < 2) {
      return { projectedMonthlyCents: 0, burnRateCentsPerHour: 0, daysUntilExhausted: null, confidence: "low" };
    }

    const sorted = [...events].sort(
      (a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime(),
    );

    const firstTs = new Date(sorted[0].occurredAt).getTime();
    const lastTs = new Date(sorted[sorted.length - 1].occurredAt).getTime();
    const totalCents = sorted.reduce((sum, e) => sum + e.costCents, 0);

    const hours = (lastTs - firstTs) / (1000 * 60 * 60);
    if (hours <= 0) {
      return { projectedMonthlyCents: 0, burnRateCentsPerHour: 0, daysUntilExhausted: null, confidence: "low" };
    }

    const burnRate = totalCents / hours;
    const projectedMonthly = Math.round(burnRate * 24 * 30);

    let daysUntilExhausted: number | null = null;
    if (fuelLimit > 0) {
      const remaining = Math.max(0, fuelLimit - totalCents);
      daysUntilExhausted = burnRate > 0 ? Math.round(remaining / (burnRate * 24)) : null;
    }

    // Confidence based on data volume
    const confidence = events.length > 100 ? "high" : events.length > 20 ? "medium" : "low";

    return { projectedMonthlyCents: projectedMonthly, burnRateCentsPerHour: Math.round(burnRate), daysUntilExhausted, confidence };
  }

  private buildEfficiency(events: FuelEvent[]): CostEfficiency {
    const totalCents = events.reduce((sum, e) => sum + e.costCents, 0);
    const missionIds = new Set(events.filter((e) => e.missionId).map((e) => e.missionId));
    const totalInput = events.reduce((sum, e) => sum + e.inputTokens, 0);
    const totalOutput = events.reduce((sum, e) => sum + e.outputTokens, 0);

    return {
      costPerMissionCents: missionIds.size > 0 ? Math.round(totalCents / missionIds.size) : 0,
      avgCostPerEventCents: events.length > 0 ? Math.round(totalCents / events.length) : 0,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
    };
  }

  // ---------- Data loading ----------

  private async loadEvents(ventureId: string): Promise<FuelEvent[]> {
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
      const event = await this.loadEvent(id);
      if (event) events.push(event);
    }

    return events;
  }

  private async loadEvent(id: string): Promise<FuelEvent | null> {
    const subject = `${this.ns}:fuel:${id}`;
    const result = await this.client.listTriples({ subject, limit: 30 });

    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const prefix = `${this.ns}:fuel:`;

    for (const t of result.triples) {
      const pred = stripBrackets(String(t.predicate));
      if (pred.startsWith(prefix)) {
        fields[pred.slice(prefix.length)] = String(t.object);
      }
    }

    return {
      id,
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
}

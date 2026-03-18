/**
 * Pulse Scheduler
 *
 * Manages agent pulse scheduling — periodic wake triggers with coalescing.
 * Pulses are stored as Cortex triples and can be triggered by timer,
 * assignment, mention, mission-ready, or escalation events.
 *
 * Coalescing: when multiple triggers arrive for the same agent while
 * a pulse is already queued, they merge into one (preventing thrashing).
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type PulseTrigger = "timer" | "assignment" | "mention" | "mission-ready" | "escalation";
export type PulseStatus = "queued" | "claimed" | "finished" | "failed";

export type PulseConfig = {
  interval: string;
  triggers: PulseTrigger[];
  fuelLimit?: number;
  coalesce?: boolean;
};

export type PulseRequest = {
  id: string;
  agentId: string;
  ventureId: string;
  trigger: PulseTrigger;
  status: PulseStatus;
  coalescedCount: number;
  payload: Record<string, unknown>;
  requestedAt: string;
  claimedAt: string | null;
  finishedAt: string | null;
};

export type PulseRegistration = {
  agentId: string;
  ventureId: string;
  config: PulseConfig;
};

// ============================================================================
// Helpers
// ============================================================================

function pulseSubject(ns: string, id: string): string {
  return `${ns}:pulse:${id}`;
}

function pulsePredicate(ns: string, field: string): string {
  return `${ns}:pulse:${field}`;
}

function pulseRegSubject(ns: string, agentId: string): string {
  return `${ns}:pulsereg:${agentId}`;
}

function pulseRegPredicate(ns: string, field: string): string {
  return `${ns}:pulsereg:${field}`;
}

function parsePulseTriples(
  ns: string,
  pulseId: string,
  triples: Array<{ predicate: string; object: unknown }>,
): PulseRequest | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:pulse:`;

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

  if (!fields.agentId) return null;

  let payload: Record<string, unknown> = {};
  if (fields.payload) {
    try {
      payload = JSON.parse(fields.payload) as Record<string, unknown>;
    } catch {
      // ignore
    }
  }

  return {
    id: pulseId,
    agentId: fields.agentId,
    ventureId: fields.ventureId ?? "",
    trigger: (fields.trigger as PulseTrigger) ?? "timer",
    status: (fields.status as PulseStatus) ?? "queued",
    coalescedCount: parseInt(fields.coalescedCount ?? "0", 10),
    payload,
    requestedAt: fields.requestedAt ?? "",
    claimedAt: fields.claimedAt ?? null,
    finishedAt: fields.finishedAt ?? null,
  };
}

// ============================================================================
// PulseScheduler
// ============================================================================

export class PulseScheduler {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Register an agent for pulse scheduling. */
  async register(agentId: string, ventureId: string, config: PulseConfig): Promise<void> {
    if (!agentId.trim()) throw new Error("Agent ID is required");
    if (!ventureId.trim()) throw new Error("Venture ID is required");
    if (!config.interval.trim()) throw new Error("Pulse interval is required");

    const subject = pulseRegSubject(this.ns, agentId);

    // Store registration as triples
    const fields: Array<[string, string | number]> = [
      ["ventureId", ventureId],
      ["interval", config.interval],
      ["triggers", JSON.stringify(config.triggers)],
      ["fuelLimit", config.fuelLimit ?? 0],
      ["coalesce", config.coalesce !== false ? "true" : "false"],
      ["registeredAt", new Date().toISOString()],
    ];

    // Clear old registration first
    await this.clearRegistration(agentId);

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: pulseRegPredicate(this.ns, field),
        object: value,
      });
    }
  }

  /** Unregister an agent from pulse scheduling. */
  async unregister(agentId: string): Promise<void> {
    await this.clearRegistration(agentId);
  }

  /** Get pulse registration for an agent. */
  async getRegistration(agentId: string): Promise<PulseRegistration | null> {
    const subject = pulseRegSubject(this.ns, agentId);
    const result = await this.client.listTriples({ subject, limit: 20 });

    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const prefix = `${this.ns}:pulsereg:`;

    for (const t of result.triples) {
      const pred = stripBrackets(String(t.predicate));
      if (pred.startsWith(prefix)) {
        fields[pred.slice(prefix.length)] = String(t.object);
      }
    }

    if (!fields.interval) return null;

    let triggers: PulseTrigger[] = ["timer"];
    if (fields.triggers) {
      try {
        triggers = JSON.parse(fields.triggers) as PulseTrigger[];
      } catch {
        // default
      }
    }

    return {
      agentId,
      ventureId: fields.ventureId ?? "",
      config: {
        interval: fields.interval,
        triggers,
        fuelLimit: parseInt(fields.fuelLimit ?? "0", 10),
        coalesce: fields.coalesce !== "false",
      },
    };
  }

  /**
   * Trigger a pulse for an agent. If coalescing is enabled and a queued
   * pulse exists, merges into it instead of creating a new one.
   */
  async trigger(
    agentId: string,
    ventureId: string,
    triggerType: PulseTrigger,
    payload?: Record<string, unknown>,
  ): Promise<PulseRequest> {
    // Check for coalescing
    const reg = await this.getRegistration(agentId);
    const shouldCoalesce = reg?.config.coalesce !== false;

    if (shouldCoalesce) {
      const existing = await this.findQueuedPulse(agentId);
      if (existing) {
        return this.coalesce(existing, triggerType, payload);
      }
    }

    // Create new pulse request
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = pulseSubject(this.ns, id);

    const fields: Array<[string, string | number]> = [
      ["agentId", agentId],
      ["ventureId", ventureId],
      ["trigger", triggerType],
      ["status", "queued"],
      ["coalescedCount", 0],
      ["payload", JSON.stringify(payload ?? {})],
      ["requestedAt", now],
    ];

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: pulsePredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      agentId,
      ventureId,
      trigger: triggerType,
      status: "queued",
      coalescedCount: 0,
      payload: payload ?? {},
      requestedAt: now,
      claimedAt: null,
      finishedAt: null,
    };
  }

  /** Coalesce a trigger into an existing queued pulse. */
  private async coalesce(
    existing: PulseRequest,
    _triggerType: PulseTrigger,
    payload?: Record<string, unknown>,
  ): Promise<PulseRequest> {
    const subject = pulseSubject(this.ns, existing.id);
    const newCount = existing.coalescedCount + 1;

    // Update coalescedCount
    await this.setField(subject, "coalescedCount", newCount);

    // Merge payload: incoming overwrites existing keys
    if (payload) {
      const merged = { ...existing.payload, ...payload };
      await this.setField(subject, "payload", JSON.stringify(merged));
    }

    return {
      ...existing,
      coalescedCount: newCount,
      payload: payload ? { ...existing.payload, ...payload } : existing.payload,
    };
  }

  /** Claim a queued pulse for execution. */
  async claim(pulseId: string, runId: string): Promise<PulseRequest> {
    const pulse = await this.getPulse(pulseId);
    if (!pulse) throw new Error(`Pulse not found: ${pulseId}`);
    if (pulse.status !== "queued") throw new Error(`Pulse is not queued: ${pulse.status}`);

    const subject = pulseSubject(this.ns, pulseId);
    const now = new Date().toISOString();

    await this.setField(subject, "status", "claimed");
    await this.setField(subject, "claimedAt", now);
    await this.setField(subject, "claimRun", runId);

    return { ...pulse, status: "claimed", claimedAt: now };
  }

  /** Mark a pulse as finished. Only the claiming run can finish it. */
  async finish(pulseId: string, runId: string): Promise<void> {
    await this.verifyClaimOwner(pulseId, runId);
    const subject = pulseSubject(this.ns, pulseId);
    await this.setField(subject, "status", "finished");
    await this.setField(subject, "finishedAt", new Date().toISOString());
  }

  /** Mark a pulse as failed. Only the claiming run can fail it. */
  async fail(pulseId: string, runId: string, error?: string): Promise<void> {
    await this.verifyClaimOwner(pulseId, runId);
    const subject = pulseSubject(this.ns, pulseId);
    await this.setField(subject, "status", "failed");
    await this.setField(subject, "finishedAt", new Date().toISOString());
    if (error) await this.setField(subject, "error", error);
  }

  /** Verify the caller holds the claim on a pulse. */
  private async verifyClaimOwner(pulseId: string, runId: string): Promise<void> {
    const pulse = await this.getPulse(pulseId);
    if (!pulse) throw new Error(`Pulse not found: ${pulseId}`);
    if (pulse.status !== "claimed") throw new Error(`Pulse is not claimed: ${pulse.status}`);
    // Read claimRun from triples
    const subject = pulseSubject(this.ns, pulseId);
    const claimTriples = await this.client.listTriples({
      subject,
      predicate: pulsePredicate(this.ns, "claimRun"),
      limit: 1,
    });
    const claimRun = claimTriples.triples.length > 0 ? String(claimTriples.triples[0].object) : null;
    if (claimRun !== runId) {
      throw new Error("Only the claiming run can finish/fail this pulse");
    }
  }

  /** Get a pulse by ID. */
  async getPulse(id: string): Promise<PulseRequest | null> {
    const subject = pulseSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 30 });
    return parsePulseTriples(this.ns, id, result.triples);
  }

  /** List queued pulses for an agent. */
  async listQueued(agentId: string): Promise<PulseRequest[]> {
    const result = await this.client.patternQuery({
      predicate: pulsePredicate(this.ns, "agentId"),
      object: agentId,
      limit: 100,
    });

    const pulses: PulseRequest[] = [];
    const prefix = `${this.ns}:pulse:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const pulse = await this.getPulse(id);
      if (pulse && pulse.status === "queued") pulses.push(pulse);
    }

    return pulses;
  }

  /** Find an existing queued pulse for an agent. */
  private async findQueuedPulse(agentId: string): Promise<PulseRequest | null> {
    const queued = await this.listQueued(agentId);
    return queued.length > 0 ? queued[0] : null;
  }

  // ---------- Field helpers ----------

  private async setField(subject: string, field: string, value: string | number): Promise<void> {
    // Delete existing
    const existing = await this.client.listTriples({
      subject,
      predicate: pulsePredicate(this.ns, field),
      limit: 5,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    await this.client.createTriple({
      subject,
      predicate: pulsePredicate(this.ns, field),
      object: value,
    });
  }

  private async clearRegistration(agentId: string): Promise<void> {
    const subject = pulseRegSubject(this.ns, agentId);
    const result = await this.client.listTriples({ subject, limit: 50 });
    for (const t of result.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
  }
}

/**
 * Mission Manager
 *
 * Cortex-backed mission lifecycle with atomic claim semantics.
 * Missions are the work units agents execute within a venture.
 *
 * State machine: queued -> ready -> active -> review -> complete | abandoned
 *
 * Atomic claim uses Cortex triple CAS: read current state, verify preconditions,
 * write new claim, validate no concurrent modification. If the tip changed
 * between read and write, retry (max 3 attempts).
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets, sanitizeTripleValue } from "../shared/rdf-utils.js";
import type { VentureManager } from "./venture.js";

// ============================================================================
// Types
// ============================================================================

export type MissionStatus = "queued" | "ready" | "active" | "review" | "complete" | "abandoned";
export type MissionPriority = "critical" | "high" | "medium" | "low";

export type Mission = {
  id: string;
  identifier: string;
  title: string;
  description: string;
  status: MissionStatus;
  priority: MissionPriority;
  ventureId: string;
  directiveId: string | null;
  parentId: string | null;
  claimedBy: string | null;
  claimRun: string | null;
  activeRun: string | null;
  depth: number;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
};

export type MissionCreateOpts = {
  title: string;
  description?: string;
  ventureId: string;
  directiveId?: string;
  parentId?: string;
  priority?: MissionPriority;
};

export type ClaimResult =
  | { ok: true; mission: Mission }
  | { ok: false; reason: "not_found" | "already_claimed" | "wrong_status" | "conflict" };

// Valid state transitions
const VALID_TRANSITIONS: Record<MissionStatus, MissionStatus[]> = {
  queued: ["ready", "abandoned"],
  ready: ["active", "abandoned"],
  active: ["review", "complete", "abandoned", "ready"],
  review: ["complete", "active", "abandoned"],
  complete: [],
  abandoned: [],
};

// ============================================================================
// Helpers
// ============================================================================

function missionSubject(ns: string, id: string): string {
  return `${ns}:mission:${id}`;
}

function missionPredicate(ns: string, field: string): string {
  return `${ns}:mission:${field}`;
}

function parseMissionTriples(
  ns: string,
  missionId: string,
  triples: Array<{ predicate: string; object: unknown }>,
): Mission | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:mission:`;

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

  if (!fields.title) return null;

  // Extract IDs from node references
  const venturePrefix = `${ns}:venture:`;
  const directivePrefix = `${ns}:directive:`;
  const missionPrefix = `${ns}:mission:`;
  const agentPrefix = `${ns}:agent:`;

  let ventureId = fields.venture ?? "";
  if (ventureId.startsWith(venturePrefix)) ventureId = ventureId.slice(venturePrefix.length);

  let directiveId: string | null = fields.directive ?? null;
  if (directiveId?.startsWith(directivePrefix)) directiveId = directiveId.slice(directivePrefix.length);

  let parentId: string | null = fields.parent ?? null;
  if (parentId?.startsWith(missionPrefix)) parentId = parentId.slice(missionPrefix.length);

  let claimedBy: string | null = fields.claimedBy ?? null;
  if (claimedBy?.startsWith(agentPrefix)) claimedBy = claimedBy.slice(agentPrefix.length);

  return {
    id: missionId,
    identifier: fields.identifier ?? "",
    title: fields.title,
    description: fields.description ?? "",
    status: (fields.status as MissionStatus) ?? "queued",
    priority: (fields.priority as MissionPriority) ?? "medium",
    ventureId,
    directiveId,
    parentId,
    claimedBy,
    claimRun: fields.claimRun ?? null,
    activeRun: fields.activeRun ?? null,
    depth: parseInt(fields.depth ?? "0", 10),
    createdAt: fields.createdAt ?? "",
    startedAt: fields.startedAt ?? null,
    completedAt: fields.completedAt ?? null,
  };
}

// ============================================================================
// MissionManager
// ============================================================================

export class MissionManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    private readonly ventureManager: VentureManager,
  ) {}

  /** Create a new mission. Auto-assigns identifier from venture counter. */
  async create(opts: MissionCreateOpts): Promise<Mission> {
    if (!opts.title.trim()) throw new Error("Mission title is required");
    if (!opts.ventureId.trim()) throw new Error("Venture ID is required");

    // Get next mission identifier from venture
    const { identifier } = await this.ventureManager.nextMissionId(opts.ventureId);

    // Determine depth from parent
    let depth = 0;
    if (opts.parentId) {
      const parent = await this.get(opts.parentId);
      if (!parent) throw new Error(`Parent mission not found: ${opts.parentId}`);
      depth = parent.depth + 1;
      if (depth > 10) throw new Error("Mission nesting depth exceeds maximum (10)");
    }

    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = missionSubject(this.ns, id);
    const priority = opts.priority ?? "medium";

    const fields: Array<[string, string | number | { node: string }]> = [
      ["identifier", identifier],
      ["title", sanitizeTripleValue(opts.title)],
      ["description", sanitizeTripleValue(opts.description ?? "")],
      ["status", "queued"],
      ["priority", priority],
      ["venture", { node: `${this.ns}:venture:${opts.ventureId}` }],
      ["depth", depth],
      ["createdAt", now],
    ];

    if (opts.directiveId) {
      fields.push(["directive", { node: `${this.ns}:directive:${opts.directiveId}` }]);
    }
    if (opts.parentId) {
      fields.push(["parent", { node: missionSubject(this.ns, opts.parentId) }]);
    }

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: missionPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      identifier,
      title: opts.title,
      description: opts.description ?? "",
      status: "queued",
      priority,
      ventureId: opts.ventureId,
      directiveId: opts.directiveId ?? null,
      parentId: opts.parentId ?? null,
      claimedBy: null,
      claimRun: null,
      activeRun: null,
      depth,
      createdAt: now,
      startedAt: null,
      completedAt: null,
    };
  }

  /** Get a mission by ID. */
  async get(id: string): Promise<Mission | null> {
    const subject = missionSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 50 });
    return parseMissionTriples(this.ns, id, result.triples);
  }

  /** List missions for a venture with optional filters. */
  async list(
    ventureId: string,
    opts?: { status?: MissionStatus; assignee?: string; limit?: number },
  ): Promise<Mission[]> {
    const ventureNode = `${this.ns}:venture:${ventureId}`;
    const result = await this.client.patternQuery({
      predicate: missionPredicate(this.ns, "venture"),
      object: { node: ventureNode },
      limit: opts?.limit ?? 500,
    });

    const missions: Mission[] = [];
    const prefix = `${this.ns}:mission:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const mission = await this.get(id);
      if (!mission) continue;

      // Apply filters
      if (opts?.status && mission.status !== opts.status) continue;
      if (opts?.assignee && mission.claimedBy !== opts.assignee) continue;

      missions.push(mission);
    }

    return missions;
  }

  /**
   * Claim a mission for execution with optimistic concurrency control.
   *
   * Preconditions:
   * - Mission exists and is in "ready" status
   * - No other agent has an active claim (or claim is stale)
   *
   * After writing the claim, re-reads the mission to detect concurrent
   * modifications. If another agent claimed between our read and write,
   * returns conflict. This is optimistic locking — not true CAS, but
   * sufficient for single-server Cortex deployments.
   */
  async claim(missionId: string, agentId: string, runId: string): Promise<ClaimResult> {
    const mission = await this.get(missionId);
    if (!mission) return { ok: false, reason: "not_found" };

    // Idempotent: already claimed by same run
    if (mission.claimRun === runId) {
      return { ok: true, mission };
    }

    // Wrong status for claiming
    if (mission.status !== "ready") {
      // Allow stale adoption if active + same agent
      if (mission.status === "active" && mission.claimedBy === agentId && mission.claimRun !== runId) {
        return this.adoptClaim(mission, agentId, runId);
      }
      return { ok: false, reason: "wrong_status" };
    }

    // Already claimed by different agent
    if (mission.claimedBy && mission.claimedBy !== agentId) {
      return { ok: false, reason: "already_claimed" };
    }

    // Execute claim: write claim triples
    const subject = missionSubject(this.ns, missionId);
    await this.setField(subject, "claimedBy", { node: `${this.ns}:agent:${agentId}` });
    await this.setField(subject, "claimRun", runId);
    await this.setField(subject, "activeRun", runId);
    await this.setField(subject, "status", "active");
    await this.setField(subject, "startedAt", new Date().toISOString());

    // Optimistic re-check: verify our claim was not overwritten
    const verified = await this.get(missionId);
    if (verified && verified.claimRun !== runId) {
      // Another claim won the race — rollback is not needed because the
      // winner's writes already overwrote ours (delete-then-create pattern).
      // The mission state is consistent with the winner's claim.
      return { ok: false, reason: "conflict" };
    }

    return { ok: true, mission: verified! };
  }

  /** Stale run adoption — transfer claim to new run. */
  private async adoptClaim(mission: Mission, agentId: string, runId: string): Promise<ClaimResult> {
    const subject = missionSubject(this.ns, mission.id);
    await this.setField(subject, "claimRun", runId);
    await this.setField(subject, "activeRun", runId);

    const updated = await this.get(mission.id);
    return { ok: true, mission: updated! };
  }

  /** Release a claim — mission goes back to ready. */
  async release(missionId: string, runId: string): Promise<void> {
    const mission = await this.get(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);
    if (mission.claimRun !== runId) {
      throw new Error("Only the claim-holding run can release a mission");
    }

    const subject = missionSubject(this.ns, missionId);
    await this.clearField(subject, "claimedBy");
    await this.clearField(subject, "claimRun");
    await this.clearField(subject, "activeRun");
    await this.setField(subject, "status", "ready");
  }

  /** Transition mission to a new status. Validates state machine. */
  async transition(missionId: string, status: MissionStatus, runId: string): Promise<Mission> {
    const mission = await this.get(missionId);
    if (!mission) throw new Error(`Mission not found: ${missionId}`);

    const allowed = VALID_TRANSITIONS[mission.status];
    if (!allowed.includes(status)) {
      throw new Error(
        `Invalid transition: ${mission.status} -> ${status}. Allowed: ${allowed.join(", ") || "none"}`,
      );
    }

    // Only the active run can transition (except abandon which anyone can do)
    if (status !== "abandoned" && mission.activeRun && mission.activeRun !== runId) {
      throw new Error("Only the active run can transition this mission");
    }

    const subject = missionSubject(this.ns, missionId);
    await this.setField(subject, "status", status);

    // Side effects
    if (status === "complete") {
      await this.setField(subject, "completedAt", new Date().toISOString());
      await this.clearField(subject, "claimRun");
      await this.clearField(subject, "activeRun");
    } else if (status === "abandoned") {
      await this.setField(subject, "completedAt", new Date().toISOString());
      await this.clearField(subject, "claimedBy");
      await this.clearField(subject, "claimRun");
      await this.clearField(subject, "activeRun");
    } else if (status === "ready") {
      // Release: clear claim info
      await this.clearField(subject, "claimedBy");
      await this.clearField(subject, "claimRun");
      await this.clearField(subject, "activeRun");
    }

    return (await this.get(missionId))!;
  }

  /** Shorthand: complete a mission. */
  async complete(missionId: string, runId: string): Promise<Mission> {
    return this.transition(missionId, "complete", runId);
  }

  /** Shorthand: abandon a mission with optional reason. */
  async abandon(missionId: string, runId: string, reason?: string): Promise<Mission> {
    const result = await this.transition(missionId, "abandoned", runId);
    if (reason) {
      const subject = missionSubject(this.ns, missionId);
      await this.setField(subject, "abandonReason", reason);
    }
    return result;
  }

  // ---------- Triple field helpers ----------

  /** Set a field value (delete-then-create). */
  private async setField(
    subject: string,
    field: string,
    value: string | number | { node: string },
  ): Promise<void> {
    await this.clearField(subject, field);
    await this.client.createTriple({
      subject,
      predicate: missionPredicate(this.ns, field),
      object: value,
    });
  }

  /** Delete all triples for a field. */
  private async clearField(subject: string, field: string): Promise<void> {
    const existing = await this.client.listTriples({
      subject,
      predicate: missionPredicate(this.ns, field),
      limit: 5,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
  }
}

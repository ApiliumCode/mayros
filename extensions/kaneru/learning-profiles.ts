/**
 * Learning Profile Manager
 *
 * Tracks agent expertise across domain×taskType combinations. After each
 * mission completion, updates the agent's learning profile with success
 * rate and expertise score (EMA-smoothed).
 *
 * Profiles are stored as Cortex RDF triples, making them queryable by
 * other agents and the routing system.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import { classifyMission } from "../shared/task-classification.js";

// ============================================================================
// Types
// ============================================================================

export type LearningProfile = {
  agentId: string;
  domain: string;
  taskType: string;
  successRate: number;
  missionCount: number;
  avgDurationMs: number;
  expertise: number;
  lastUpdated: string;
};

export type MissionOutcome = {
  missionId: string;
  agentId: string;
  title: string;
  success: boolean;
  durationMs: number;
  domain?: string;
  taskType?: string;
};

// ============================================================================
// Constants
// ============================================================================

const EMA_SMOOTHING = 0.3;

// ============================================================================
// Helpers
// ============================================================================

function profileSubject(ns: string, agentId: string, domain: string, taskType: string): string {
  return `${ns}:profile:${agentId}:${domain}:${taskType}`;
}

function profilePredicate(ns: string, field: string): string {
  return `${ns}:profile:${field}`;
}

function stripBrackets(s: string): string {
  return s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1) : s;
}

function parseProfileTriples(
  ns: string,
  agentId: string,
  domain: string,
  taskType: string,
  triples: Array<{ predicate: string; object: unknown }>,
): LearningProfile | null {
  if (triples.length === 0) return null;

  const fields: Record<string, string> = {};
  const prefix = `${ns}:profile:`;

  for (const t of triples) {
    const pred = stripBrackets(String(t.predicate));
    if (pred.startsWith(prefix)) {
      fields[pred.slice(prefix.length)] = String(t.object);
    }
  }

  if (!fields.missionCount) return null;

  return {
    agentId,
    domain,
    taskType,
    successRate: parseFloat(fields.successRate ?? "0"),
    missionCount: parseInt(fields.missionCount ?? "0", 10),
    avgDurationMs: parseFloat(fields.avgDurationMs ?? "0"),
    expertise: parseFloat(fields.expertise ?? "0"),
    lastUpdated: fields.lastUpdated ?? "",
  };
}

// Re-export classifyMission from shared module
export { classifyMission } from "../shared/task-classification.js";

// ============================================================================
// LearningProfileManager
// ============================================================================

export class LearningProfileManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Record a mission outcome and update the agent's learning profile. */
  async recordOutcome(outcome: MissionOutcome): Promise<LearningProfile> {
    const { domain, taskType } = outcome.domain && outcome.taskType
      ? { domain: outcome.domain, taskType: outcome.taskType }
      : classifyMission(outcome.title);

    const existing = await this.getProfile(outcome.agentId, domain, taskType);

    const prevCount = existing?.missionCount ?? 0;
    const prevSuccessTotal = Math.round((existing?.successRate ?? 0) * prevCount);
    const newCount = prevCount + 1;
    const newSuccessTotal = prevSuccessTotal + (outcome.success ? 1 : 0);
    const successRate = newSuccessTotal / newCount;

    const prevAvgDuration = existing?.avgDurationMs ?? outcome.durationMs;
    const avgDurationMs = prevAvgDuration + (outcome.durationMs - prevAvgDuration) / newCount;

    // EMA expertise: blend success-weighted score
    const instantScore = outcome.success ? 0.8 + successRate * 0.2 : successRate * 0.4;
    const prevExpertise = existing?.expertise ?? 0.5;
    const expertise = EMA_SMOOTHING * instantScore + (1 - EMA_SMOOTHING) * prevExpertise;

    const subject = profileSubject(this.ns, outcome.agentId, domain, taskType);
    const now = new Date().toISOString();

    const fields: Array<[string, string | number]> = [
      ["successRate", Math.round(successRate * 1000) / 1000],
      ["missionCount", newCount],
      ["avgDurationMs", Math.round(avgDurationMs)],
      ["expertise", Math.round(expertise * 1000) / 1000],
      ["lastUpdated", now],
    ];

    for (const [field, value] of fields) {
      await this.setField(subject, field, value);
    }

    return {
      agentId: outcome.agentId,
      domain,
      taskType,
      successRate: Math.round(successRate * 1000) / 1000,
      missionCount: newCount,
      avgDurationMs: Math.round(avgDurationMs),
      expertise: Math.round(expertise * 1000) / 1000,
      lastUpdated: now,
    };
  }

  /** Get a specific learning profile. */
  async getProfile(agentId: string, domain: string, taskType: string): Promise<LearningProfile | null> {
    const subject = profileSubject(this.ns, agentId, domain, taskType);
    const result = await this.client.listTriples({ subject, limit: 20 });
    return parseProfileTriples(this.ns, agentId, domain, taskType, result.triples);
  }

  /** Get all learning profiles for an agent. */
  async getAgentProfiles(agentId: string): Promise<LearningProfile[]> {
    const prefix = `${this.ns}:profile:${agentId}:`;
    const result = await this.client.patternQuery({
      predicate: profilePredicate(this.ns, "missionCount"),
      limit: 500,
    });

    const profiles: LearningProfile[] = [];
    const seen = new Set<string>();

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      if (seen.has(sub)) continue;
      seen.add(sub);

      // Parse domain:taskType from subject
      const rest = sub.slice(prefix.length);
      const parts = rest.split(":");
      if (parts.length < 2) continue;
      const domain = parts[0];
      const taskType = parts.slice(1).join(":");

      const profile = await this.getProfile(agentId, domain, taskType);
      if (profile) profiles.push(profile);
    }

    return profiles.sort((a, b) => b.expertise - a.expertise);
  }

  /** Get expertise score for an agent in a specific domain+taskType. */
  async getExpertise(agentId: string, domain: string, taskType: string): Promise<number> {
    const profile = await this.getProfile(agentId, domain, taskType);
    return profile?.expertise ?? 0.5; // default 0.5 for unknown
  }

  /** Get top agents for a given domain and task type, ranked by expertise. */
  async topAgents(domain: string, taskType: string, limit = 10): Promise<LearningProfile[]> {
    const subject = `${this.ns}:profile:`;
    const result = await this.client.patternQuery({
      predicate: profilePredicate(this.ns, "missionCount"),
      limit: 500,
    });

    const profiles: LearningProfile[] = [];
    const suffix = `:${domain}:${taskType}`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(subject) || !sub.endsWith(suffix)) continue;

      // Extract agentId from subject
      const middle = sub.slice(subject.length, sub.length - suffix.length);
      if (!middle) continue;

      const profile = await this.getProfile(middle, domain, taskType);
      if (profile) profiles.push(profile);
    }

    return profiles
      .sort((a, b) => b.expertise - a.expertise)
      .slice(0, limit);
  }

  // ---------- Field helpers ----------

  private async setField(subject: string, field: string, value: string | number): Promise<void> {
    const existing = await this.client.listTriples({
      subject,
      predicate: profilePredicate(this.ns, field),
      limit: 5,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
    await this.client.createTriple({
      subject,
      predicate: profilePredicate(this.ns, field),
      object: value,
    });
  }
}

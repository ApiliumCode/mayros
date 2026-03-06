/**
 * Team Manager
 *
 * Cortex-backed team lifecycle: create teams with shared namespaces,
 * track member states, orchestrate merge via KnowledgeFusion.
 *
 * Follows the PlanStore pattern: subject per team, predicates for fields,
 * delete-then-create for updates.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import type { KnowledgeFusion } from "./knowledge-fusion.js";
import type { FusionReport, MergeStrategy } from "./mesh-protocol.js";
import type { NamespaceManager } from "./namespace-manager.js";

// ============================================================================
// Types
// ============================================================================

export type TeamMemberState = "pending" | "running" | "completed" | "failed";

export type TeamMember = {
  agentId: string;
  role: string;
  status: TeamMemberState;
  joinedAt: string;
  completedAt?: string;
  result?: string;
};

export type TeamConfig = {
  name: string;
  strategy: MergeStrategy;
  members: Array<{ agentId: string; role: string; task: string }>;
  timeout?: number;
};

export type TeamStatus = "pending" | "running" | "completed" | "failed";

export type TeamResult = {
  summary: string;
  memberResults: Array<{ agentId: string; role: string; findings: number; error?: string }>;
  conflicts: number;
  fusionReport?: FusionReport;
  mergeErrors?: Array<{ agentId: string; role: string; error: string }>;
};

export type TeamEntry = {
  id: string;
  name: string;
  status: TeamStatus;
  strategy: MergeStrategy;
  sharedNs: string;
  members: TeamMember[];
  createdAt: string;
  updatedAt: string;
  result?: TeamResult;
};

export type TeamManagerConfig = {
  maxTeamSize: number;
  defaultStrategy: MergeStrategy;
  workflowTimeout: number;
};

// ============================================================================
// Helpers
// ============================================================================

function teamSubject(ns: string, teamId: string): string {
  return `${ns}:team:${teamId}`;
}

function teamPredicate(ns: string, field: string): string {
  return `${ns}:team:${field}`;
}

function memberPredicate(ns: string, agentId: string): string {
  return `${ns}:team:member:${agentId}`;
}

// ============================================================================
// TeamManager
// ============================================================================

export class TeamManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    private readonly nsMgr: NamespaceManager,
    private readonly fusion: KnowledgeFusion,
    private readonly config: TeamManagerConfig,
  ) {}

  /**
   * Create a new team with a shared namespace and registered members.
   */
  async createTeam(cfg: TeamConfig): Promise<TeamEntry> {
    if (cfg.members.length === 0) {
      throw new Error("Team must have at least one member");
    }
    if (cfg.members.length > this.config.maxTeamSize) {
      throw new Error(`Team size ${cfg.members.length} exceeds max ${this.config.maxTeamSize}`);
    }

    const teamId = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const strategy = cfg.strategy ?? this.config.defaultStrategy;
    const subject = teamSubject(this.ns, teamId);

    // Create shared namespace for the team
    const agentIds = cfg.members.map((m) => m.agentId);
    const sharedNs = await this.nsMgr.createSharedNamespace(`team-${teamId}`, agentIds);

    // Store team metadata as triples
    const fields: Array<[string, string | number]> = [
      ["name", cfg.name],
      ["createdAt", now],
      ["updatedAt", now],
      ["status", "pending"],
      ["sharedNs", sharedNs],
      ["strategy", strategy],
    ];

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: teamPredicate(this.ns, field),
        object: value,
      });
    }

    // Store member entries
    const members: TeamMember[] = [];
    for (const m of cfg.members) {
      const member: TeamMember = {
        agentId: m.agentId,
        role: m.role,
        status: "pending",
        joinedAt: now,
      };
      members.push(member);

      await this.client.createTriple({
        subject,
        predicate: memberPredicate(this.ns, m.agentId),
        object: JSON.stringify(member),
      });
    }

    return {
      id: teamId,
      name: cfg.name,
      status: "pending",
      strategy,
      sharedNs,
      members,
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a team by ID, reconstructing from triples.
   */
  async getTeam(teamId: string): Promise<TeamEntry | null> {
    const subject = teamSubject(this.ns, teamId);
    const result = await this.client.listTriples({ subject, limit: 200 });

    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const members: TeamMember[] = [];
    const memberPrefix = teamPredicate(this.ns, "member:");

    for (const t of result.triples) {
      const pred = String(t.predicate);
      const val =
        typeof t.object === "object" && t.object !== null && "node" in t.object
          ? String((t.object as { node: string }).node)
          : String(t.object);

      if (pred.startsWith(memberPrefix)) {
        try {
          members.push(JSON.parse(val) as TeamMember);
        } catch {
          // Skip malformed member entries
        }
      } else {
        // Extract field name from predicate
        const fieldPrefix = `${this.ns}:team:`;
        if (pred.startsWith(fieldPrefix)) {
          fields[pred.slice(fieldPrefix.length)] = val;
        }
      }
    }

    const entry: TeamEntry = {
      id: teamId,
      name: fields.name ?? "",
      status: (fields.status as TeamStatus) ?? "pending",
      strategy: (fields.strategy as MergeStrategy) ?? this.config.defaultStrategy,
      sharedNs: fields.sharedNs ?? "",
      members,
      createdAt: fields.createdAt ?? "",
      updatedAt: fields.updatedAt ?? "",
    };

    if (fields.result) {
      try {
        entry.result = JSON.parse(fields.result) as TeamResult;
      } catch {
        // Skip malformed result
      }
    }

    return entry;
  }

  /**
   * List all teams (summary view).
   */
  async listTeams(): Promise<
    Array<{ id: string; name: string; status: string; updatedAt: string }>
  > {
    const result = await this.client.patternQuery({
      predicate: teamPredicate(this.ns, "name"),
      limit: 200,
    });

    const teams: Array<{ id: string; name: string; status: string; updatedAt: string }> = [];
    const prefix = `${this.ns}:team:`;

    for (const match of result.matches) {
      const subject = String(match.subject);
      if (!subject.startsWith(prefix)) continue;

      const teamId = subject.slice(prefix.length);
      const name =
        typeof match.object === "object" && match.object !== null && "node" in match.object
          ? String((match.object as { node: string }).node)
          : String(match.object);

      // Fetch status and updatedAt
      const statusResult = await this.client.listTriples({
        subject,
        predicate: teamPredicate(this.ns, "status"),
        limit: 1,
      });
      const updatedResult = await this.client.listTriples({
        subject,
        predicate: teamPredicate(this.ns, "updatedAt"),
        limit: 1,
      });

      const status = statusResult.triples[0] ? String(statusResult.triples[0].object) : "pending";
      const updatedAt = updatedResult.triples[0] ? String(updatedResult.triples[0].object) : "";

      teams.push({ id: teamId, name, status, updatedAt });
    }

    return teams;
  }

  /**
   * Update a member's status within a team.
   */
  async updateMemberStatus(
    teamId: string,
    agentId: string,
    status: TeamMemberState,
    result?: string,
  ): Promise<void> {
    const subject = teamSubject(this.ns, teamId);
    const pred = memberPredicate(this.ns, agentId);

    // Read existing member data
    const existing = await this.client.listTriples({
      subject,
      predicate: pred,
      limit: 1,
    });

    let member: TeamMember;
    if (existing.triples.length > 0) {
      try {
        member = JSON.parse(String(existing.triples[0].object)) as TeamMember;
      } catch {
        member = {
          agentId,
          role: "unknown",
          status: "pending",
          joinedAt: new Date().toISOString(),
        };
      }
      // Delete old triple
      if (existing.triples[0].id) {
        await this.client.deleteTriple(existing.triples[0].id);
      }
    } else {
      member = { agentId, role: "unknown", status: "pending", joinedAt: new Date().toISOString() };
    }

    member.status = status;
    if (status === "completed" || status === "failed") {
      member.completedAt = new Date().toISOString();
    }
    if (result !== undefined) {
      member.result = result;
    }

    await this.client.createTriple({
      subject,
      predicate: pred,
      object: JSON.stringify(member),
    });

    // Update team's updatedAt
    await this.updateField(teamId, "updatedAt", new Date().toISOString());
  }

  /**
   * Update the team's overall status.
   */
  async updateTeamStatus(teamId: string, status: TeamStatus): Promise<void> {
    await this.updateField(teamId, "status", status);
    await this.updateField(teamId, "updatedAt", new Date().toISOString());
  }

  /**
   * Merge all member results using the team's configured strategy.
   */
  async mergeTeamResults(teamId: string): Promise<TeamResult> {
    const team = await this.getTeam(teamId);
    if (!team) {
      throw new Error(`Team ${teamId} not found`);
    }

    const completedMembers = team.members.filter((m) => m.status === "completed");
    if (completedMembers.length === 0) {
      return {
        summary: "No completed members to merge",
        memberResults: [],
        conflicts: 0,
      };
    }

    // Merge each member's private namespace into the shared namespace
    let totalConflicts = 0;
    let lastReport: FusionReport | undefined;
    const memberResults: Array<{
      agentId: string;
      role: string;
      findings: number;
      error?: string;
    }> = [];
    const mergeErrors: Array<{ agentId: string; role: string; error: string }> = [];

    const additionalNs =
      completedMembers.length >= 3
        ? completedMembers.map((m) => this.nsMgr.getPrivateNs(m.agentId))
        : undefined;

    for (const member of completedMembers) {
      const memberNs = this.nsMgr.getPrivateNs(member.agentId);

      try {
        const report = await this.fusion.merge(
          memberNs,
          team.sharedNs,
          team.strategy,
          additionalNs,
        );
        totalConflicts += report.conflicts;
        lastReport = report;
        memberResults.push({
          agentId: member.agentId,
          role: member.role,
          findings: report.added,
        });
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[TeamManager] merge failed for agent "${member.agentId}" (role: ${member.role}): ${errMsg}`,
        );
        mergeErrors.push({ agentId: member.agentId, role: member.role, error: errMsg });
        memberResults.push({
          agentId: member.agentId,
          role: member.role,
          findings: -1,
          error: errMsg,
        });
      }
    }

    const teamResult: TeamResult = {
      summary: `Merged ${completedMembers.length} member(s) with ${team.strategy} strategy${mergeErrors.length > 0 ? ` (${mergeErrors.length} merge failure(s))` : ""}`,
      memberResults,
      conflicts: totalConflicts,
      fusionReport: lastReport,
      ...(mergeErrors.length > 0 && { mergeErrors }),
    };

    // Persist result
    await this.updateField(teamId, "result", JSON.stringify(teamResult));

    return teamResult;
  }

  /**
   * Check if all team members have completed (or failed).
   */
  async isTeamComplete(teamId: string): Promise<boolean> {
    const team = await this.getTeam(teamId);
    if (!team) return false;
    return team.members.every((m) => m.status === "completed" || m.status === "failed");
  }

  // ---------- internal helpers ----------

  private async updateField(teamId: string, field: string, value: string): Promise<void> {
    const subject = teamSubject(this.ns, teamId);
    const predicate = teamPredicate(this.ns, field);

    // Delete existing value
    const existing = await this.client.listTriples({
      subject,
      predicate,
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    // Write new value
    await this.client.createTriple({ subject, predicate, object: value });
  }
}

/**
 * Team Dashboard Service
 *
 * Aggregation layer over TeamManager, AgentMailbox, and optional
 * ObservabilityQueryEngine providing a unified team view.
 * Designed for CLI display and gateway RPC consumption.
 */

import type { AgentMailbox, MailboxStats } from "./agent-mailbox.js";
import type { TeamManager, TeamEntry, TeamMemberState, TeamStatus } from "./team-manager.js";
import type { MergeStrategy } from "./mesh-protocol.js";

// ============================================================================
// Types
// ============================================================================

/**
 * Minimal interface for trace stats aggregation.
 * Mirrors AgentStats from ObservabilityQueryEngine without importing
 * the full observability extension.
 */
export type TraceStatsProvider = {
  aggregateStats(
    agentId: string,
    timeRange?: { from?: Date; to?: Date },
  ): Promise<{ totalEvents: number; errors: number }>;
};

export type AgentStatusEntry = {
  agentId: string;
  role: string;
  status: TeamMemberState;
  unreadMessages: number;
  totalEvents: number;
  errors: number;
  lastActivity?: string;
};

export type TeamDashboard = {
  teamId: string;
  teamName: string;
  teamStatus: TeamStatus;
  strategy: MergeStrategy;
  members: AgentStatusEntry[];
  mailboxSummary: { total: number; unread: number };
  workflowPhase?: string;
  createdAt: string;
  updatedAt: string;
};

export type DashboardSummary = {
  activeTeams: number;
  totalAgents: number;
  totalUnread: number;
  totalErrors: number;
  teams: TeamDashboard[];
};

export type AgentActivity = {
  agentId: string;
  teams: Array<{ teamId: string; teamName: string; role: string; status: TeamMemberState }>;
  mailboxStats: MailboxStats;
  traceStats: { totalEvents: number; errors: number } | null;
};

// ============================================================================
// TeamDashboardService
// ============================================================================

export class TeamDashboardService {
  constructor(
    private readonly teamMgr: TeamManager,
    private readonly mailbox: AgentMailbox,
    private readonly traceProvider: TraceStatsProvider | null,
    private readonly ns: string,
  ) {}

  /**
   * Aggregate a single team's dashboard view.
   */
  async getTeamDashboard(teamId: string): Promise<TeamDashboard | null> {
    const team = await this.teamMgr.getTeam(teamId);
    if (!team) return null;

    return this.buildTeamDashboard(team);
  }

  /**
   * Dashboard summary across all active teams.
   */
  async getSummary(): Promise<DashboardSummary> {
    const teamList = await this.teamMgr.listTeams();
    const dashboards: TeamDashboard[] = [];

    for (const entry of teamList) {
      const full = await this.teamMgr.getTeam(entry.id);
      if (!full) continue;
      dashboards.push(await this.buildTeamDashboard(full));
    }

    let totalAgents = 0;
    let totalUnread = 0;
    let totalErrors = 0;

    for (const d of dashboards) {
      totalAgents += d.members.length;
      totalUnread += d.mailboxSummary.unread;
      for (const m of d.members) {
        totalErrors += m.errors;
      }
    }

    return {
      activeTeams: dashboards.length,
      totalAgents,
      totalUnread,
      totalErrors,
      teams: dashboards,
    };
  }

  /**
   * Get a single agent's activity across all teams.
   */
  async getAgentActivity(agentId: string): Promise<AgentActivity> {
    const teamList = await this.teamMgr.listTeams();
    const teams: AgentActivity["teams"] = [];

    for (const entry of teamList) {
      const full = await this.teamMgr.getTeam(entry.id);
      if (!full) continue;

      const member = full.members.find((m) => m.agentId === agentId);
      if (member) {
        teams.push({
          teamId: full.id,
          teamName: full.name,
          role: member.role,
          status: member.status,
        });
      }
    }

    const mailboxStats = await this.safeMailboxStats(agentId);
    const traceStats = await this.safeTraceStats(agentId);

    return { agentId, teams, mailboxStats, traceStats };
  }

  // ---------- Private helpers ----------

  private async buildTeamDashboard(team: TeamEntry): Promise<TeamDashboard> {
    const members: AgentStatusEntry[] = [];
    let totalMail = 0;
    let totalUnread = 0;

    for (const m of team.members) {
      const mStats = await this.safeMailboxStats(m.agentId);
      const tStats = await this.safeTraceStats(m.agentId);

      members.push({
        agentId: m.agentId,
        role: m.role,
        status: m.status,
        unreadMessages: mStats.unread,
        totalEvents: tStats?.totalEvents ?? 0,
        errors: tStats?.errors ?? 0,
        lastActivity: m.completedAt,
      });

      totalMail += mStats.total;
      totalUnread += mStats.unread;
    }

    return {
      teamId: team.id,
      teamName: team.name,
      teamStatus: team.status,
      strategy: team.strategy,
      members,
      mailboxSummary: { total: totalMail, unread: totalUnread },
      createdAt: team.createdAt,
      updatedAt: team.updatedAt,
    };
  }

  private async safeMailboxStats(agentId: string): Promise<MailboxStats> {
    try {
      return await this.mailbox.stats(agentId);
    } catch {
      return { total: 0, unread: 0, read: 0, archived: 0, byType: {} };
    }
  }

  private async safeTraceStats(
    agentId: string,
  ): Promise<{ totalEvents: number; errors: number } | null> {
    if (!this.traceProvider) return null;
    try {
      const s = await this.traceProvider.aggregateStats(agentId);
      return { totalEvents: s.totalEvents, errors: s.errors };
    } catch {
      return null;
    }
  }
}

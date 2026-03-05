/**
 * Tests for TeamDashboardService.
 *
 * Mocks TeamManager, AgentMailbox, and optional TraceStatsProvider
 * to verify aggregation, summary, and agent activity views.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { TeamDashboardService, type TraceStatsProvider } from "./team-dashboard.js";
import type { AgentMailbox, MailboxStats } from "./agent-mailbox.js";
import type { TeamManager, TeamEntry } from "./team-manager.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeTeamEntry(overrides?: Partial<TeamEntry>): TeamEntry {
  return {
    id: "team-1",
    name: "Alpha Team",
    status: "running",
    strategy: "additive",
    sharedNs: "mayros:shared:team-1",
    members: [
      { agentId: "agent-a", role: "lead", status: "running", joinedAt: "2026-01-01T00:00:00Z" },
      {
        agentId: "agent-b",
        role: "worker",
        status: "completed",
        joinedAt: "2026-01-01T00:00:00Z",
        completedAt: "2026-01-01T01:00:00Z",
        result: "done",
      },
    ],
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T01:00:00Z",
    ...overrides,
  };
}

function makeMockTeamMgr(teams: TeamEntry[]): TeamManager {
  return {
    getTeam: vi.fn(async (id: string) => teams.find((t) => t.id === id) ?? null),
    listTeams: vi.fn(async () =>
      teams.map((t) => ({ id: t.id, name: t.name, status: t.status, updatedAt: t.updatedAt })),
    ),
  } as unknown as TeamManager;
}

function makeMockMailbox(statsByAgent: Record<string, MailboxStats>): AgentMailbox {
  return {
    stats: vi.fn(
      async (agentId: string) =>
        statsByAgent[agentId] ?? { total: 0, unread: 0, read: 0, archived: 0, byType: {} },
    ),
  } as unknown as AgentMailbox;
}

function makeMockTraceProvider(
  statsByAgent: Record<string, { totalEvents: number; errors: number }>,
): TraceStatsProvider {
  return {
    aggregateStats: vi.fn(async (agentId: string) => {
      const s = statsByAgent[agentId];
      return s ?? { totalEvents: 0, errors: 0 };
    }),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("TeamDashboardService", () => {
  const ns = "mayros";
  let teamMgr: TeamManager;
  let mailbox: AgentMailbox;
  let traceProvider: TraceStatsProvider;
  let dashboard: TeamDashboardService;

  beforeEach(() => {
    const team1 = makeTeamEntry();
    teamMgr = makeMockTeamMgr([team1]);
    mailbox = makeMockMailbox({
      "agent-a": { total: 5, unread: 2, read: 2, archived: 1, byType: { task: 3 } },
      "agent-b": { total: 3, unread: 1, read: 1, archived: 1, byType: { finding: 2 } },
    });
    traceProvider = makeMockTraceProvider({
      "agent-a": { totalEvents: 100, errors: 3 },
      "agent-b": { totalEvents: 50, errors: 0 },
    });
    dashboard = new TeamDashboardService(teamMgr, mailbox, traceProvider, ns);
  });

  // ---------- getTeamDashboard ----------

  test("getTeamDashboard returns aggregated view", async () => {
    const d = await dashboard.getTeamDashboard("team-1");
    expect(d).not.toBeNull();
    expect(d!.teamId).toBe("team-1");
    expect(d!.teamName).toBe("Alpha Team");
    expect(d!.teamStatus).toBe("running");
    expect(d!.strategy).toBe("additive");
    expect(d!.members).toHaveLength(2);
  });

  test("getTeamDashboard aggregates mailbox stats per member", async () => {
    const d = await dashboard.getTeamDashboard("team-1");
    expect(d!.members[0].unreadMessages).toBe(2);
    expect(d!.members[1].unreadMessages).toBe(1);
    expect(d!.mailboxSummary.total).toBe(8);
    expect(d!.mailboxSummary.unread).toBe(3);
  });

  test("getTeamDashboard aggregates trace stats per member", async () => {
    const d = await dashboard.getTeamDashboard("team-1");
    expect(d!.members[0].totalEvents).toBe(100);
    expect(d!.members[0].errors).toBe(3);
    expect(d!.members[1].totalEvents).toBe(50);
    expect(d!.members[1].errors).toBe(0);
  });

  test("getTeamDashboard returns null for unknown team", async () => {
    const d = await dashboard.getTeamDashboard("nonexistent");
    expect(d).toBeNull();
  });

  test("getTeamDashboard preserves lastActivity from completedAt", async () => {
    const d = await dashboard.getTeamDashboard("team-1");
    expect(d!.members[0].lastActivity).toBeUndefined();
    expect(d!.members[1].lastActivity).toBe("2026-01-01T01:00:00Z");
  });

  // ---------- getSummary ----------

  test("getSummary lists all active teams", async () => {
    const s = await dashboard.getSummary();
    expect(s.activeTeams).toBe(1);
    expect(s.teams).toHaveLength(1);
  });

  test("getSummary aggregates totals", async () => {
    const s = await dashboard.getSummary();
    expect(s.totalAgents).toBe(2);
    expect(s.totalUnread).toBe(3);
    expect(s.totalErrors).toBe(3);
  });

  test("getSummary returns empty when no teams", async () => {
    const emptyMgr = makeMockTeamMgr([]);
    const d = new TeamDashboardService(emptyMgr, mailbox, traceProvider, ns);
    const s = await d.getSummary();
    expect(s.activeTeams).toBe(0);
    expect(s.totalAgents).toBe(0);
    expect(s.teams).toEqual([]);
  });

  test("getSummary with multiple teams", async () => {
    const team2 = makeTeamEntry({
      id: "team-2",
      name: "Beta Team",
      members: [
        {
          agentId: "agent-c",
          role: "analyst",
          status: "pending",
          joinedAt: "2026-02-01T00:00:00Z",
        },
      ],
    });
    const mgr = makeMockTeamMgr([makeTeamEntry(), team2]);
    const d = new TeamDashboardService(mgr, mailbox, traceProvider, ns);
    const s = await d.getSummary();
    expect(s.activeTeams).toBe(2);
    expect(s.totalAgents).toBe(3);
  });

  // ---------- null trace provider ----------

  test("handles null trace provider gracefully", async () => {
    const d = new TeamDashboardService(teamMgr, mailbox, null, ns);
    const dash = await d.getTeamDashboard("team-1");
    expect(dash).not.toBeNull();
    expect(dash!.members[0].totalEvents).toBe(0);
    expect(dash!.members[0].errors).toBe(0);
  });

  // ---------- empty team ----------

  test("empty team returns zero stats", async () => {
    const emptyTeam = makeTeamEntry({ members: [] });
    const mgr = makeMockTeamMgr([emptyTeam]);
    const d = new TeamDashboardService(mgr, mailbox, traceProvider, ns);
    const dash = await d.getTeamDashboard("team-1");
    expect(dash!.members).toHaveLength(0);
    expect(dash!.mailboxSummary.total).toBe(0);
    expect(dash!.mailboxSummary.unread).toBe(0);
  });

  // ---------- members with mixed statuses ----------

  test("members with mixed statuses are preserved", async () => {
    const mixedTeam = makeTeamEntry({
      members: [
        {
          agentId: "a1",
          role: "lead",
          status: "completed",
          joinedAt: "2026-01-01T00:00:00Z",
          completedAt: "2026-01-01T01:00:00Z",
        },
        { agentId: "a2", role: "worker", status: "failed", joinedAt: "2026-01-01T00:00:00Z" },
        { agentId: "a3", role: "reviewer", status: "running", joinedAt: "2026-01-01T00:00:00Z" },
        { agentId: "a4", role: "tester", status: "pending", joinedAt: "2026-01-01T00:00:00Z" },
      ],
    });
    const mgr = makeMockTeamMgr([mixedTeam]);
    const d = new TeamDashboardService(mgr, mailbox, traceProvider, ns);
    const dash = await d.getTeamDashboard("team-1");
    const statuses = dash!.members.map((m) => m.status);
    expect(statuses).toEqual(["completed", "failed", "running", "pending"]);
  });

  // ---------- getAgentActivity ----------

  test("getAgentActivity returns teams the agent is in", async () => {
    const act = await dashboard.getAgentActivity("agent-a");
    expect(act.agentId).toBe("agent-a");
    expect(act.teams).toHaveLength(1);
    expect(act.teams[0].teamId).toBe("team-1");
    expect(act.teams[0].role).toBe("lead");
  });

  test("getAgentActivity returns empty teams for unknown agent", async () => {
    const act = await dashboard.getAgentActivity("unknown");
    expect(act.teams).toHaveLength(0);
  });

  test("getAgentActivity includes mailbox stats", async () => {
    const act = await dashboard.getAgentActivity("agent-a");
    expect(act.mailboxStats.total).toBe(5);
    expect(act.mailboxStats.unread).toBe(2);
  });

  test("getAgentActivity includes trace stats", async () => {
    const act = await dashboard.getAgentActivity("agent-a");
    expect(act.traceStats).not.toBeNull();
    expect(act.traceStats!.totalEvents).toBe(100);
    expect(act.traceStats!.errors).toBe(3);
  });

  test("getAgentActivity trace stats null without provider", async () => {
    const d = new TeamDashboardService(teamMgr, mailbox, null, ns);
    const act = await d.getAgentActivity("agent-a");
    expect(act.traceStats).toBeNull();
  });

  // ---------- error handling ----------

  test("mailbox stats error returns zeroed stats", async () => {
    const failMailbox = {
      stats: vi.fn(async () => {
        throw new Error("connection refused");
      }),
    } as unknown as AgentMailbox;

    const d = new TeamDashboardService(teamMgr, failMailbox, traceProvider, ns);
    const dash = await d.getTeamDashboard("team-1");
    expect(dash).not.toBeNull();
    expect(dash!.members[0].unreadMessages).toBe(0);
    expect(dash!.mailboxSummary.total).toBe(0);
  });

  test("trace provider error returns null stats", async () => {
    const failTrace: TraceStatsProvider = {
      aggregateStats: vi.fn(async () => {
        throw new Error("cortex down");
      }),
    };

    const d = new TeamDashboardService(teamMgr, mailbox, failTrace, ns);
    const dash = await d.getTeamDashboard("team-1");
    expect(dash).not.toBeNull();
    expect(dash!.members[0].totalEvents).toBe(0);
    expect(dash!.members[0].errors).toBe(0);
  });

  // ---------- timestamps ----------

  test("dashboard preserves team timestamps", async () => {
    const d = await dashboard.getTeamDashboard("team-1");
    expect(d!.createdAt).toBe("2026-01-01T00:00:00Z");
    expect(d!.updatedAt).toBe("2026-01-01T01:00:00Z");
  });

  test("getAgentActivity across multiple teams", async () => {
    const team1 = makeTeamEntry();
    const team2 = makeTeamEntry({
      id: "team-2",
      name: "Beta",
      members: [
        {
          agentId: "agent-a",
          role: "reviewer",
          status: "pending",
          joinedAt: "2026-02-01T00:00:00Z",
        },
      ],
    });
    const mgr = makeMockTeamMgr([team1, team2]);
    const d = new TeamDashboardService(mgr, mailbox, traceProvider, ns);
    const act = await d.getAgentActivity("agent-a");
    expect(act.teams).toHaveLength(2);
    expect(act.teams[0].role).toBe("lead");
    expect(act.teams[1].role).toBe("reviewer");
  });
});

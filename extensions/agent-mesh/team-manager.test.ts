/**
 * Team Manager Tests
 */

import { describe, it, expect, vi } from "vitest";
import { TeamManager, type TeamManagerConfig } from "./team-manager.js";

// ============================================================================
// Mock Cortex Client
// ============================================================================

function createMockClient() {
  const triples: Array<{
    id: string;
    subject: string;
    predicate: string;
    object: string | number | boolean | { node: string };
  }> = [];
  let nextId = 1;

  return {
    triples,
    async createTriple(req: {
      subject: string;
      predicate: string;
      object: string | number | boolean | { node: string };
    }) {
      const triple = { id: String(nextId++), ...req };
      triples.push(triple);
      return triple;
    },
    async listTriples(query: { subject?: string; predicate?: string; limit?: number }) {
      const filtered = triples.filter((t) => {
        if (query.subject && t.subject !== query.subject) return false;
        if (query.predicate && t.predicate !== query.predicate) return false;
        return true;
      });
      const limited = filtered.slice(0, query.limit ?? 100);
      return { triples: limited, total: filtered.length };
    },
    async patternQuery(req: {
      subject?: string;
      predicate?: string;
      object?: string | number | boolean | { node: string };
      limit?: number;
    }) {
      const filtered = triples.filter((t) => {
        if (req.subject && t.subject !== req.subject) return false;
        if (req.predicate && t.predicate !== req.predicate) return false;
        if (req.object !== undefined) {
          if (JSON.stringify(req.object) !== JSON.stringify(t.object)) return false;
        }
        return true;
      });
      const limited = filtered.slice(0, req.limit ?? 100);
      return { matches: limited, total: filtered.length };
    },
    async deleteTriple(id: string) {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
    },
  };
}

function createMockNsMgr(ns: string) {
  return {
    getPrivateNs(agentId: string) {
      return `${ns}:agent:${agentId}`;
    },
    getSharedNs(workspaceId: string) {
      return `${ns}:shared:${workspaceId}`;
    },
    async createSharedNamespace(name: string, _owners: string[]) {
      return `${ns}:shared:${name}`;
    },
    async checkAccess() {
      return true;
    },
    getACL() {
      return {
        async grant() {},
        async revoke() {},
        async checkAccess() {
          return true;
        },
        async listGrants() {
          return [];
        },
      };
    },
    async listAccessible() {
      return [];
    },
  };
}

function createMockFusion() {
  return {
    async merge(_sourceNs: string, _targetNs: string, strategy: string) {
      return {
        added: 3,
        skipped: 1,
        conflicts: 0,
        details: [],
        strategy,
        sourceNs: _sourceNs,
        targetNs: _targetNs,
      };
    },
    async detectConflicts() {
      return [];
    },
    async resolveConflicts() {
      return [];
    },
    async synthesize() {
      return { totalTriples: 0, namespaces: [], summary: "", keyFacts: [] };
    },
  };
}

const DEFAULT_CONFIG: TeamManagerConfig = {
  maxTeamSize: 8,
  defaultStrategy: "additive",
  workflowTimeout: 600,
};

// ============================================================================
// Tests
// ============================================================================

describe("TeamManager", () => {
  describe("createTeam", () => {
    it("creates a team with members and shared namespace", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "review-team",
        strategy: "additive",
        members: [
          { agentId: "agent-1", role: "security", task: "Check vulnerabilities" },
          { agentId: "agent-2", role: "tests", task: "Verify test coverage" },
        ],
      });

      expect(team.name).toBe("review-team");
      expect(team.status).toBe("pending");
      expect(team.strategy).toBe("additive");
      expect(team.members).toHaveLength(2);
      expect(team.members[0].agentId).toBe("agent-1");
      expect(team.members[0].role).toBe("security");
      expect(team.members[0].status).toBe("pending");
      expect(team.sharedNs).toContain("mayros:shared:");
      expect(team.createdAt).toBeTruthy();
      expect(team.id).toBeTruthy();
    });

    it("uses default strategy from config", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(client as never, "mayros", nsMgr as never, fusion as never, {
        ...DEFAULT_CONFIG,
        defaultStrategy: "conflict-flag",
      });

      const team = await mgr.createTeam({
        name: "test",
        strategy: "conflict-flag",
        members: [{ agentId: "a1", role: "worker", task: "work" }],
      });

      expect(team.strategy).toBe("conflict-flag");
    });

    it("rejects empty member list", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      await expect(
        mgr.createTeam({ name: "empty", strategy: "additive", members: [] }),
      ).rejects.toThrow(/at least one member/);
    });

    it("rejects teams exceeding maxTeamSize", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(client as never, "mayros", nsMgr as never, fusion as never, {
        ...DEFAULT_CONFIG,
        maxTeamSize: 2,
      });

      await expect(
        mgr.createTeam({
          name: "big",
          strategy: "additive",
          members: [
            { agentId: "a1", role: "r1", task: "t1" },
            { agentId: "a2", role: "r2", task: "t2" },
            { agentId: "a3", role: "r3", task: "t3" },
          ],
        }),
      ).rejects.toThrow(/exceeds max/);
    });
  });

  describe("getTeam", () => {
    it("returns null for non-existent team", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.getTeam("nonexistent");
      expect(team).toBeNull();
    });

    it("reconstructs team from triples", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const created = await mgr.createTeam({
        name: "my-team",
        strategy: "replace",
        members: [{ agentId: "agent-x", role: "analyst", task: "analyze" }],
      });

      const fetched = await mgr.getTeam(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("my-team");
      expect(fetched!.strategy).toBe("replace");
      expect(fetched!.status).toBe("pending");
      expect(fetched!.members).toHaveLength(1);
      expect(fetched!.members[0].agentId).toBe("agent-x");
    });
  });

  describe("listTeams", () => {
    it("lists all teams", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      await mgr.createTeam({
        name: "team-a",
        strategy: "additive",
        members: [{ agentId: "a1", role: "r1", task: "t1" }],
      });
      await mgr.createTeam({
        name: "team-b",
        strategy: "additive",
        members: [{ agentId: "a2", role: "r2", task: "t2" }],
      });

      const teams = await mgr.listTeams();
      expect(teams).toHaveLength(2);
      expect(teams.map((t) => t.name).sort()).toEqual(["team-a", "team-b"]);
    });

    it("returns empty array when no teams exist", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const teams = await mgr.listTeams();
      expect(teams).toHaveLength(0);
    });
  });

  describe("updateMemberStatus", () => {
    it("updates a member's status", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "status-test",
        strategy: "additive",
        members: [{ agentId: "agent-1", role: "worker", task: "work" }],
      });

      await mgr.updateMemberStatus(team.id, "agent-1", "running");
      let fetched = await mgr.getTeam(team.id);
      expect(fetched!.members[0].status).toBe("running");

      await mgr.updateMemberStatus(team.id, "agent-1", "completed", "Found 5 issues");
      fetched = await mgr.getTeam(team.id);
      expect(fetched!.members[0].status).toBe("completed");
      expect(fetched!.members[0].result).toBe("Found 5 issues");
      expect(fetched!.members[0].completedAt).toBeTruthy();
    });
  });

  describe("updateTeamStatus", () => {
    it("updates the team status", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "status-team",
        strategy: "additive",
        members: [{ agentId: "a1", role: "r1", task: "t1" }],
      });

      await mgr.updateTeamStatus(team.id, "running");
      const fetched = await mgr.getTeam(team.id);
      expect(fetched!.status).toBe("running");
    });
  });

  describe("isTeamComplete", () => {
    it("returns false when members are still pending", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "incomplete",
        strategy: "additive",
        members: [
          { agentId: "a1", role: "r1", task: "t1" },
          { agentId: "a2", role: "r2", task: "t2" },
        ],
      });

      expect(await mgr.isTeamComplete(team.id)).toBe(false);
    });

    it("returns true when all members completed or failed", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "done",
        strategy: "additive",
        members: [
          { agentId: "a1", role: "r1", task: "t1" },
          { agentId: "a2", role: "r2", task: "t2" },
        ],
      });

      await mgr.updateMemberStatus(team.id, "a1", "completed");
      await mgr.updateMemberStatus(team.id, "a2", "failed");

      expect(await mgr.isTeamComplete(team.id)).toBe(true);
    });

    it("returns false for non-existent team", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      expect(await mgr.isTeamComplete("nonexistent")).toBe(false);
    });
  });

  describe("updateMemberStatus edge cases", () => {
    it("handles update for member not in original team", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "edge-test",
        strategy: "additive",
        members: [{ agentId: "a1", role: "r1", task: "t1" }],
      });

      // Update a member that wasn't in the original team — should create a new entry
      await mgr.updateMemberStatus(team.id, "unknown-agent", "completed", "late join");
      const fetched = await mgr.getTeam(team.id);
      const unknown = fetched!.members.find((m) => m.agentId === "unknown-agent");
      expect(unknown).toBeTruthy();
      expect(unknown!.status).toBe("completed");
      expect(unknown!.result).toBe("late join");
    });
  });

  describe("mergeTeamResults", () => {
    it("merges completed member results", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "merge-test",
        strategy: "additive",
        members: [
          { agentId: "a1", role: "security", task: "scan" },
          { agentId: "a2", role: "tests", task: "test" },
        ],
      });

      await mgr.updateMemberStatus(team.id, "a1", "completed", "3 findings");
      await mgr.updateMemberStatus(team.id, "a2", "completed", "2 findings");

      const result = await mgr.mergeTeamResults(team.id);

      expect(result.summary).toContain("Merged 2");
      expect(result.summary).toContain("additive");
      expect(result.memberResults).toHaveLength(2);
      expect(result.memberResults[0].findings).toBe(3);
    });

    it("returns empty result when no completed members", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "no-merge",
        strategy: "additive",
        members: [{ agentId: "a1", role: "r1", task: "t1" }],
      });

      const result = await mgr.mergeTeamResults(team.id);
      expect(result.summary).toContain("No completed");
      expect(result.memberResults).toHaveLength(0);
    });

    it("only merges completed members, skips running and failed", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      const team = await mgr.createTeam({
        name: "mixed-status",
        strategy: "additive",
        members: [
          { agentId: "a1", role: "security", task: "scan" },
          { agentId: "a2", role: "tests", task: "test" },
          { agentId: "a3", role: "types", task: "check" },
        ],
      });

      await mgr.updateMemberStatus(team.id, "a1", "completed", "done");
      await mgr.updateMemberStatus(team.id, "a2", "running");
      await mgr.updateMemberStatus(team.id, "a3", "failed", "error");

      const result = await mgr.mergeTeamResults(team.id);
      // Only a1 (completed) should be merged; a2 (running) and a3 (failed) skipped
      expect(result.memberResults).toHaveLength(1);
      expect(result.memberResults[0].agentId).toBe("a1");
    });

    it("throws for non-existent team", async () => {
      const client = createMockClient();
      const nsMgr = createMockNsMgr("mayros");
      const fusion = createMockFusion();
      const mgr = new TeamManager(
        client as never,
        "mayros",
        nsMgr as never,
        fusion as never,
        DEFAULT_CONFIG,
      );

      await expect(mgr.mergeTeamResults("ghost")).rejects.toThrow(/not found/);
    });
  });
});

/**
 * Workflow Orchestrator Tests
 */

import { describe, it, expect } from "vitest";
import { TeamManager, type TeamManagerConfig } from "./team-manager.js";
import { WorkflowOrchestrator } from "./workflow-orchestrator.js";

// ============================================================================
// Mock Client
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
    getPrivateNs: (agentId: string) => `${ns}:agent:${agentId}`,
    getSharedNs: (workspaceId: string) => `${ns}:shared:${workspaceId}`,
    createSharedNamespace: async (name: string) => `${ns}:shared:${name}`,
    checkAccess: async () => true,
    getACL: () => ({
      grant: async () => {},
      revoke: async () => {},
      checkAccess: async () => true,
      listGrants: async () => [],
    }),
    listAccessible: async () => [],
  };
}

function createMockFusion() {
  return {
    merge: async (_s: string, _t: string, strategy: string) => ({
      added: 3,
      skipped: 1,
      conflicts: 0,
      details: [],
      strategy,
      sourceNs: _s,
      targetNs: _t,
    }),
    detectConflicts: async () => [],
    resolveConflicts: async () => [],
    synthesize: async () => ({ totalTriples: 0, namespaces: [], summary: "", keyFacts: [] }),
  };
}

const TEAM_CONFIG: TeamManagerConfig = {
  maxTeamSize: 8,
  defaultStrategy: "additive",
  workflowTimeout: 600,
};

function createOrchestrator() {
  const client = createMockClient();
  const nsMgr = createMockNsMgr("mayros");
  const fusion = createMockFusion();
  const teamMgr = new TeamManager(
    client as never,
    "mayros",
    nsMgr as never,
    fusion as never,
    TEAM_CONFIG,
  );
  const orchestrator = new WorkflowOrchestrator(
    client as never,
    "mayros",
    teamMgr,
    fusion as never,
    nsMgr as never,
  );
  return { client, nsMgr, fusion, teamMgr, orchestrator };
}

// ============================================================================
// Tests
// ============================================================================

describe("WorkflowOrchestrator", () => {
  describe("startWorkflow", () => {
    it("starts a code-review workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
        path: "src/",
      });

      expect(entry.name).toBe("code-review");
      expect(entry.definition).toBe("code-review");
      expect(entry.state).toBe("pending");
      expect(entry.currentPhase).toBe("review");
      expect(entry.path).toBe("src/");
      expect(entry.phases).toHaveLength(1);
      expect(entry.id).toBeTruthy();
      expect(entry.teamId).toBeTruthy();
    });

    it("starts a feature-dev workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "feature-dev",
        path: "extensions/agent-mesh/",
      });

      expect(entry.name).toBe("feature-dev");
      expect(entry.phases).toHaveLength(4);
      expect(entry.currentPhase).toBe("explore");
    });

    it("starts a security-review workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "security-review",
      });

      expect(entry.name).toBe("security-review");
      expect(entry.path).toBe(".");
    });

    it("throws for unknown workflow", async () => {
      const { orchestrator } = createOrchestrator();

      await expect(orchestrator.startWorkflow({ workflowName: "nonexistent" })).rejects.toThrow(
        /Unknown workflow/,
      );
    });

    it("interpolates ${path} in agent tasks", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
        path: "my/path",
      });

      expect(entry.phases[0].agents[0].task).toContain("my/path");
      expect(entry.phases[0].agents[0].task).not.toContain("${path}");
    });

    it("uses default path when not specified", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
      });

      expect(entry.path).toBe(".");
    });
  });

  describe("getWorkflow", () => {
    it("returns null for non-existent workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const result = await orchestrator.getWorkflow("nonexistent");
      expect(result).toBeNull();
    });

    it("reconstructs workflow from triples", async () => {
      const { orchestrator } = createOrchestrator();

      const created = await orchestrator.startWorkflow({
        workflowName: "code-review",
        path: "src/",
      });

      const fetched = await orchestrator.getWorkflow(created.id);
      expect(fetched).not.toBeNull();
      expect(fetched!.name).toBe("code-review");
      expect(fetched!.state).toBe("pending");
      expect(fetched!.path).toBe("src/");
    });
  });

  describe("listWorkflowRuns", () => {
    it("lists all workflow runs", async () => {
      const { orchestrator } = createOrchestrator();

      await orchestrator.startWorkflow({ workflowName: "code-review" });
      await orchestrator.startWorkflow({ workflowName: "security-review" });

      const runs = await orchestrator.listWorkflowRuns();
      expect(runs).toHaveLength(2);
      expect(runs.map((r) => r.name).sort()).toEqual(["code-review", "security-review"]);
    });

    it("returns empty array when no runs exist", async () => {
      const { orchestrator } = createOrchestrator();

      const runs = await orchestrator.listWorkflowRuns();
      expect(runs).toHaveLength(0);
    });

    it("reflects correct state for each run", async () => {
      const { orchestrator } = createOrchestrator();

      const entry1 = await orchestrator.startWorkflow({ workflowName: "code-review" });
      const entry2 = await orchestrator.startWorkflow({ workflowName: "security-review" });

      // Execute and complete one, fail the other
      await orchestrator.executeNextPhase(entry1.id);
      await orchestrator.failWorkflow(entry2.id, "timeout");

      const runs = await orchestrator.listWorkflowRuns();
      const run1 = runs.find((r) => r.id === entry1.id);
      const run2 = runs.find((r) => r.id === entry2.id);

      expect(run1!.state).toBe("completed");
      expect(run2!.state).toBe("failed");
    });
  });

  describe("executeNextPhase", () => {
    it("executes a single-phase workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
        path: "src/",
      });

      const result = await orchestrator.executeNextPhase(entry.id);
      expect(result).not.toBeNull();
      expect(result!.phase).toBe("review");
      expect(result!.status).toBe("completed");
      expect(result!.agentResults.length).toBeGreaterThan(0);
    });

    it("returns null for completed workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
      });

      await orchestrator.executeNextPhase(entry.id);

      // Workflow should now be completed
      const fetched = await orchestrator.getWorkflow(entry.id);
      expect(fetched!.state).toBe("completed");

      const result = await orchestrator.executeNextPhase(entry.id);
      expect(result).toBeNull();
    });

    it("advances through multi-phase workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "feature-dev",
        path: "src/",
      });

      // Phase 1: explore
      const phase1 = await orchestrator.executeNextPhase(entry.id);
      expect(phase1!.phase).toBe("explore");

      // Phase 2: design
      const phase2 = await orchestrator.executeNextPhase(entry.id);
      expect(phase2!.phase).toBe("design");

      // Phase 3: review
      const phase3 = await orchestrator.executeNextPhase(entry.id);
      expect(phase3!.phase).toBe("review");

      // Phase 4: implement
      const phase4 = await orchestrator.executeNextPhase(entry.id);
      expect(phase4!.phase).toBe("implement");

      // Should be completed now
      const fetched = await orchestrator.getWorkflow(entry.id);
      expect(fetched!.state).toBe("completed");
    });

    it("throws for non-existent workflow", async () => {
      const { orchestrator } = createOrchestrator();

      await expect(orchestrator.executeNextPhase("ghost")).rejects.toThrow(/not found/);
    });
  });

  describe("completeWorkflow", () => {
    it("computes final result for completed workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
      });

      await orchestrator.executeNextPhase(entry.id);
      const result = await orchestrator.completeWorkflow(entry.id);

      expect(result.summary).toContain("code-review");
      expect(result.summary).toContain("completed");
      expect(result.totalPhases).toBe(1);
      expect(result.phaseResults).toHaveLength(1);
    });

    it("computes correct aggregates for multi-phase workflow", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "feature-dev",
        path: "src/",
      });

      // Run all 4 phases
      await orchestrator.executeNextPhase(entry.id);
      await orchestrator.executeNextPhase(entry.id);
      await orchestrator.executeNextPhase(entry.id);
      await orchestrator.executeNextPhase(entry.id);

      const result = await orchestrator.completeWorkflow(entry.id);

      expect(result.totalPhases).toBe(4);
      expect(result.completedPhases).toBe(4);
      expect(result.phaseResults).toHaveLength(4);
      expect(result.totalAgents).toBeGreaterThan(0);
      expect(result.duration).toBeGreaterThanOrEqual(0);
    });

    it("handles workflow with no executed phases", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
      });

      // Complete without executing any phases — should still produce a result
      const result = await orchestrator.completeWorkflow(entry.id);

      expect(result.totalPhases).toBe(1);
      expect(result.completedPhases).toBe(0);
      expect(result.phaseResults).toHaveLength(0);
      expect(result.totalFindings).toBe(0);
      expect(result.totalConflicts).toBe(0);
    });

    it("throws for non-existent workflow", async () => {
      const { orchestrator } = createOrchestrator();

      await expect(orchestrator.completeWorkflow("ghost")).rejects.toThrow(/not found/);
    });
  });

  describe("failWorkflow", () => {
    it("marks workflow as failed", async () => {
      const { orchestrator } = createOrchestrator();

      const entry = await orchestrator.startWorkflow({
        workflowName: "code-review",
      });

      await orchestrator.failWorkflow(entry.id, "Agent timeout");

      const fetched = await orchestrator.getWorkflow(entry.id);
      expect(fetched!.state).toBe("failed");
      expect(fetched!.result).toBeTruthy();
      expect(fetched!.result!.summary).toContain("Agent timeout");
    });
  });
});

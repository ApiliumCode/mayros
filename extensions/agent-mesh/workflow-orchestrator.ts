/**
 * Workflow Orchestrator
 *
 * Multi-phase workflow engine with Cortex state tracking.
 * Phase-sequential, agent-parallel: within a phase agents run in parallel
 * via TeamManager; between phases execution is sequential.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import type { AgentMailbox } from "./agent-mailbox.js";
import type { BackgroundTracker } from "./background-tracker.js";
import type { KnowledgeFusion } from "./knowledge-fusion.js";
import type { NamespaceManager } from "./namespace-manager.js";
import { TeamManager } from "./team-manager.js";
import { getWorkflow, listWorkflows as listDefs } from "./workflows/registry.js";
import type { TaskRouter } from "./task-router.js";
import type { ConsensusEngine } from "./consensus-engine.js";
import type { PerformanceTracker } from "./performance-tracker.js";
import type {
  PhaseResult,
  RoutingDecisionEntry,
  ConsensusResultEntry,
  WorkflowEntry,
  WorkflowResult,
  WorkflowState,
} from "./workflows/types.js";

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_PHASE_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes
const POLL_INITIAL_INTERVAL_MS = 1_000; // 1 second
const POLL_MAX_INTERVAL_MS = 10_000; // 10 seconds

// ============================================================================
// Triple helpers
// ============================================================================

function wfSubject(ns: string, workflowId: string): string {
  return `${ns}:workflow:${workflowId}`;
}

function wfPredicate(ns: string, field: string): string {
  return `${ns}:workflow:${field}`;
}

// ============================================================================
// WorkflowOrchestrator
// ============================================================================

export class WorkflowOrchestrator {
  private readonly teamMgr: TeamManager;

  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    teamMgr: TeamManager,
    private readonly fusion: KnowledgeFusion,
    private readonly nsMgr: NamespaceManager,
    private readonly mailbox?: AgentMailbox,
    private readonly bgTracker?: BackgroundTracker,
    private readonly phaseTimeoutMs: number = DEFAULT_PHASE_TIMEOUT_MS,
    private readonly taskRouter?: TaskRouter,
    private readonly consensusEngine?: ConsensusEngine,
    private readonly perfTracker?: PerformanceTracker,
  ) {
    this.teamMgr = teamMgr;
  }

  /**
   * Start a new workflow run from a registered definition.
   */
  async startWorkflow(opts: {
    workflowName: string;
    path?: string;
    config?: Record<string, unknown>;
  }): Promise<WorkflowEntry> {
    const def = getWorkflow(opts.workflowName);
    if (!def) {
      const available = listDefs()
        .map((d) => d.name)
        .join(", ");
      throw new Error(`Unknown workflow "${opts.workflowName}". Available: ${available}`);
    }

    const workflowId = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const targetPath = opts.path ?? ".";
    const config = opts.config ?? {};

    // Interpolate ${path} in agent task templates and apply Miteru routing
    const phases = await Promise.all(
      def.phases.map(async (phase) => {
        const agents = await Promise.all(
          phase.agents.map(async (agent) => {
            const interpolatedTask = agent.task.replace(/\$\{path\}/g, targetPath);

            // Miteru routing: select best agent for this task
            if (this.taskRouter) {
              const available = phase.agents.map((a) => a.agentId);
              try {
                const decision = await this.taskRouter.selectAgent(
                  interpolatedTask,
                  available,
                  targetPath,
                );
                return {
                  ...agent,
                  task: interpolatedTask,
                  routingId: decision.routingId,
                  routedAgentId: decision.agentId,
                };
              } catch {
                // Fallback to hardcoded agent
              }
            }

            return { ...agent, task: interpolatedTask };
          }),
        );
        return { ...phase, agents };
      }),
    );

    const firstPhase = phases[0]?.name ?? "done";

    // Create team for the first phase
    const teamMembers =
      phases[0]?.agents.map((a) => ({
        agentId: a.agentId,
        role: a.role,
        task: a.task,
      })) ?? [];

    const team = await this.teamMgr.createTeam({
      name: `${opts.workflowName}-${workflowId}`,
      strategy: phases[0]?.strategy ?? def.defaultStrategy,
      members: teamMembers,
    });

    // Store workflow state as triples
    const subject = wfSubject(this.ns, workflowId);
    const fields: Array<[string, string]> = [
      ["name", def.name],
      ["definition", def.name],
      ["createdAt", now],
      ["updatedAt", now],
      ["state", "pending"],
      ["currentPhase", firstPhase],
      ["teamId", team.id],
      ["path", targetPath],
      ["config", JSON.stringify(config)],
    ];

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: wfPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id: workflowId,
      name: def.name,
      definition: def.name,
      state: "pending",
      currentPhase: firstPhase,
      teamId: team.id,
      path: targetPath,
      config,
      phases,
      phaseResults: {},
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Get a workflow run by ID.
   */
  async getWorkflow(workflowId: string): Promise<WorkflowEntry | null> {
    const subject = wfSubject(this.ns, workflowId);
    const result = await this.client.listTriples({ subject, limit: 200 });

    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const phaseResults: Record<string, PhaseResult> = {};
    const phaseResultPrefix = wfPredicate(this.ns, "phaseResult:");

    for (const t of result.triples) {
      const pred = String(t.predicate);
      const val =
        typeof t.object === "object" && t.object !== null && "node" in t.object
          ? String((t.object as { node: string }).node)
          : String(t.object);

      if (pred.startsWith(phaseResultPrefix)) {
        const phaseName = pred.slice(phaseResultPrefix.length);
        try {
          phaseResults[phaseName] = JSON.parse(val) as PhaseResult;
        } catch {
          // Skip malformed
        }
      } else {
        const prefix = `${this.ns}:workflow:`;
        if (pred.startsWith(prefix)) {
          fields[pred.slice(prefix.length)] = val;
        }
      }
    }

    // Reconstruct phases from definition
    const def = getWorkflow(fields.definition ?? fields.name ?? "");
    const targetPath = fields.path ?? ".";
    const phases = def
      ? def.phases.map((phase) => ({
          ...phase,
          agents: phase.agents.map((agent) => ({
            ...agent,
            task: agent.task.replace(/\$\{path\}/g, targetPath),
          })),
        }))
      : [];

    let config: Record<string, unknown> = {};
    if (fields.config) {
      try {
        config = JSON.parse(fields.config) as Record<string, unknown>;
      } catch {
        // Skip malformed
      }
    }

    const entry: WorkflowEntry = {
      id: workflowId,
      name: fields.name ?? "",
      definition: fields.definition ?? "",
      state: (fields.state as WorkflowState) ?? "pending",
      currentPhase: fields.currentPhase ?? "done",
      teamId: fields.teamId ?? "",
      path: targetPath,
      config,
      phases,
      phaseResults,
      createdAt: fields.createdAt ?? "",
      updatedAt: fields.updatedAt ?? "",
    };

    if (fields.result) {
      try {
        entry.result = JSON.parse(fields.result) as WorkflowResult;
      } catch {
        // Skip malformed
      }
    }

    return entry;
  }

  /**
   * List all workflow runs (summary view).
   */
  async listWorkflowRuns(): Promise<
    Array<{ id: string; name: string; state: string; updatedAt: string }>
  > {
    const result = await this.client.patternQuery({
      predicate: wfPredicate(this.ns, "name"),
      limit: 200,
    });

    const runs: Array<{ id: string; name: string; state: string; updatedAt: string }> = [];
    const prefix = `${this.ns}:workflow:`;

    for (const match of result.matches) {
      const subject = String(match.subject);
      if (!subject.startsWith(prefix)) continue;

      const workflowId = subject.slice(prefix.length);
      const name =
        typeof match.object === "object" && match.object !== null && "node" in match.object
          ? String((match.object as { node: string }).node)
          : String(match.object);

      // Fetch state and updatedAt
      const stateResult = await this.client.listTriples({
        subject,
        predicate: wfPredicate(this.ns, "state"),
        limit: 1,
      });
      const updatedResult = await this.client.listTriples({
        subject,
        predicate: wfPredicate(this.ns, "updatedAt"),
        limit: 1,
      });

      const stateObj = stateResult.triples[0]?.object;
      const state =
        stateObj != null
          ? typeof stateObj === "string"
            ? stateObj
            : JSON.stringify(stateObj)
          : "pending";
      const updatedObj = updatedResult.triples[0]?.object;
      const updatedAt =
        updatedObj != null
          ? typeof updatedObj === "string"
            ? updatedObj
            : JSON.stringify(updatedObj)
          : "";

      runs.push({ id: workflowId, name, state, updatedAt });
    }

    return runs;
  }

  /**
   * Execute the next phase of a workflow.
   * Returns the phase result, or null if workflow is already done.
   */
  async executeNextPhase(workflowId: string): Promise<PhaseResult | null> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    if (workflow.state === "completed" || workflow.state === "failed") {
      return null;
    }

    const currentPhaseIdx = workflow.phases.findIndex((p) => p.name === workflow.currentPhase);
    if (currentPhaseIdx < 0) return null;

    const phase = workflow.phases[currentPhaseIdx];
    const startTime = Date.now();

    // Update state to running
    await this.updateField(workflowId, "state", "running");
    await this.updateField(workflowId, "updatedAt", new Date().toISOString());

    // Update team members to running
    await this.teamMgr.updateTeamStatus(workflow.teamId, "running");
    for (const agent of phase.agents) {
      await this.teamMgr.updateMemberStatus(workflow.teamId, agent.agentId, "running");
    }

    // Dispatch tasks via AgentMailbox and track with BackgroundTracker when available.
    // Falls back to marking agents completed immediately when neither is present (e.g. tests).
    if (this.mailbox && this.bgTracker) {
      // Map agentId → background task id so we can poll for completion
      const taskIds: Map<string, string> = new Map();

      for (const agent of phase.agents) {
        // Send the task to the agent's inbox as a "task" message
        await this.mailbox.send({
          from: `workflow:${workflowId}`,
          to: agent.agentId,
          content: agent.task,
          type: "task",
        });

        // Register in BackgroundTracker so progress is observable
        const bgTask = await this.bgTracker.track({
          agentId: agent.agentId,
          description: `[workflow:${workflowId}] phase:${phase.name} role:${agent.role}`,
          status: "running",
        });

        taskIds.set(agent.agentId, bgTask.id);
      }

      // Poll for all agent tasks to reach a terminal status
      const deadline = Date.now() + this.phaseTimeoutMs;
      let pollIntervalMs = POLL_INITIAL_INTERVAL_MS;
      const pendingAgents = new Set(phase.agents.map((a) => a.agentId));

      while (pendingAgents.size > 0 && Date.now() < deadline) {
        await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
        // Exponential backoff capped at max interval
        pollIntervalMs = Math.min(pollIntervalMs * 2, POLL_MAX_INTERVAL_MS);

        for (const agentId of pendingAgents) {
          const taskId = taskIds.get(agentId);
          if (!taskId) {
            pendingAgents.delete(agentId);
            continue;
          }
          const task = await this.bgTracker.getTask(taskId);
          if (!task) {
            pendingAgents.delete(agentId);
            continue;
          }
          if (
            task.status === "completed" ||
            task.status === "failed" ||
            task.status === "cancelled"
          ) {
            pendingAgents.delete(agentId);
            const memberStatus = task.status === "completed" ? "completed" : "failed";
            await this.teamMgr.updateMemberStatus(
              workflow.teamId,
              agentId,
              memberStatus,
              task.result ?? `Task ${task.status}`,
            );
          }
        }
      }

      // Any agents still pending after the deadline are timed out
      for (const agentId of pendingAgents) {
        const taskId = taskIds.get(agentId);
        if (taskId) {
          await this.bgTracker.updateStatus(taskId, "failed", "timed_out");
        }
        await this.teamMgr.updateMemberStatus(workflow.teamId, agentId, "failed", "timed_out");
      }
    } else {
      // Fallback: no mailbox/tracker available — mark all agents completed with a warning
      const hasMailbox = Boolean(this.mailbox);
      const hasTracker = Boolean(this.bgTracker);
      const missing = [!hasMailbox && "AgentMailbox", !hasTracker && "BackgroundTracker"]
        .filter(Boolean)
        .join(", ");
      // Use a simple console.warn since we may not have a logger here
      console.warn(
        `[WorkflowOrchestrator] ${missing} not available — agent tasks for phase "${phase.name}" ` +
          `of workflow "${workflowId}" will be marked completed without real dispatch.`,
      );
      for (const agent of phase.agents) {
        await this.teamMgr.updateMemberStatus(
          workflow.teamId,
          agent.agentId,
          "completed",
          `Completed ${agent.role} analysis`,
        );
      }
    }

    // Merge results
    await this.updateField(workflowId, "state", "merging");
    const mergeResult = await this.teamMgr.mergeTeamResults(workflow.teamId);

    // Record routing rewards and performance outcomes
    const routingDecisions: RoutingDecisionEntry[] = [];
    for (const agent of phase.agents) {
      const memberResult = mergeResult.memberResults.find((m) => m.agentId === agent.agentId);

      // Record performance outcome
      if (this.perfTracker && memberResult) {
        await this.perfTracker.recordOutcome({
          agentId: agent.agentId,
          completed: true,
          durationMs: Date.now() - startTime,
          costUsd: 0, // cost tracking happens in token-economy
          findings: memberResult.findings,
          conflicts: mergeResult.conflicts,
        });
      }

      // Record routing reward
      if (this.taskRouter && agent.routingId) {
        const reward = this.taskRouter.computeReward({
          completed: true,
          findings: memberResult?.findings ?? 0,
          conflicts: mergeResult.conflicts,
          durationMs: Date.now() - startTime,
          costUsd: 0,
        });
        await this.taskRouter.recordReward(agent.routingId, reward);

        routingDecisions.push({
          routingId: agent.routingId,
          originalAgentId: agent.agentId,
          routedAgentId: agent.routedAgentId ?? agent.agentId,
          stateKey: "",
          confidence: 0,
          reason: `reward=${reward.total.toFixed(3)}`,
        });
      }
    }

    // Kimeru consensus: resolve conflicts if engine is available
    let consensusResults: ConsensusResultEntry[] | undefined;
    if (this.consensusEngine && mergeResult.conflicts > 0) {
      try {
        // Detect conflicts between agent namespaces
        const agentNs = phase.agents.map((a) => `${this.ns}:agent:${a.agentId}`);
        if (agentNs.length >= 2) {
          const conflicts = await this.fusion.detectConflicts(agentNs[0]!, agentNs[1]!);
          if (conflicts.length > 0) {
            const agentIdByNs: Record<string, string> = {};
            for (const a of phase.agents) {
              agentIdByNs[`${this.ns}:agent:${a.agentId}`] = a.agentId;
            }
            const results = await this.consensusEngine.resolvePhaseConflicts(
              conflicts,
              agentIdByNs,
              "weighted",
            );
            consensusResults = results.map((r) => ({
              id: r.id,
              resolved: r.resolved,
              strategy: r.strategy,
              confidence: r.confidence,
              resolvedCount: r.breakdown.resolvedCount,
              totalConflicts: r.breakdown.totalConflicts,
            }));
          }
        }
      } catch {
        // Consensus failure doesn't block workflow
      }
    }

    const phaseResult: PhaseResult = {
      phase: phase.name,
      status: "completed",
      agentResults: mergeResult.memberResults,
      conflicts: mergeResult.conflicts,
      duration: Date.now() - startTime,
      completedAt: new Date().toISOString(),
      routingDecisions: routingDecisions.length > 0 ? routingDecisions : undefined,
      consensusResults,
    };

    // Store phase result
    await this.client.createTriple({
      subject: wfSubject(this.ns, workflowId),
      predicate: wfPredicate(this.ns, `phaseResult:${phase.name}`),
      object: JSON.stringify(phaseResult),
    });

    // Advance to next phase or complete
    const nextPhaseIdx = currentPhaseIdx + 1;
    if (nextPhaseIdx < workflow.phases.length) {
      const nextPhase = workflow.phases[nextPhaseIdx];
      await this.updateField(workflowId, "currentPhase", nextPhase.name);
      await this.updateField(workflowId, "state", "running");

      // Create new team for next phase
      const nextTeam = await this.teamMgr.createTeam({
        name: `${workflow.name}-${workflowId}-${nextPhase.name}`,
        strategy: nextPhase.strategy,
        members: nextPhase.agents.map((a) => ({
          agentId: a.agentId,
          role: a.role,
          task: a.task,
        })),
      });
      await this.updateField(workflowId, "teamId", nextTeam.id);
    } else {
      await this.updateField(workflowId, "currentPhase", "done");
      await this.updateField(workflowId, "state", "completed");
    }

    await this.updateField(workflowId, "updatedAt", new Date().toISOString());
    return phaseResult;
  }

  /**
   * Complete a workflow, computing the final result.
   */
  async completeWorkflow(workflowId: string): Promise<WorkflowResult> {
    const workflow = await this.getWorkflow(workflowId);
    if (!workflow) {
      throw new Error(`Workflow ${workflowId} not found`);
    }

    const phaseResults = Object.values(workflow.phaseResults);
    const totalFindings = phaseResults.reduce(
      (sum, pr) => sum + pr.agentResults.reduce((s, ar) => s + ar.findings, 0),
      0,
    );
    const totalConflicts = phaseResults.reduce((sum, pr) => sum + pr.conflicts, 0);
    const totalAgents = phaseResults.reduce((sum, pr) => sum + pr.agentResults.length, 0);
    const totalDuration = phaseResults.reduce((sum, pr) => sum + pr.duration, 0);

    const result: WorkflowResult = {
      summary: `Workflow "${workflow.name}" completed: ${phaseResults.length} phase(s), ${totalAgents} agent(s), ${totalFindings} finding(s)`,
      totalPhases: workflow.phases.length,
      completedPhases: phaseResults.filter((pr) => pr.status === "completed").length,
      totalAgents,
      totalFindings,
      totalConflicts,
      duration: totalDuration,
      phaseResults,
    };

    await this.updateField(workflowId, "result", JSON.stringify(result));
    await this.updateField(workflowId, "state", "completed");
    await this.updateField(workflowId, "updatedAt", new Date().toISOString());

    return result;
  }

  /**
   * Mark a workflow as failed.
   */
  async failWorkflow(workflowId: string, error: string): Promise<void> {
    await this.updateField(workflowId, "state", "failed");
    await this.updateField(workflowId, "updatedAt", new Date().toISOString());

    const result: WorkflowResult = {
      summary: `Workflow failed: ${error}`,
      totalPhases: 0,
      completedPhases: 0,
      totalAgents: 0,
      totalFindings: 0,
      totalConflicts: 0,
      duration: 0,
      phaseResults: [],
    };
    await this.updateField(workflowId, "result", JSON.stringify(result));
  }

  // ---------- internal helpers ----------

  private async updateField(workflowId: string, field: string, value: string): Promise<void> {
    const subject = wfSubject(this.ns, workflowId);
    const predicate = wfPredicate(this.ns, field);

    const existing = await this.client.listTriples({
      subject,
      predicate,
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    await this.client.createTriple({ subject, predicate, object: value });
  }
}

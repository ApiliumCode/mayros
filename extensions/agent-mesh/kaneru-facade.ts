/**
 * Kaneru Facade.
 *
 * Unified entry point for CLI and MCP tools to access multi-agent
 * coordination services (squads, consensus, routing, delegation,
 * knowledge fusion, and mailbox).
 *
 * Wraps agent-mesh internals behind a clean interface using Kaneru
 * terminology: squads, missions, directives, chain, fuel, dojo,
 * distributed sync, and channel operations.
 */

import { CortexClient } from "../shared/cortex-client.js";
import { NamespaceManager } from "./namespace-manager.js";
import { KnowledgeFusion } from "./knowledge-fusion.js";
import { TeamManager } from "./team-manager.js";
import { AgentMailbox } from "./agent-mailbox.js";
import type { MailMessageType } from "./agent-mailbox.js";
import { BackgroundTracker } from "./background-tracker.js";
import { WorkflowOrchestrator } from "./workflow-orchestrator.js";
import { TaskRouter } from "./task-router.js";
import { PerformanceTracker } from "./performance-tracker.js";
import { ConsensusEngine } from "./consensus-engine.js";
import { DelegationEngine } from "./delegation-engine.js";
import { TeamDashboardService } from "./team-dashboard.js";
import { LearningProfileManager } from "../kaneru/learning-profiles.js";
import type { LearningProfile } from "../kaneru/learning-profiles.js";
import { DecisionHistory } from "../kaneru/decision-history.js";
import type {
  DecisionRecord,
  DecisionContext,
  ConsensusResultLike,
} from "../kaneru/decision-history.js";
import { KnowledgeTransferService } from "../kaneru/knowledge-transfer.js";
import type { TransferResult } from "../kaneru/knowledge-transfer.js";
import { DojoService } from "../kaneru/dojo.js";
import type { DojoTemplate, DojoInstallResult } from "../kaneru/dojo.js";
import { ChannelOpsService } from "../kaneru/channel-ops.js";
import type { ChannelNotification } from "../kaneru/channel-ops.js";
import { DistributedVentureManager } from "../kaneru/distributed.js";
import type { SyncResult } from "../kaneru/distributed.js";
import { MissionCommentService } from "../kaneru/mission-comments.js";
import type { MissionComment } from "../kaneru/mission-comments.js";
import { ProjectManager } from "../kaneru/project.js";
import type { Project, ProjectCreateOpts } from "../kaneru/project.js";
import { CostAnalyticsService } from "../kaneru/cost-analytics.js";
import type { CostAnalytics } from "../kaneru/cost-analytics.js";
import { VentureManager } from "../kaneru/venture.js";
import { ChainManager } from "../kaneru/chain.js";
import { DirectiveManager } from "../kaneru/directives.js";
import { randomUUID } from "node:crypto";
import type { MergeStrategy } from "./mesh-protocol.js";
import type { ConsensusStrategy } from "./consensus-engine.js";

// ============================================================================
// Types
// ============================================================================

export type KaneruFacadeOptions = {
  host?: string;
  port?: number | string;
  token?: string;
  namespace?: string;
};

export type SquadCreateOptions = {
  name: string;
  agents: Array<{ agentId: string; role: string; task?: string }>;
  strategy?: MergeStrategy;
};

export type RoutingResult = {
  agentId: string;
  confidence: number;
  taskType: string;
  complexity: string;
  domain: string;
  routingId: string;
};

export type KaneruDashboardData = {
  squads: Array<{
    id: string;
    name: string;
    status: string;
    memberCount: number;
    updatedAt: string;
  }>;
  routeTable: Array<{
    stateKey: string;
    agentId: string;
    qValue: number;
  }>;
  stats: {
    activeSquads: number;
    qTableSize: number;
    epsilon: number;
  };
};

// ============================================================================
// Facade
// ============================================================================

export class KaneruFacade {
  private readonly client: CortexClient;
  private readonly ns: string;
  private readonly nsMgr: NamespaceManager;
  private readonly fusion: KnowledgeFusion;
  private readonly teamMgr: TeamManager;
  private readonly mailbox: AgentMailbox;
  private readonly bgTracker: BackgroundTracker;
  private readonly perfTracker: PerformanceTracker;
  private readonly taskRouter: TaskRouter;
  private readonly consensus: ConsensusEngine;
  private readonly delegation: DelegationEngine;
  private readonly orchestrator: WorkflowOrchestrator;
  private readonly dashboard: TeamDashboardService;
  private readonly learningProfiles: LearningProfileManager;
  private readonly decisionHistory: DecisionHistory;
  private readonly knowledgeTransfer: KnowledgeTransferService;
  private readonly dojo: DojoService;
  private readonly channelOps: ChannelOpsService;
  private readonly distributed: DistributedVentureManager;
  private readonly comments: MissionCommentService;
  private readonly projects: ProjectManager;
  private readonly costAnalyticsSvc: CostAnalyticsService;

  constructor(opts: KaneruFacadeOptions) {
    const host = opts.host ?? "127.0.0.1";
    const port = typeof opts.port === "string" ? parseInt(opts.port, 10) : (opts.port ?? 19090);
    this.ns = opts.namespace ?? "mayros";

    this.client = new CortexClient({
      host,
      port,
      authToken: opts.token,
    });

    this.nsMgr = new NamespaceManager(this.client, this.ns, 100);
    this.fusion = new KnowledgeFusion(this.client, this.ns);
    this.teamMgr = new TeamManager(this.client, this.ns, this.nsMgr, this.fusion, {
      maxTeamSize: 20,
      defaultStrategy: "additive",
      workflowTimeout: 600_000,
    });
    this.mailbox = new AgentMailbox(this.client, this.ns);
    this.bgTracker = new BackgroundTracker(this.client, this.ns);
    this.perfTracker = new PerformanceTracker(this.client, this.ns);
    this.taskRouter = new TaskRouter(this.client, this.ns, this.perfTracker);
    this.consensus = new ConsensusEngine(this.client, this.ns, this.perfTracker);
    this.delegation = new DelegationEngine(this.client, this.ns, this.nsMgr);
    this.orchestrator = new WorkflowOrchestrator(
      this.client,
      this.ns,
      this.teamMgr,
      this.fusion,
      this.nsMgr,
      this.mailbox,
      this.bgTracker,
      undefined,
      this.taskRouter,
      this.consensus,
      this.perfTracker,
    );
    this.dashboard = new TeamDashboardService(this.teamMgr, this.mailbox, null, this.ns);
    this.learningProfiles = new LearningProfileManager(this.client, this.ns);
    this.taskRouter.setLearningProfiles(this.learningProfiles);
    this.decisionHistory = new DecisionHistory(this.client, this.ns);
    this.knowledgeTransfer = new KnowledgeTransferService(
      this.client,
      this.ns,
      this.fusion,
      this.nsMgr,
    );

    const ventureManager = new VentureManager(this.client, this.ns);
    const chainManager = new ChainManager(this.client, this.ns);
    const directiveManager = new DirectiveManager(this.client, this.ns);
    this.dojo = new DojoService(
      this.client,
      this.ns,
      ventureManager,
      chainManager,
      directiveManager,
    );
    this.channelOps = new ChannelOpsService(this.ns);
    this.distributed = new DistributedVentureManager(this.client, this.ns);
    this.comments = new MissionCommentService(this.client, this.ns);
    this.projects = new ProjectManager(this.client, this.ns);
    this.costAnalyticsSvc = new CostAnalyticsService(this.client, this.ns);
  }

  /** Create a squad (team) of agents for coordinated missions. */
  async squadCreate(opts: SquadCreateOptions) {
    return this.teamMgr.createTeam({
      name: opts.name,
      members: opts.agents.map((a) => ({
        agentId: a.agentId,
        role: a.role,
        task: a.task ?? "",
      })),
      strategy: opts.strategy ?? "additive",
    });
  }

  /** Start a workflow run on a squad. */
  async squadRun(squadId: string, mission: string) {
    return this.orchestrator.startWorkflow({
      workflowName: mission,
      config: { squadId },
    });
  }

  /** Get squad status. */
  async squadStatus(squadId: string) {
    return this.teamMgr.getTeam(squadId);
  }

  /** List all squads. */
  async squadList() {
    return this.teamMgr.listTeams();
  }

  /** Delegate a mission from one agent to another. */
  async delegate(from: string, to: string, mission: string) {
    const ctx = await this.delegation.prepareContext(mission, from);
    this.delegation.injectContext(to, ctx);
    return ctx;
  }

  /** Run consensus on a question across a squad. */
  async consensusResolve(opts: {
    squadId: string;
    question: string;
    strategy?: ConsensusStrategy;
  }) {
    const squad = await this.teamMgr.getTeam(opts.squadId);
    if (!squad) {
      throw new Error(`Squad not found: ${opts.squadId}`);
    }
    const agentIds = squad.members.map((m) => m.agentId);
    const result = await this.consensus.resolve({
      id: `consensus-${randomUUID()}`,
      conflicts: [
        {
          subject: opts.question,
          predicate: `${this.ns}:consensus:question`,
          values: ["approve", "reject"],
          namespaces: agentIds.map((id) => `${this.ns}:agent:${id}`),
        },
      ],
      agentIds,
      strategy: opts.strategy ?? "weighted",
    });

    // Auto-record decision for audit trail
    try {
      await this.decisionHistory.record(result);
    } catch {
      // Non-fatal: decision recording failure should not block consensus
    }

    return result;
  }

  /** Route a mission to the best agent via Q-learning. */
  async route(mission: string, available?: string[], path?: string): Promise<RoutingResult> {
    const agents = available ?? [];
    const decision = await this.taskRouter.selectAgent(mission, agents, path);
    // stateKey format is "taskType:complexity:domain" (empty when overridden/single agent)
    const parts = decision.stateKey.split(":");
    return {
      agentId: decision.agentId,
      confidence: decision.confidence,
      taskType: parts[0] ?? "unknown",
      complexity: parts[1] ?? "unknown",
      domain: parts[2] ?? "unknown",
      routingId: decision.routingId,
    };
  }

  /** Merge knowledge between two namespaces. */
  async fuse(sourceNs: string, targetNs: string, strategy?: MergeStrategy) {
    return this.fusion.merge(sourceNs, targetNs, strategy ?? "additive");
  }

  /** Send a message between agents. */
  async mailboxSend(from: string, to: string, content: string, type?: string) {
    return this.mailbox.send({
      from,
      to,
      content,
      type: (type ?? "info") as MailMessageType,
    });
  }

  /** Check an agent's inbox. */
  async mailboxCheck(agentId: string) {
    return this.mailbox.inbox({ agent: agentId, status: "unread" });
  }

  /** Get agent mailbox stats. */
  async mailboxStats(agentId: string) {
    return this.mailbox.stats(agentId);
  }

  // ---- Mission Lifecycle Orchestration ----

  /**
   * Complete a mission with full lifecycle orchestration:
   * 1. Record learning profile outcome
   * 2. Transfer knowledge to shared namespace
   * 3. Build channel notification
   *
   * Returns the notification message for the caller to deliver.
   */
  async completeMissionWithLearning(opts: {
    missionId: string;
    agentId: string;
    title: string;
    success: boolean;
    durationMs: number;
    ventureId: string;
    squadId?: string;
  }): Promise<{ profile: LearningProfile; notification: ChannelNotification }> {
    // 1. Record learning outcome
    const profile = await this.learningProfiles.recordOutcome({
      missionId: opts.missionId,
      agentId: opts.agentId,
      title: opts.title,
      success: opts.success,
      durationMs: opts.durationMs,
    });

    // 2. Transfer knowledge (best-effort)
    try {
      await this.knowledgeTransfer.transferOnComplete(opts.agentId, opts.missionId, opts.squadId);
    } catch {
      // Non-fatal: knowledge transfer failure should not block completion
    }

    // 3. Build notification
    const notification = this.channelOps.buildMissionReport(
      {
        id: opts.missionId,
        identifier: opts.missionId,
        title: opts.title,
        ventureId: opts.ventureId,
        status: opts.success ? "complete" : "abandoned",
      } as import("../kaneru/mission.js").Mission,
      {
        missionId: opts.missionId,
        agentId: opts.agentId,
        title: opts.title,
        success: opts.success,
        durationMs: opts.durationMs,
      },
    );

    return { profile, notification };
  }

  // ---- Learning Profiles ----

  /** Get all learning profiles for an agent. */
  async getAgentExpertise(agentId: string): Promise<LearningProfile[]> {
    return this.learningProfiles.getAgentProfiles(agentId);
  }

  /** Get top agents for a given domain and task type. */
  async topAgentsFor(domain: string, taskType: string, limit?: number): Promise<LearningProfile[]> {
    return this.learningProfiles.topAgents(domain, taskType, limit);
  }

  // ---- Knowledge Transfer ----

  /** Transfer knowledge from agent's namespace to shared namespace. */
  async transferKnowledge(
    agentId: string,
    missionId: string,
    squadId?: string,
  ): Promise<TransferResult> {
    return this.knowledgeTransfer.transferOnComplete(agentId, missionId, squadId);
  }

  // ---- Decision History ----

  /** Record a consensus result as a decision. */
  async recordDecision(
    result: ConsensusResultLike,
    context?: DecisionContext,
  ): Promise<DecisionRecord> {
    return this.decisionHistory.record(result, context);
  }

  /** Query decision history. */
  async queryDecisions(opts?: { ventureId?: string; limit?: number }): Promise<DecisionRecord[]> {
    return this.decisionHistory.query(opts);
  }

  /** Get human-readable explanation of a decision. */
  async explainDecision(decisionId: string): Promise<string> {
    return this.decisionHistory.explain(decisionId);
  }

  // ---- Dojo ----

  /** List available Dojo venture templates. */
  async dojoList(): Promise<DojoTemplate[]> {
    return this.dojo.listTemplates();
  }

  /** Preview a Dojo template as a human-readable string. */
  async dojoPreview(templateId: string): Promise<string> {
    return this.dojo.preview(templateId);
  }

  /** Install a Dojo template as a new venture. */
  async dojoInstall(templateId: string, ventureName: string): Promise<DojoInstallResult> {
    return this.dojo.install(templateId, ventureName);
  }

  // ---- Distributed ----

  /** Sync a venture with P2P peers. */
  async syncVenture(ventureId: string): Promise<SyncResult> {
    return this.distributed.syncVenture(ventureId);
  }

  /** List P2P peers for a venture. */
  async listPeers(ventureId: string): Promise<string[]> {
    return this.distributed.listPeers(ventureId);
  }

  /** Auto-discover P2P peers and register them for a venture. */
  async discoverPeers(ventureId: string): Promise<string[]> {
    return this.distributed.discoverPeers(ventureId);
  }

  // ---- Mission Comments ----

  /** Add a comment to a mission. */
  async addComment(missionId: string, author: string, content: string): Promise<MissionComment> {
    return this.comments.add(missionId, author, content);
  }

  /** List comments for a mission. */
  async listComments(missionId: string): Promise<MissionComment[]> {
    return this.comments.list(missionId);
  }

  // ---- Projects ----

  /** Create a new project within a venture. */
  async projectCreate(opts: ProjectCreateOpts): Promise<Project> {
    return this.projects.create(opts);
  }

  /** Get a project by ID. */
  async projectGet(id: string): Promise<Project | null> {
    return this.projects.get(id);
  }

  /** List projects for a venture. */
  async projectList(ventureId: string): Promise<Project[]> {
    return this.projects.list(ventureId);
  }

  /** Update project fields. */
  async projectUpdate(id: string, patch: Partial<Project>): Promise<Project> {
    return this.projects.update(id, patch);
  }

  // ---- Cost Analytics ----

  /** Full cost analytics for a venture. */
  async costAnalysis(
    ventureId: string,
    opts?: { period?: string; fuelLimit?: number },
  ): Promise<CostAnalytics> {
    return this.costAnalyticsSvc.analyze(ventureId, {
      period: (opts?.period as "daily" | "weekly" | "monthly") ?? "daily",
      fuelLimit: opts?.fuelLimit,
    });
  }

  /** Get dashboard summary for all squads. */
  async getDashboard(): Promise<KaneruDashboardData> {
    const summary = await this.dashboard.getSummary();
    const fullTable = this.taskRouter.getRouteTable?.() ?? [];
    const routeTable = fullTable.sort((a, b) => b.qValue - a.qValue).slice(0, 100);
    return {
      squads: summary.teams.map((t) => ({
        id: t.teamId,
        name: t.teamName,
        status: t.teamStatus,
        memberCount: t.members.length,
        updatedAt: t.updatedAt,
      })),
      routeTable,
      stats: {
        activeSquads: summary.activeTeams,
        qTableSize: this.taskRouter.size(),
        epsilon: this.taskRouter.getEpsilon(),
      },
    };
  }

  /** Release all resources. */
  destroy(): void {
    this.client.destroy();
  }
}

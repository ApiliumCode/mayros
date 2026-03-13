/**
 * MCP Resource Provider.
 *
 * Exposes Mayros data as MCP Resources:
 *   - mayros:///agents                     → List of agent definitions
 *   - mayros:///agents/{id}                → Individual agent identity
 *   - mayros:///project/conventions        → Active project conventions
 *   - mayros:///project/conventions/{id}   → Single convention
 *   - mayros:///rules                      → Active rules
 *   - mayros:///rules/{id}                 → Single rule
 *   - mayros:///graph/stats                → Cortex graph statistics
 *   - mayros:///graph/subjects             → Known graph subjects
 *
 * All resources are read-only and returned as JSON or text/markdown.
 */

import type { McpResourceDef, McpResourceContents } from "./protocol.js";
import { McpError, ErrorCodes } from "./protocol.js";

// ============================================================================
// Data Source Interfaces
// ============================================================================

/** Minimal agent definition for resource exposure. */
export type AgentInfo = {
  id: string;
  name: string;
  model?: string;
  allowedTools?: string[];
  isDefault: boolean;
  identity: string;
  origin: "project" | "user";
};

/** Minimal convention for resource exposure. */
export type ConventionInfo = {
  id: string;
  text: string;
  category: string;
  source: string;
  confidence: number;
  status: string;
  createdAt: string;
};

/** Minimal rule for resource exposure. */
export type RuleInfo = {
  id: string;
  content: string;
  scope: string;
  scopeTarget?: string;
  priority: number;
  source: string;
  enabled: boolean;
};

/** Cortex graph statistics. */
export type GraphStatsInfo = {
  tripleCount: number;
  subjectCount: number;
  predicateCount: number;
};

/** DAG tips info for resource exposure. */
export type DagTipsInfo = {
  tips: string[];
  count: number;
};

/** DAG statistics for resource exposure. */
export type DagStatsInfo = {
  actionCount: number;
  tipCount: number;
};

// ============================================================================
// Data Source Callbacks
// ============================================================================

export type ResourceDataSources = {
  listAgents: () => AgentInfo[];
  getAgent: (id: string) => AgentInfo | null;
  listConventions: () => Promise<ConventionInfo[]>;
  getConvention: (id: string) => Promise<ConventionInfo | null>;
  listRules: () => Promise<RuleInfo[]>;
  getRule: (id: string) => Promise<RuleInfo | null>;
  getGraphStats: () => Promise<GraphStatsInfo | null>;
  listGraphSubjects: () => Promise<string[]>;
  getDagTips: () => Promise<DagTipsInfo | null>;
  getDagStats: () => Promise<DagStatsInfo | null>;
};

// ============================================================================
// Resource Provider
// ============================================================================

export class McpResourceProvider {
  private sources: ResourceDataSources;

  constructor(sources: ResourceDataSources) {
    this.sources = sources;
  }

  /** Update data sources (e.g. after plugin reload). */
  updateSources(sources: Partial<ResourceDataSources>): void {
    this.sources = { ...this.sources, ...sources };
  }

  /** List all available resources. */
  async listResources(): Promise<McpResourceDef[]> {
    const resources: McpResourceDef[] = [];

    // Static collection resources
    resources.push({
      uri: "mayros:///agents",
      name: "Agent Definitions",
      description: "List of all agent definitions (.md files)",
      mimeType: "application/json",
    });

    resources.push({
      uri: "mayros:///project/conventions",
      name: "Project Conventions",
      description: "Active project conventions from Cortex knowledge graph",
      mimeType: "application/json",
    });

    resources.push({
      uri: "mayros:///rules",
      name: "Rules",
      description: "Active rules from Cortex rules engine",
      mimeType: "application/json",
    });

    resources.push({
      uri: "mayros:///graph/stats",
      name: "Graph Statistics",
      description: "Cortex knowledge graph statistics",
      mimeType: "application/json",
    });

    resources.push({
      uri: "mayros:///graph/subjects",
      name: "Graph Subjects",
      description: "Known subjects in the Cortex knowledge graph",
      mimeType: "application/json",
    });

    resources.push({
      uri: "mayros:///dag/tips",
      name: "DAG Tips",
      description: "Current DAG tip hashes (frontier of the semantic DAG)",
      mimeType: "application/json",
    });

    resources.push({
      uri: "mayros:///dag/stats",
      name: "DAG Statistics",
      description: "Semantic DAG action count and tip count",
      mimeType: "application/json",
    });

    // Dynamic agent resources
    const agents = this.sources.listAgents();
    for (const agent of agents) {
      resources.push({
        uri: `mayros:///agents/${agent.id}`,
        name: `Agent: ${agent.name}`,
        description: agent.identity.slice(0, 120),
        mimeType: "text/markdown",
      });
    }

    return resources;
  }

  /** Read a single resource by URI. */
  async readResource(uri: string): Promise<McpResourceContents> {
    // Parse the URI
    const path = uri.replace(/^mayros:\/\//, "");

    // ── Agents ────────────────────────────────────────────────────────

    if (path === "/agents") {
      const agents = this.sources.listAgents();
      const summary = agents.map((a) => ({
        id: a.id,
        name: a.name,
        model: a.model,
        isDefault: a.isDefault,
        origin: a.origin,
        toolCount: a.allowedTools?.length ?? 0,
      }));
      return { uri, mimeType: "application/json", text: JSON.stringify(summary, null, 2) };
    }

    const agentMatch = path.match(/^\/agents\/([a-zA-Z][a-zA-Z0-9_.-]*)$/);
    if (agentMatch) {
      const agent = this.sources.getAgent(agentMatch[1]!);
      if (!agent) {
        throw new McpError(ErrorCodes.RESOURCE_NOT_FOUND, `Agent not found: ${agentMatch[1]}`);
      }
      return { uri, mimeType: "text/markdown", text: agent.identity };
    }

    // ── Project conventions ───────────────────────────────────────────

    if (path === "/project/conventions") {
      const conventions = await this.sources.listConventions();
      return { uri, mimeType: "application/json", text: JSON.stringify(conventions, null, 2) };
    }

    const conventionMatch = path.match(/^\/project\/conventions\/(.+)$/);
    if (conventionMatch) {
      const convention = await this.sources.getConvention(conventionMatch[1]!);
      if (!convention) {
        throw new McpError(
          ErrorCodes.RESOURCE_NOT_FOUND,
          `Convention not found: ${conventionMatch[1]}`,
        );
      }
      return { uri, mimeType: "application/json", text: JSON.stringify(convention, null, 2) };
    }

    // ── Rules ─────────────────────────────────────────────────────────

    if (path === "/rules") {
      const rules = await this.sources.listRules();
      return { uri, mimeType: "application/json", text: JSON.stringify(rules, null, 2) };
    }

    const ruleMatch = path.match(/^\/rules\/(.+)$/);
    if (ruleMatch) {
      const rule = await this.sources.getRule(ruleMatch[1]!);
      if (!rule) {
        throw new McpError(ErrorCodes.RESOURCE_NOT_FOUND, `Rule not found: ${ruleMatch[1]}`);
      }
      return { uri, mimeType: "application/json", text: JSON.stringify(rule, null, 2) };
    }

    // ── Graph stats ───────────────────────────────────────────────────

    if (path === "/graph/stats") {
      const stats = await this.sources.getGraphStats();
      if (!stats) {
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: "Cortex unavailable" }),
        };
      }
      return { uri, mimeType: "application/json", text: JSON.stringify(stats, null, 2) };
    }

    if (path === "/graph/subjects") {
      const subjects = await this.sources.listGraphSubjects();
      if (!subjects) {
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: "Cortex unavailable" }),
        };
      }
      return { uri, mimeType: "application/json", text: JSON.stringify(subjects, null, 2) };
    }

    // ── DAG ───────────────────────────────────────────────────────────

    if (path === "/dag/tips") {
      const tips = await this.sources.getDagTips();
      if (!tips) {
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: "Cortex unavailable" }),
        };
      }
      return { uri, mimeType: "application/json", text: JSON.stringify(tips, null, 2) };
    }

    if (path === "/dag/stats") {
      const stats = await this.sources.getDagStats();
      if (!stats) {
        return {
          uri,
          mimeType: "application/json",
          text: JSON.stringify({ error: "Cortex unavailable" }),
        };
      }
      return { uri, mimeType: "application/json", text: JSON.stringify(stats, null, 2) };
    }

    throw new McpError(ErrorCodes.RESOURCE_NOT_FOUND, `Unknown resource: ${uri}`);
  }
}

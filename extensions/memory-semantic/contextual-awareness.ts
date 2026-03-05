/**
 * Contextual Awareness — Proactive Cortex-driven notifications.
 *
 * Replaces Claude Code's auto-suggested prompt continuations with
 * knowledge-driven notifications sourced from the Cortex graph.
 *
 * Queries multiple sources (rules engine, project memory, agent memory)
 * and produces prioritized notifications for session start and prompt
 * injection.
 */

import type { CortexClientLike } from "../shared/cortex-client.js";
import type { RulesEngine } from "./rules-engine.js";
import type { ProjectMemory } from "./project-memory.js";
import type { AgentMemory } from "./agent-memory.js";

// ============================================================================
// Types
// ============================================================================

export type NotificationType =
  | "rule_proposal"
  | "unresolved_finding"
  | "convention_violation"
  | "agent_reminder"
  | "stale_memory"
  | "project_stats";

export type Notification = {
  type: NotificationType;
  message: string;
  priority: "low" | "medium" | "high";
  source: string;
  actionable: boolean;
};

// ============================================================================
// Priority ordering
// ============================================================================

const PRIORITY_ORDER: Record<string, number> = {
  high: 0,
  medium: 1,
  low: 2,
};

// ============================================================================
// ContextualAwareness class
// ============================================================================

export class ContextualAwareness {
  constructor(
    private readonly client: CortexClientLike,
    private readonly ns: string,
    private readonly rulesEngine: RulesEngine,
    private readonly projectMemory: ProjectMemory,
    private readonly agentMemory: AgentMemory,
  ) {}

  async gatherNotifications(agentId: string): Promise<Notification[]> {
    const notifications: Notification[] = [];

    // 1. Pending rule proposals
    try {
      const pendingRules = await this.rulesEngine.listRules({ enabled: false });
      const learnedPending = pendingRules.filter((r) => r.source === "learned");
      if (learnedPending.length > 0) {
        notifications.push({
          type: "rule_proposal",
          message: `${learnedPending.length} rule proposal${learnedPending.length > 1 ? "s" : ""} pending confirmation`,
          priority: "medium",
          source: "rules-engine",
          actionable: true,
        });
      }
    } catch {
      // Non-fatal
    }

    // 2. Unresolved findings from recent sessions
    try {
      const findings = await this.projectMemory.recentFindings({ limit: 3 });
      for (const finding of findings) {
        if (finding.type === "finding" || finding.type === "error") {
          notifications.push({
            type: "unresolved_finding",
            message: `Previous session: ${finding.text}`,
            priority: finding.type === "error" ? "high" : "medium",
            source: "project-memory",
            actionable: false,
          });
        }
      }
    } catch {
      // Non-fatal
    }

    // 3. Agent reminders (memories containing TODO or reminder)
    try {
      const memories = await this.agentMemory.recall(agentId, { type: "insight", limit: 20 });
      for (const mem of memories) {
        const lower = mem.content.toLowerCase();
        if (lower.includes("todo") || lower.includes("reminder") || lower.includes("remember to")) {
          notifications.push({
            type: "agent_reminder",
            message: mem.content,
            priority: "medium",
            source: "agent-memory",
            actionable: true,
          });
        }
      }
    } catch {
      // Non-fatal
    }

    // 4. Project stats summary
    try {
      const stats = await this.projectMemory.stats();
      if (stats.conventions > 0 || stats.decisions > 0 || stats.findings > 0) {
        notifications.push({
          type: "project_stats",
          message: `Project: ${stats.conventions} conventions, ${stats.decisions} decisions, ${stats.findings} findings`,
          priority: "low",
          source: "project-memory",
          actionable: false,
        });
      }
    } catch {
      // Non-fatal
    }

    // Sort by priority (high first)
    notifications.sort(
      (a, b) => (PRIORITY_ORDER[a.priority] ?? 2) - (PRIORITY_ORDER[b.priority] ?? 2),
    );

    return notifications;
  }

  formatNotifications(notifications: Notification[]): string {
    if (notifications.length === 0) return "";

    const lines = notifications.map((n) => {
      const prefix = n.priority === "high" ? "[!]" : n.priority === "medium" ? "[*]" : "[-]";
      return `${prefix} ${n.message}`;
    });

    return `<session-notifications>\n${lines.join("\n")}\n</session-notifications>`;
  }
}

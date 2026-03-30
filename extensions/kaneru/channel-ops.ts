/**
 * Channel Operations
 *
 * Formats Kaneru notifications for delivery through messaging channels
 * (WhatsApp, Telegram, Discord, Slack). Agents receive mission reports,
 * operators approve decisions, fuel alerts via DMs.
 *
 * This is a formatting/routing layer — actual message delivery uses
 * existing channel adapters.
 */

import type { Venture } from "./venture.js";
import type { Mission } from "./mission.js";
import type { FuelSummary } from "./fuel.js";
import type { DecisionRecord } from "./decision-history.js";
import type { LearningProfile, MissionOutcome } from "./learning-profiles.js";

// ============================================================================
// Types
// ============================================================================

export type NotificationType =
  | "mission-complete"
  | "fuel-alert"
  | "decision-pending"
  | "pulse-fired"
  | "delegation"
  | "mission-assigned";

export type ChannelNotification = {
  type: NotificationType;
  ventureId: string;
  agentId?: string;
  missionId?: string;
  message: string;
  priority: "normal" | "urgent";
};

export type ChannelOpsConfig = {
  notifyOnMissionComplete: boolean;
  notifyOnFuelAlert: boolean;
  notifyOnDecisionPending: boolean;
  fuelAlertThreshold: number;
};

const DEFAULT_CONFIG: ChannelOpsConfig = {
  notifyOnMissionComplete: true,
  notifyOnFuelAlert: true,
  notifyOnDecisionPending: true,
  fuelAlertThreshold: 80,
};

// ============================================================================
// ChannelOpsService
// ============================================================================

export class ChannelOpsService {
  private readonly config: ChannelOpsConfig;

  constructor(
    private readonly ns: string,
    config?: Partial<ChannelOpsConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /** Check if a notification should be sent based on config. */
  shouldNotify(notification: ChannelNotification): boolean {
    switch (notification.type) {
      case "mission-complete":
        return this.config.notifyOnMissionComplete;
      case "fuel-alert":
        return this.config.notifyOnFuelAlert;
      case "decision-pending":
        return this.config.notifyOnDecisionPending;
      default:
        return true;
    }
  }

  /** Format a notification for chat delivery. */
  formatNotification(notification: ChannelNotification): string {
    const prefix = notification.priority === "urgent" ? "[URGENT] " : "";
    return `${prefix}${notification.message}`;
  }

  /** Build a mission completion notification. */
  buildMissionReport(mission: Mission, outcome: MissionOutcome): ChannelNotification {
    const status = outcome.success ? "completed" : "failed";
    const duration = outcome.durationMs > 0 ? ` in ${Math.round(outcome.durationMs / 1000)}s` : "";

    return {
      type: "mission-complete",
      ventureId: mission.ventureId,
      agentId: outcome.agentId,
      missionId: mission.id,
      message: `Mission ${mission.identifier} ${status}${duration}\nAgent: ${outcome.agentId}\nTitle: ${mission.title}`,
      priority: outcome.success ? "normal" : "urgent",
    };
  }

  /** Build a fuel alert if threshold is exceeded. Returns null if under threshold. */
  buildFuelAlert(venture: Venture, summary: FuelSummary): ChannelNotification | null {
    if (venture.fuelLimit <= 0) return null;

    const pct = (summary.totalCents / venture.fuelLimit) * 100;
    if (pct < this.config.fuelAlertThreshold) return null;

    const remaining = Math.max(0, venture.fuelLimit - summary.totalCents);

    return {
      type: "fuel-alert",
      ventureId: venture.id,
      message: `Fuel alert for ${venture.name}: ${pct.toFixed(0)}% consumed\nSpent: ${summary.totalCents} / ${venture.fuelLimit} cents\nRemaining: ${remaining} cents\nBurn rate: ${summary.burnRate} cents/hour`,
      priority: pct >= 95 ? "urgent" : "normal",
    };
  }

  /** Build a decision pending notification. */
  buildDecisionPrompt(decision: DecisionRecord): ChannelNotification {
    const participants =
      decision.participants.length > 0 ? `\nParticipants: ${decision.participants.join(", ")}` : "";

    return {
      type: "decision-pending",
      ventureId: decision.ventureId ?? "",
      missionId: decision.missionId ?? undefined,
      message: `Decision pending: ${decision.question}\nStrategy: ${decision.strategy}\nConfidence: ${(decision.confidence * 100).toFixed(1)}%${participants}`,
      priority: decision.confidence < 0.5 ? "urgent" : "normal",
    };
  }
}

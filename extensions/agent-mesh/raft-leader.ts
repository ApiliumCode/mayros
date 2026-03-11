/**
 * Leader-Score Election (Kimeru extension)
 *
 * Leader election based on EMA performance scores. Local simulation,
 * NOT a real Raft implementation. There is no distributed log replication,
 * no heartbeats, and no term-based leader fencing. The "leader" is simply
 * the agent with the highest performance score at election time.
 *
 * Leader proposes resolution, majority of followers must confirm.
 */

import type { PerformanceTracker } from "./performance-tracker.js";

// ============================================================================
// Types
// ============================================================================

export type LeaderElectionResult = {
  leaderId: string;
  leaderScore: number;
  candidates: Array<{ agentId: string; score: number }>;
  term: number;
};

export type RaftConsensusResult = {
  success: boolean;
  leaderId: string;
  proposedValue: string;
  confirmations: number;
  required: number;
  term: number;
};

// ============================================================================
// RaftLeader
// ============================================================================

export class RaftLeader {
  private currentTerm = 0;
  private currentLeader: string | null = null;

  constructor(
    private readonly perfTracker: PerformanceTracker,
    private readonly leaderTimeoutMs: number = 30_000,
    private readonly maxReElections: number = 3,
  ) {}

  /**
   * Elect a leader based on highest EMA performance score.
   */
  async electLeader(agentIds: string[], excludeAgent?: string): Promise<LeaderElectionResult> {
    if (agentIds.length === 0) {
      throw new Error("No agents available for leader election");
    }

    const candidates: Array<{ agentId: string; score: number }> = [];

    for (const agentId of agentIds) {
      if (agentId === excludeAgent) continue;
      const score = await this.perfTracker.getScore(agentId);
      candidates.push({ agentId, score });
    }

    if (candidates.length === 0) {
      throw new Error("No eligible candidates after exclusion");
    }

    // Sort by score descending
    candidates.sort((a, b) => b.score - a.score);

    this.currentTerm++;
    this.currentLeader = candidates[0]!.agentId;

    return {
      leaderId: candidates[0]!.agentId,
      leaderScore: candidates[0]!.score,
      candidates,
      term: this.currentTerm,
    };
  }

  /**
   * Leader proposes a resolution; majority of followers must confirm.
   */
  async proposeResolution(params: {
    leaderId: string;
    value: string;
    followerIds: string[];
    followerValues: Record<string, string>;
  }): Promise<RaftConsensusResult> {
    const { leaderId, value, followerIds, followerValues } = params;
    const totalVoters = followerIds.length + 1; // followers + leader
    const required = Math.floor(totalVoters / 2) + 1;

    // Leader always confirms its own proposal
    let confirmations = 1;

    // Followers confirm if their value matches the leader's proposal
    for (const followerId of followerIds) {
      const followerValue = followerValues[followerId];
      if (followerValue === value) {
        confirmations++;
      }
    }

    return {
      success: confirmations >= required,
      leaderId,
      proposedValue: value,
      confirmations,
      required,
      term: this.currentTerm,
    };
  }

  /**
   * Re-elect a new leader, optionally excluding the current leader.
   */
  async reElect(agentIds: string[], excludeAgent?: string): Promise<LeaderElectionResult> {
    return this.electLeader(agentIds, excludeAgent);
  }

  getCurrentTerm(): number {
    return this.currentTerm;
  }

  getCurrentLeader(): string | null {
    return this.currentLeader;
  }
}

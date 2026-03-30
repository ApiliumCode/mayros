/**
 * Consensus Engine (Kimeru)
 *
 * Resolves conflicts when parallel agents produce divergent results.
 * Three strategies: majority vote, weighted vote (by EMA score), and
 * LLM-arbitrated decision.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import type { PerformanceTracker } from "./performance-tracker.js";
import type { Conflict } from "./mesh-protocol.js";
import type { ByzantineValidator } from "./byzantine-validator.js";
import type { RaftLeader } from "./raft-leader.js";

// ============================================================================
// Types
// ============================================================================

export type ConsensusStrategy =
  | "majority"
  | "weighted"
  | "arbitrate"
  | "pbft-local"
  | "leader-score";

export type ConsensusRequest = {
  id: string;
  conflicts: Conflict[];
  agentIds: string[];
  strategy: ConsensusStrategy;
};

export type ConsensusResult = {
  id: string;
  resolved: boolean;
  strategy: ConsensusStrategy;
  confidence: number;
  resolutions: ConsensusResolution[];
  breakdown: ConsensusBreakdown;
};

export type ConsensusResolution = {
  subject: string;
  predicate: string;
  resolvedValue: string;
  discardedValues: string[];
  votes: Record<string, number>;
};

export type ConsensusBreakdown = {
  totalConflicts: number;
  resolvedCount: number;
  unresolvedCount: number;
  averageConfidence: number;
};

// ============================================================================
// Constants
// ============================================================================

const ARBITRATE_MARGIN = 0.15;

// ============================================================================
// ConsensusEngine
// ============================================================================

export class ConsensusEngine {
  private byzantineValidator?: ByzantineValidator;
  private raftLeader?: RaftLeader;

  constructor(
    private readonly client: CortexClient | null,
    private readonly ns: string,
    private readonly perfTracker: PerformanceTracker,
    private readonly callLlm?: (prompt: string, opts?: { maxTokens?: number }) => Promise<string>,
    byzantineValidator?: ByzantineValidator,
    raftLeader?: RaftLeader,
  ) {
    this.byzantineValidator = byzantineValidator;
    this.raftLeader = raftLeader;
  }

  /**
   * Resolve a set of conflicts between agents.
   */
  async resolve(request: ConsensusRequest): Promise<ConsensusResult> {
    const resolutions: ConsensusResolution[] = [];
    let totalConfidence = 0;

    for (const conflict of request.conflicts) {
      const resolution = await this.resolveConflict(conflict, request.agentIds, request.strategy);
      resolutions.push(resolution);
      const voteValues = resolution.votes ? Object.values(resolution.votes) : [];
      const totalVotes = voteValues.reduce((a, b) => a + b, 0);
      totalConfidence += totalVotes > 0 ? Math.max(...voteValues) / totalVotes : 0.5;
    }

    const resolvedCount = resolutions.filter((r) => r.resolvedValue !== "").length;

    const result: ConsensusResult = {
      id: request.id,
      resolved: resolvedCount === request.conflicts.length,
      strategy: request.strategy,
      confidence: resolutions.length > 0 ? totalConfidence / resolutions.length : 1.0,
      resolutions,
      breakdown: {
        totalConflicts: request.conflicts.length,
        resolvedCount,
        unresolvedCount: request.conflicts.length - resolvedCount,
        averageConfidence: resolutions.length > 0 ? totalConfidence / resolutions.length : 1.0,
      },
    };

    // Decision persistence handled by DecisionHistory (extensions/kaneru/decision-history.ts)
    // to avoid double-storage with richer context (question, votes, venture/mission linking).

    return result;
  }

  /**
   * Resolve conflicts from a workflow phase.
   * Convenience method that maps phase conflicts into ConsensusRequests.
   */
  async resolvePhaseConflicts(
    conflicts: Conflict[],
    agentIdByNs: Record<string, string>,
    strategy: ConsensusStrategy,
  ): Promise<ConsensusResult[]> {
    if (conflicts.length === 0) return [];

    const agentIds = Object.values(agentIdByNs);
    const results: ConsensusResult[] = [];

    // Group conflicts by subject for batched resolution
    const id = `phase-${Date.now()}`;
    const request: ConsensusRequest = {
      id,
      conflicts,
      agentIds,
      strategy,
    };

    results.push(await this.resolve(request));
    return results;
  }

  // ---------- internal ----------

  private async resolveConflict(
    conflict: Conflict,
    agentIds: string[],
    strategy: ConsensusStrategy,
  ): Promise<ConsensusResolution> {
    const votes: Record<string, number> = {};

    // Initialize votes from conflict values
    for (const value of conflict.values) {
      votes[value] = 0;
    }

    switch (strategy) {
      case "majority":
        return this.majorityVote(conflict, agentIds, votes);

      case "weighted":
        return this.weightedVote(conflict, agentIds, votes);

      case "arbitrate": {
        // First try weighted; if margin too small, escalate to LLM
        const weighted = await this.weightedVote(conflict, agentIds, votes);
        const totalVotes = Object.values(weighted.votes).reduce((a, b) => a + b, 0);
        const maxVote = Math.max(...Object.values(weighted.votes));

        if (totalVotes > 0 && maxVote / totalVotes - ARBITRATE_MARGIN > 0) {
          return weighted;
        }

        // LLM arbitration
        return this.llmArbitrate(conflict, weighted);
      }

      case "pbft-local": {
        if (!this.byzantineValidator || !this.byzantineValidator.canRunByzantine(agentIds.length)) {
          // Fallback to weighted if insufficient agents or no validator
          return this.weightedVote(conflict, agentIds, votes);
        }

        // Build agent→value map
        const agentValues: Record<string, string> = {};
        for (let i = 0; i < conflict.namespaces.length; i++) {
          const agentId = agentIds[i % agentIds.length] ?? agentIds[0]!;
          const value = conflict.values[i % conflict.values.length] ?? conflict.values[0] ?? "";
          agentValues[agentId] = value;
        }

        const pbftResult = await this.byzantineValidator.runPBFT({
          agentIds,
          values: conflict.values,
          agentValues,
        });

        if (pbftResult.success) {
          // Convert PBFT votes to vote counts
          for (const v of pbftResult.votes) {
            const cleanValue = v.value.replace(/^commit:/, "");
            if (conflict.values.includes(cleanValue)) {
              votes[cleanValue] = (votes[cleanValue] ?? 0) + 1;
            }
          }
          return {
            subject: conflict.subject,
            predicate: conflict.predicate,
            resolvedValue: pbftResult.resolvedValue,
            discardedValues: conflict.values.filter((v) => v !== pbftResult.resolvedValue),
            votes,
          };
        }

        // PBFT failed — fallback to weighted
        return this.weightedVote(conflict, agentIds, votes);
      }

      case "leader-score": {
        if (!this.raftLeader || agentIds.length < 2) {
          return this.weightedVote(conflict, agentIds, votes);
        }

        try {
          const election = await this.raftLeader.electLeader(agentIds);

          // Build leader's value and follower values
          const leaderIdx = agentIds.indexOf(election.leaderId);
          const leaderValue =
            conflict.values[leaderIdx % conflict.values.length] ?? conflict.values[0] ?? "";
          const followerIds = agentIds.filter((id) => id !== election.leaderId);
          const followerValues: Record<string, string> = {};
          for (const fid of followerIds) {
            const fidIdx = agentIds.indexOf(fid);
            followerValues[fid] =
              conflict.values[fidIdx % conflict.values.length] ?? conflict.values[0] ?? "";
          }

          const raftResult = await this.raftLeader.proposeResolution({
            leaderId: election.leaderId,
            value: leaderValue,
            followerIds,
            followerValues,
          });

          if (raftResult.success) {
            votes[raftResult.proposedValue] = raftResult.confirmations;
            return {
              subject: conflict.subject,
              predicate: conflict.predicate,
              resolvedValue: raftResult.proposedValue,
              discardedValues: conflict.values.filter((v) => v !== raftResult.proposedValue),
              votes,
            };
          }
        } catch {
          // Raft failed — fallback
        }

        return this.weightedVote(conflict, agentIds, votes);
      }
    }
  }

  private majorityVote(
    conflict: Conflict,
    _agentIds: string[],
    votes: Record<string, number>,
  ): ConsensusResolution {
    // Each namespace gets 1 vote for its value
    for (let i = 0; i < conflict.values.length; i++) {
      const value = conflict.values[i]!;
      votes[value] = (votes[value] ?? 0) + 1;
    }

    // Find winner
    let winner = conflict.values[0] ?? "";
    let maxVotes = 0;
    for (const [value, count] of Object.entries(votes)) {
      if (count > maxVotes) {
        maxVotes = count;
        winner = value;
      }
    }

    return {
      subject: conflict.subject,
      predicate: conflict.predicate,
      resolvedValue: winner,
      discardedValues: conflict.values.filter((v) => v !== winner),
      votes,
    };
  }

  private async weightedVote(
    conflict: Conflict,
    agentIds: string[],
    votes: Record<string, number>,
  ): Promise<ConsensusResolution> {
    // Weight each agent's vote by their EMA score
    for (let i = 0; i < conflict.namespaces.length; i++) {
      const value = conflict.values[i % conflict.values.length] ?? conflict.values[0] ?? "";

      // Find agent for this namespace
      const agentId = agentIds[i % agentIds.length] ?? agentIds[0];
      const score = agentId ? await this.perfTracker.getScore(agentId) : 0.5;

      votes[value] = (votes[value] ?? 0) + score;
    }

    // Find winner
    let winner = conflict.values[0] ?? "";
    let maxVotes = 0;
    for (const [value, weight] of Object.entries(votes)) {
      if (weight > maxVotes) {
        maxVotes = weight;
        winner = value;
      }
    }

    return {
      subject: conflict.subject,
      predicate: conflict.predicate,
      resolvedValue: winner,
      discardedValues: conflict.values.filter((v) => v !== winner),
      votes,
    };
  }

  private async llmArbitrate(
    conflict: Conflict,
    fallback: ConsensusResolution,
  ): Promise<ConsensusResolution> {
    if (!this.callLlm) {
      return fallback;
    }

    try {
      const prompt = [
        "You are resolving a conflict between agents. Pick the best value.",
        `Subject: ${conflict.subject}`,
        `Predicate: ${conflict.predicate}`,
        `Values: ${conflict.values.map((v, i) => `[${i + 1}] "${v}"`).join(", ")}`,
        "Reply with ONLY the number of the best value (e.g., '1').",
      ].join("\n");

      const response = await this.callLlm(prompt, { maxTokens: 10 });
      const choice = parseInt(response.trim(), 10);

      if (choice >= 1 && choice <= conflict.values.length) {
        const winner = conflict.values[choice - 1]!;
        return {
          ...fallback,
          resolvedValue: winner,
          discardedValues: conflict.values.filter((v) => v !== winner),
        };
      }
    } catch {
      // Fallback to weighted result
    }

    return fallback;
  }
}

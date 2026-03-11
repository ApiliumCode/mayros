/**
 * PBFT-Local Validator (Kimeru extension)
 *
 * Local simulation of PBFT for single-process multi-agent consensus.
 * NOT a real distributed BFT protocol. All agents run in the same process;
 * HMAC-signed votes prevent accidental value corruption but do not defend
 * against network-level Byzantine faults.
 *
 * Requires >= 4 agents (3f+1 where f >= 1).
 * Falls back to weighted consensus if insufficient agents.
 */

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

// ============================================================================
// Types
// ============================================================================

export type SignedVote = {
  agentId: string;
  value: string;
  timestamp: number;
  signature: string;
};

export type QuorumResult = {
  reached: boolean;
  agreementCount: number;
  requiredCount: number;
  faultTolerance: number;
  totalAgents: number;
};

export type ByzantinePhaseResult = {
  phase: "pre-prepare" | "prepare" | "commit" | "complete";
  success: boolean;
  resolvedValue: string;
  votes: SignedVote[];
  quorum: QuorumResult;
};

export type SessionKey = {
  agentId: string;
  key: Buffer;
  createdAt: number;
};

// ============================================================================
// ByzantineValidator
// ============================================================================

export class ByzantineValidator {
  private sessionKeys = new Map<string, SessionKey>();

  generateSessionKey(agentId: string): SessionKey {
    const key: SessionKey = {
      agentId,
      key: randomBytes(32),
      createdAt: Date.now(),
    };
    this.sessionKeys.set(agentId, key);
    return key;
  }

  signVote(agentId: string, value: string): SignedVote {
    let sessionKey = this.sessionKeys.get(agentId);
    if (!sessionKey) {
      sessionKey = this.generateSessionKey(agentId);
    }

    const timestamp = Date.now();
    const data = `${agentId}:${value}:${timestamp}`;
    const signature = createHmac("sha256", sessionKey.key).update(data).digest("hex");

    return { agentId, value, timestamp, signature };
  }

  verifyVote(vote: SignedVote): boolean {
    const sessionKey = this.sessionKeys.get(vote.agentId);
    if (!sessionKey) return false;

    const data = `${vote.agentId}:${vote.value}:${vote.timestamp}`;
    const expected = createHmac("sha256", sessionKey.key).update(data).digest("hex");

    const sigBuf = Buffer.from(vote.signature, "hex");
    const expBuf = Buffer.from(expected, "hex");
    if (sigBuf.length !== expBuf.length) return false;
    return timingSafeEqual(sigBuf, expBuf);
  }

  /**
   * Check if quorum is reached: need 2f+1 agreeing agents.
   * f = floor((n-1)/3)
   */
  checkQuorum(totalAgents: number, agreementCount: number): QuorumResult {
    const f = Math.floor((totalAgents - 1) / 3);
    const required = 2 * f + 1;

    return {
      reached: agreementCount >= required,
      agreementCount,
      requiredCount: required,
      faultTolerance: f,
      totalAgents,
    };
  }

  /**
   * Byzantine consensus requires at least 4 agents (3f+1 where f >= 1).
   */
  canRunByzantine(totalAgents: number): boolean {
    return totalAgents >= 4;
  }

  /**
   * Run practical BFT (PBFT) consensus.
   *
   * Phases:
   * 1. Pre-prepare: primary proposes a value
   * 2. Prepare: agents sign votes, need 2f+1
   * 3. Commit: agents confirm, need 2f+1
   */
  async runPBFT(params: {
    agentIds: string[];
    values: string[];
    agentValues: Record<string, string>;
  }): Promise<ByzantinePhaseResult> {
    const { agentIds, values, agentValues } = params;
    const n = agentIds.length;

    if (!this.canRunByzantine(n)) {
      return {
        phase: "pre-prepare",
        success: false,
        resolvedValue: "",
        votes: [],
        quorum: this.checkQuorum(n, 0),
      };
    }

    // Ensure all agents have session keys
    for (const id of agentIds) {
      if (!this.sessionKeys.has(id)) {
        this.generateSessionKey(id);
      }
    }

    // Phase 1: Pre-prepare — primary proposes the most common value
    const valueCounts = new Map<string, number>();
    for (const v of Object.values(agentValues)) {
      valueCounts.set(v, (valueCounts.get(v) ?? 0) + 1);
    }
    let proposedValue = values[0] ?? "";
    let maxCount = 0;
    for (const [v, c] of valueCounts) {
      if (c > maxCount) {
        maxCount = c;
        proposedValue = v;
      }
    }

    // Phase 2: Prepare — agents vote
    const prepareVotes: SignedVote[] = [];
    for (const agentId of agentIds) {
      const agentValue = agentValues[agentId] ?? proposedValue;
      const vote = this.signVote(agentId, agentValue);
      if (this.verifyVote(vote)) {
        prepareVotes.push(vote);
      }
    }

    // Count agreements with proposed value
    const prepareAgreements = prepareVotes.filter((v) => v.value === proposedValue).length;
    const prepareQuorum = this.checkQuorum(n, prepareAgreements);

    if (!prepareQuorum.reached) {
      return {
        phase: "prepare",
        success: false,
        resolvedValue: proposedValue,
        votes: prepareVotes,
        quorum: prepareQuorum,
      };
    }

    // Phase 3: Commit — agents confirm
    const commitVotes: SignedVote[] = [];
    for (const agentId of agentIds) {
      const agentValue = agentValues[agentId] ?? proposedValue;
      if (agentValue === proposedValue) {
        const vote = this.signVote(agentId, `commit:${proposedValue}`);
        if (this.verifyVote(vote)) {
          commitVotes.push(vote);
        }
      }
    }

    const commitAgreements = commitVotes.length;
    const commitQuorum = this.checkQuorum(n, commitAgreements);

    return {
      phase: commitQuorum.reached ? "complete" : "commit",
      success: commitQuorum.reached,
      resolvedValue: proposedValue,
      votes: [...prepareVotes, ...commitVotes],
      quorum: commitQuorum,
    };
  }

  /**
   * Clear session keys.
   */
  clearKeys(): void {
    this.sessionKeys.clear();
  }
}

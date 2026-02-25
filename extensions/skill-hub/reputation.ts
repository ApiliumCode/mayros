import type { CortexClient } from "../shared/cortex-client.js";

export type ConsistencyScore = {
  agentId: string;
  score: number;
  totalAssertions: number;
  verifiedAssertions: number;
};

export class ReputationClient {
  constructor(private cortex: CortexClient) {}

  async getAgentConsistency(agentId: string): Promise<ConsistencyScore> {
    const result = await this.cortex.getConsistency(agentId);
    return {
      agentId,
      score: result.score,
      totalAssertions: result.total,
      verifiedAssertions: result.verified,
    };
  }

  async verifyBatch(
    assertions: Array<{ subject: string; predicate: string }>,
  ): Promise<Array<{ subject: string; predicate: string; verified: boolean }>> {
    const result = await this.cortex.batchVerifyAssertions(assertions);
    return result.results;
  }

  /**
   * Compute a trust score for a skill author based on their
   * assertion consistency and verification history.
   */
  async computeTrustScore(agentId: string): Promise<{
    trust: number;
    consistency: number;
    totalAssertions: number;
    tier: "untrusted" | "basic" | "verified" | "trusted";
  }> {
    const consistency = await this.getAgentConsistency(agentId);

    // Trust tiers:
    // - untrusted: score < 0.3 or < 5 assertions
    // - basic: score >= 0.3 and >= 5 assertions
    // - verified: score >= 0.7 and >= 20 assertions
    // - trusted: score >= 0.9 and >= 50 assertions
    let tier: "untrusted" | "basic" | "verified" | "trusted" = "untrusted";
    if (consistency.totalAssertions >= 50 && consistency.score >= 0.9) {
      tier = "trusted";
    } else if (consistency.totalAssertions >= 20 && consistency.score >= 0.7) {
      tier = "verified";
    } else if (consistency.totalAssertions >= 5 && consistency.score >= 0.3) {
      tier = "basic";
    }

    return {
      trust: consistency.score,
      consistency: consistency.score,
      totalAssertions: consistency.totalAssertions,
      tier,
    };
  }
}

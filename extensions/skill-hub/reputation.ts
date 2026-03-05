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

// ============================================================================
// Trust badges & enriched search results
// ============================================================================

export type TrustBadge = {
  tier: "untrusted" | "basic" | "verified" | "trusted";
  label: string;
  symbol: string;
};

const TRUST_BADGES: Record<string, TrustBadge> = {
  untrusted: { tier: "untrusted", label: "Untrusted", symbol: "-" },
  basic: { tier: "basic", label: "Bronze", symbol: "B" },
  verified: { tier: "verified", label: "Silver", symbol: "S" },
  trusted: { tier: "trusted", label: "Gold", symbol: "G" },
};

/**
 * Get a formatted trust badge for a given tier.
 */
export function formatTrustBadge(tier: "untrusted" | "basic" | "verified" | "trusted"): TrustBadge {
  return TRUST_BADGES[tier] ?? TRUST_BADGES.untrusted;
}

export type EnrichedSearchResult = {
  slug: string;
  name: string;
  description: string;
  version: string;
  author: string;
  downloads: number;
  rating: number;
  badge: TrustBadge;
  ratingStars: string;
};

/**
 * Convert a numeric rating (0-5) to a star string like "****-" for 4/5.
 */
function ratingToStars(rating: number): string {
  const clamped = Math.max(0, Math.min(5, Math.round(rating)));
  return "*".repeat(clamped) + "-".repeat(5 - clamped);
}

/**
 * Enrich raw search results with trust badges and rating stars.
 */
export function enrichSearchResults(
  skills: Array<{
    slug: string;
    name: string;
    description: string;
    version: string;
    author: string;
    downloads: number;
    rating: number;
  }>,
  trustScores: Map<string, { tier: "untrusted" | "basic" | "verified" | "trusted" }>,
): EnrichedSearchResult[] {
  return skills.map((s) => {
    const trust = trustScores.get(s.author);
    const badge = formatTrustBadge(trust?.tier ?? "untrusted");
    return {
      slug: s.slug,
      name: s.name,
      description: s.description,
      version: s.version,
      author: s.author,
      downloads: s.downloads,
      rating: s.rating,
      badge,
      ratingStars: ratingToStars(s.rating),
    };
  });
}

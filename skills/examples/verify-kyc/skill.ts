/**
 * verify-kyc — semantic skill runtime
 *
 * Filters graph query results to only include KYC-related predicates
 * and logs activation for audit purposes.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

const runtime: SkillRuntime = {
  name: "verify-kyc",

  async onActivate(ctx) {
    ctx.logger.info(`verify-kyc: activated for agent ${ctx.agentId} in ${ctx.namespace}`);
  },

  async onDeactivate(ctx) {
    // Nothing to clean up
  },

  async onQuery(ctx) {
    // Filter results to only KYC-related predicates
    const kycPredicates = ["kyc:status", "kyc:level", "kyc:verified", "kyc:expiry"];
    const filtered = ctx.results.filter((r) => {
      // If the query predicate is KYC-related, pass through all results
      if (kycPredicates.some((p) => ctx.predicate.includes(p))) return true;
      // Otherwise only pass results whose subject contains "kyc"
      return r.subject.toLowerCase().includes("kyc");
    });

    return {
      results: filtered.length > 0 ? filtered : ctx.results,
      additionalContext:
        filtered.length < ctx.results.length
          ? `[verify-kyc] Filtered ${ctx.results.length - filtered.length} non-KYC results`
          : undefined,
    };
  },
};

export default runtime;

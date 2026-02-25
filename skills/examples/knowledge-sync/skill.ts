/**
 * knowledge-sync — semantic skill runtime
 *
 * Seeds initial triples on activation and provides
 * sync status context on queries.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

const runtime: SkillRuntime = {
  name: "knowledge-sync",

  async onActivate(ctx) {
    ctx.logger.info(`knowledge-sync: activated for agent ${ctx.agentId}`);

    // Seed initial sync status triple
    try {
      await ctx.graphClient.createTriple({
        subject: `${ctx.namespace}:agent:${ctx.agentId}`,
        predicate: `${ctx.namespace}:sync:lastActivated`,
        object: new Date().toISOString(),
      });
    } catch {
      ctx.logger.warn("knowledge-sync: failed to seed initial triple (Cortex may be unavailable)");
    }
  },

  async onDeactivate(ctx) {
    // Log deactivation reason for observability
  },

  async onQuery(ctx) {
    return {
      results: ctx.results,
      additionalContext: `[knowledge-sync] Sync scope: ${ctx.scope}, predicate: ${ctx.predicate}`,
    };
  },

  async onError(ctx) {
    // Log errors for debugging
  },
};

export default runtime;

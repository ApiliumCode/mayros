/**
 * api-monitor — semantic skill runtime
 *
 * Adds health status annotations to API monitoring query results.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

const runtime: SkillRuntime = {
  name: "api-monitor",

  async onActivate(ctx) {
    ctx.logger.info(`api-monitor: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    const withStatus = ctx.results.map((r) => {
      const val = typeof r.object === "string" ? r.object : JSON.stringify(r.object);
      let status = "unknown";
      if (val.includes("200") || val.includes("healthy") || val.includes("ok")) {
        status = "healthy";
      } else if (val.includes("500") || val.includes("error") || val.includes("down")) {
        status = "unhealthy";
      } else if (val.includes("timeout") || val.includes("slow")) {
        status = "degraded";
      }
      return { subject: r.subject, object: { value: r.object, healthStatus: status } };
    });

    return {
      results: withStatus,
      additionalContext: `[api-monitor] Health status annotated for ${withStatus.length} endpoints`,
    };
  },
};

export default runtime;

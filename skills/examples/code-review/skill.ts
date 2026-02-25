/**
 * code-review — semantic skill runtime
 *
 * Enriches graph query results with severity classification
 * for code review findings.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

const runtime: SkillRuntime = {
  name: "code-review",

  async onActivate(ctx) {
    ctx.logger.info(`code-review: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    // Enrich results with severity classification
    const enriched = ctx.results.map((r) => {
      const obj = typeof r.object === "string" ? r.object : JSON.stringify(r.object);
      let severity = "info";
      if (obj.includes("error") || obj.includes("critical") || obj.includes("vulnerability")) {
        severity = "critical";
      } else if (obj.includes("warning") || obj.includes("deprecated")) {
        severity = "warning";
      }
      return { subject: r.subject, object: { ...r, severity } };
    });

    return {
      results: enriched,
      additionalContext: `[code-review] Classified ${enriched.length} findings by severity`,
    };
  },
};

export default runtime;

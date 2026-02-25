/**
 * dependency-audit — semantic skill runtime
 *
 * Flags outdated or vulnerable dependencies in query results.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

const runtime: SkillRuntime = {
  name: "dependency-audit",

  async onActivate(ctx) {
    ctx.logger.info(`dependency-audit: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    const flagged = ctx.results.map((r) => {
      const val = typeof r.object === "string" ? r.object : "";
      const isOutdated = val.includes("outdated") || val.includes("deprecated");
      const isVulnerable = val.includes("CVE") || val.includes("vulnerability");
      return {
        subject: r.subject,
        object: {
          value: r.object,
          ...(isOutdated ? { flag: "outdated" } : {}),
          ...(isVulnerable ? { flag: "vulnerable" } : {}),
        },
      };
    });

    const flagCount = flagged.filter(
      (r) => typeof r.object === "object" && "flag" in (r.object as Record<string, unknown>),
    ).length;

    return {
      results: flagged,
      additionalContext:
        flagCount > 0 ? `[dependency-audit] ${flagCount} flagged dependencies found` : undefined,
    };
  },
};

export default runtime;

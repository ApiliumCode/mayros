import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { parseOsameruConfig, osameruConfigSchema } from "./config.js";
import { PolicyCompiler, type PolicyBundle } from "./policy-compiler.js";
import { EnforcementGate } from "./enforcement-gate.js";
import { AuditTrail } from "./audit-trail.js";
import { TrustManager } from "./trust-tiers.js";

function computeTrustScore(event: { success: boolean; durationMs?: number }): number {
  if (event.success) {
    // Base success score, slightly penalize very fast tasks (possible no-ops)
    const duration = event.durationMs ?? 1000;
    return duration < 100 ? 0.7 : 0.9;
  }
  // Failure: longer-running tasks get slightly more credit (tried harder)
  const duration = event.durationMs ?? 0;
  return duration > 5000 ? 0.3 : 0.2;
}

const osameruPlugin = {
  id: "osameru-governance",
  name: "Osameru Governance",
  description: "Policy enforcement, HMAC-signed audit trail, and trust tiers for agent governance",
  kind: "security" as const,
  configSchema: osameruConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = parseOsameruConfig(api.pluginConfig);
    if (cfg.mode === "off") {
      api.logger.info("osameru: governance disabled");
      return;
    }

    const compiler = new PolicyCompiler();
    const auditTrail = new AuditTrail(cfg.auditLogPath, cfg.hmacSecret);
    const trustMgr = cfg.trustTiers.enabled
      ? new TrustManager({
          promotionThreshold: cfg.trustTiers.promotionThreshold,
          demotionThreshold: cfg.trustTiers.demotionThreshold,
        })
      : null;

    let policyBundle: PolicyBundle | null = null;
    const workDir =
      ((api.config as Record<string, unknown> | undefined)?.workspaceDir as string | undefined) ??
      process.cwd();

    // Compile policies on session_start
    api.on("session_start", async () => {
      try {
        policyBundle = await compiler.compileFromPaths(cfg.policyPaths, workDir);
        api.logger.info(`osameru: compiled ${policyBundle.rules.length} policy rules`);
      } catch (err) {
        api.logger.warn(`osameru: policy compilation failed: ${String(err)}`);
      }
    });

    // Enforcement gate
    const getGate = () => (policyBundle ? new EnforcementGate(policyBundle) : null);

    // before_tool_call — enforce tool policies
    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const gate = getGate();
        if (!gate) return;

        const tier = trustMgr && ctx.agentId ? trustMgr.getTier(ctx.agentId) : undefined;
        const decision = gate.evaluate({
          kind: "tool",
          toolName: event.toolName,
          params: event.params,
          agentId: ctx.agentId,
          trustTier: tier,
        });

        // Audit
        await auditTrail.log(
          "tool_call",
          ctx.agentId,
          decision.action === "allow" ? "allow" : decision.action === "deny" ? "deny" : "warn",
          { toolName: event.toolName, params: event.params, rule: decision.matchedRule?.id },
        );

        if (decision.action === "deny") {
          if (cfg.mode === "enforce") {
            return { block: true, blockReason: `Governance: ${decision.reason}` };
          }
          if (cfg.mode === "warn") {
            api.logger.warn(`osameru: would deny ${event.toolName} — ${decision.reason}`);
          }
        }

        if (decision.action === "require-approval") {
          if (cfg.mode === "enforce") {
            return { block: true, blockReason: `Requires approval: ${decision.reason}` };
          }
          if (cfg.mode === "warn") {
            api.logger.warn(
              `osameru: requires approval for ${event.toolName} — ${decision.reason}`,
            );
          }
        }
      },
      { priority: 300 },
    );

    // before_agent_start — validate agent capabilities
    api.on(
      "before_agent_start",
      async (event, ctx) => {
        const gate = getGate();
        if (!gate || !ctx.agentId) return;

        const decision = gate.evaluate({
          kind: "agent",
          agentId: ctx.agentId,
          trustTier: trustMgr ? trustMgr.getTier(ctx.agentId) : undefined,
        });

        await auditTrail.log(
          "agent_start",
          ctx.agentId,
          decision.action === "allow" ? "allow" : "flagged",
          { agentId: ctx.agentId },
        );
      },
      { priority: 300 },
    );

    // agent_end — update trust tiers
    api.on("agent_end", async (event, ctx) => {
      if (!trustMgr || !ctx.agentId) return;
      const score = computeTrustScore({ success: event.success, durationMs: event.durationMs });
      trustMgr.evaluatePromotion(ctx.agentId, score);
    });

    // Tool: governance_status
    api.registerTool({
      name: "governance_status",
      label: "Governance Status",
      description: "Show governance policy status, rules count, and trust tier summary",
      parameters: Type.Object({}),
      execute: async (_toolCallId: string) => {
        const rules = policyBundle?.rules.length ?? 0;
        const trusts = trustMgr?.getAllRecords() ?? [];
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  mode: cfg.mode,
                  rulesCompiled: rules,
                  policyPaths: cfg.policyPaths,
                  trustTiers: trusts.map((r) => ({
                    agentId: r.agentId,
                    tier: r.tier,
                    evaluations: r.evaluationCount,
                  })),
                },
                null,
                2,
              ),
            },
          ],
          details: undefined,
        };
      },
    });

    // Tool: governance_audit_query
    api.registerTool({
      name: "governance_audit_query",
      label: "Governance Audit Query",
      description: "Query the governance audit trail",
      parameters: Type.Object({
        event: Type.Optional(Type.String({ description: "Filter by event type" })),
        actor: Type.Optional(Type.String({ description: "Filter by actor/agent ID" })),
        decision: Type.Optional(
          Type.String({ description: "Filter by decision: allow, deny, warn, flagged" }),
        ),
        limit: Type.Optional(Type.Number({ description: "Max entries to return" })),
      }),
      execute: async (_toolCallId: string, rawParams: unknown) => {
        const params = rawParams as {
          event?: string;
          actor?: string;
          decision?: string;
          limit?: number;
        };
        const entries = await auditTrail.query(params);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(entries, null, 2),
            },
          ],
          details: undefined,
        };
      },
    });

    // Tool: governance_audit_verify
    api.registerTool({
      name: "governance_audit_verify",
      label: "Governance Audit Verify",
      description: "Verify the integrity of the governance audit trail HMAC chain",
      parameters: Type.Object({}),
      execute: async (_toolCallId: string) => {
        const result = await auditTrail.verify();
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          details: undefined,
        };
      },
    });

    // CLI
    api.registerCli(
      (ctx) => {
        const cmd = ctx.program
          .command("governance")
          .description("Osameru governance control plane");

        cmd
          .command("status")
          .description("Show governance status")
          .action(async () => {
            const rules = policyBundle?.rules.length ?? 0;
            console.log(`Mode: ${cfg.mode}`);
            console.log(`Rules: ${rules}`);
            console.log(`Policy paths: ${cfg.policyPaths.join(", ")}`);
          });

        cmd
          .command("audit")
          .description("Show recent audit entries")
          .action(async () => {
            const entries = await auditTrail.query({ limit: 20 });
            for (const e of entries) {
              console.log(
                `[${e.seq}] ${e.timestamp} ${e.event} ${e.decision} ${e.actor ?? "system"}`,
              );
            }
          });

        cmd
          .command("verify")
          .description("Verify audit trail integrity")
          .action(async () => {
            const result = await auditTrail.verify();
            console.log(`Valid: ${result.valid}`);
            console.log(`Entries: ${result.entries}`);
            if (result.firstInvalid !== undefined) {
              console.log(`First invalid: entry #${result.firstInvalid}`);
            }
          });

        cmd
          .command("compile")
          .description("Recompile policies")
          .action(async () => {
            const bundle = await compiler.compileFromPaths(cfg.policyPaths, workDir);
            console.log(
              `Compiled ${bundle.rules.length} rules from ${cfg.policyPaths.length} sources`,
            );
          });
      },
      { commands: ["governance"] },
    );

    api.logger.info(`osameru: initialized in ${cfg.mode} mode`);
  },
};

export default osameruPlugin;

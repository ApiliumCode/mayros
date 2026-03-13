/**
 * `mayros rules` — Built-in CLI for the Cortex-backed rules engine.
 *
 * Manages hierarchically scoped rules as RDF triples. Replaces flat-file
 * rules with queryable, learnable, priority-sorted rules.
 *
 * Subcommands:
 *   list     — List rules (optionally filtered by scope)
 *   add      — Add a new manual rule
 *   remove   — Remove a rule by ID
 *   learn    — Propose a learned rule (disabled until confirmed)
 *   status   — Show rule count by scope + enabled stats
 */

import type { Command } from "commander";
import { RulesEngine, type RuleScope } from "../../extensions/memory-semantic/rules-engine.js";
import { resolveCortexClient, resolveNamespace } from "./shared/cortex-resolution.js";

const VALID_SCOPES = ["global", "project", "agent", "skill", "file"];

// ============================================================================
// Registration
// ============================================================================

export function registerRulesCli(program: Command) {
  const rules = program
    .command("rules")
    .description("Rules engine — manage Cortex-backed hierarchical rules")
    .option("--cortex-host <host>", "Cortex host (default: 127.0.0.1 or from config)")
    .option("--cortex-port <port>", "Cortex port (default: 19090 or from config)")
    .option("--cortex-token <token>", "Cortex auth token (or set CORTEX_AUTH_TOKEN)");

  // ------------------------------------------------------------------
  // mayros rules list
  // ------------------------------------------------------------------
  rules
    .command("list")
    .description("List rules (optionally filtered by scope)")
    .option("--scope <scope>", "Filter by scope (global, project, agent, skill, file)")
    .option("--limit <n>", "Max results", "50")
    .action(async (opts: { scope?: string; limit?: string }) => {
      const parent = rules.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const engine = new RulesEngine(client, ns);
      const limit = parseInt(opts.limit ?? "50", 10);

      try {
        const scope =
          opts.scope && VALID_SCOPES.includes(opts.scope) ? (opts.scope as RuleScope) : undefined;
        const ruleList = await engine.listRules({ scope, limit });

        if (ruleList.length === 0) {
          console.log("No rules found.");
          return;
        }

        console.log(`Rules (${ruleList.length}):\n`);
        for (const r of ruleList) {
          const status = r.enabled ? "enabled" : "disabled";
          const target = r.scopeTarget ? `:${r.scopeTarget}` : "";
          console.log(`  [${r.scope}${target}] ${r.content}`);
          console.log(
            `    id: ${r.id.slice(0, 8)}  priority: ${r.priority}  source: ${r.source}  ${status}  confidence: ${r.confidence}`,
          );
        }
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros rules add <content>
  // ------------------------------------------------------------------
  rules
    .command("add")
    .description("Add a new manual rule")
    .argument("<content>", "Rule content text")
    .option("--scope <scope>", "Rule scope (global, project, agent, skill, file)", "global")
    .option("--target <target>", "Scope target (project name, agent name, file glob)")
    .option("--priority <n>", "Priority (higher = more specific)")
    .action(
      async (content: string, opts: { scope?: string; target?: string; priority?: string }) => {
        const parent = rules.opts();
        const client = resolveCortexClient({
          host: parent.cortexHost,
          port: parent.cortexPort,
          token: parent.cortexToken,
        });
        const ns = resolveNamespace();
        const engine = new RulesEngine(client, ns);

        const scope = VALID_SCOPES.includes(opts.scope ?? "")
          ? (opts.scope as RuleScope)
          : "global";

        try {
          const id = await engine.addRule({
            content,
            scope,
            scopeTarget: opts.target,
            priority: opts.priority ? parseInt(opts.priority, 10) : undefined,
          });

          console.log(`Rule added: ${id.slice(0, 8)} [${scope}]`);
        } finally {
          client.destroy();
        }
      },
    );

  // ------------------------------------------------------------------
  // mayros rules remove <id>
  // ------------------------------------------------------------------
  rules
    .command("remove")
    .description("Remove a rule by ID")
    .argument("<id>", "Rule ID (full or prefix)")
    .action(async (id: string) => {
      const parent = rules.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const engine = new RulesEngine(client, ns);

      try {
        await engine.removeRule(id);
        console.log(`Rule removed: ${id.slice(0, 8)}`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros rules learn <content>
  // ------------------------------------------------------------------
  rules
    .command("learn")
    .description("Propose a learned rule (disabled until confirmed)")
    .argument("<content>", "Rule content text")
    .option("--scope <scope>", "Rule scope (global, project, agent, skill, file)", "global")
    .option("--target <target>", "Scope target")
    .action(async (content: string, opts: { scope?: string; target?: string }) => {
      const parent = rules.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const engine = new RulesEngine(client, ns);

      const scope = VALID_SCOPES.includes(opts.scope ?? "") ? (opts.scope as RuleScope) : "global";

      try {
        const id = await engine.proposeRule(content, scope, opts.target);
        console.log(`Rule proposed: ${id.slice(0, 8)} [${scope}] (disabled — needs confirmation)`);
      } finally {
        client.destroy();
      }
    });

  // ------------------------------------------------------------------
  // mayros rules status
  // ------------------------------------------------------------------
  rules
    .command("status")
    .description("Show rule count by scope + enabled stats")
    .action(async () => {
      const parent = rules.opts();
      const client = resolveCortexClient({
        host: parent.cortexHost,
        port: parent.cortexPort,
        token: parent.cortexToken,
      });
      const ns = resolveNamespace();
      const engine = new RulesEngine(client, ns);

      try {
        const allRules = await engine.listRules({ limit: 500 });

        if (allRules.length === 0) {
          console.log("No rules configured.");
          return;
        }

        const byScope: Record<string, number> = {};
        let enabledCount = 0;
        let disabledCount = 0;

        for (const r of allRules) {
          byScope[r.scope] = (byScope[r.scope] ?? 0) + 1;
          if (r.enabled) enabledCount++;
          else disabledCount++;
        }

        console.log(
          `Rules: ${allRules.length} total (${enabledCount} enabled, ${disabledCount} disabled)\n`,
        );
        console.log("By scope:");
        for (const scope of VALID_SCOPES) {
          if (byScope[scope]) {
            console.log(`  ${scope}: ${byScope[scope]}`);
          }
        }
      } finally {
        client.destroy();
      }
    });
}

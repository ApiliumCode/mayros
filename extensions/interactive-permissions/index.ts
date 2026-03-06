/**
 * Mayros Interactive Permissions Plugin
 *
 * Runtime permission dialogs, bash intent classification, policy persistence,
 * and audit trail. Intercepts tool calls via the before_tool_call hook to
 * classify command risk, check stored policies, and optionally prompt the
 * user for approval.
 *
 * Hook: before_tool_call (priority 200) — runs after bash-sandbox (250)
 * Tool: permissions_classify
 * CLI:  mayros permissions list|add|remove|audit|classify|status
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { CortexClient } from "../shared/cortex-client.js";
import { interactivePermissionsConfigSchema } from "./config.js";
import { CortexAudit, type PermissionDecision } from "./cortex-audit.js";
import { classifyCommand } from "./intent-classifier.js";
import { PolicyStore, generatePolicyId, type PermissionPolicyKind } from "./policy-store.js";
import { PromptUI } from "./prompt-ui.js";
import { isWildcardExpression } from "./wildcard-matcher.js";

// ============================================================================
// Plugin Definition
// ============================================================================

const interactivePermissionsPlugin = {
  id: "interactive-permissions",
  name: "Interactive Permissions",
  description:
    "Runtime permission dialogs with bash intent classification, policy persistence, and audit trail via AIngle Cortex",
  kind: "security" as const,
  configSchema: interactivePermissionsConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = interactivePermissionsConfigSchema.parse(api.pluginConfig);
    const ns = cfg.agentNamespace;

    // Cortex client (optional — graceful degradation)
    let cortex: CortexClient | undefined;
    let cortexAvailable = false;

    try {
      cortex = new CortexClient(cfg.cortex);
      cortexAvailable = await cortex.isHealthy();
    } catch {
      cortexAvailable = false;
    }

    // Core components
    const policyStore = new PolicyStore(cortexAvailable ? cortex : undefined, ns);
    const audit = new CortexAudit(cortexAvailable ? cortex : undefined, ns, cfg.maxStoredDecisions);
    const promptUI = new PromptUI();

    // Load persisted policies from Cortex
    if (cortexAvailable && cfg.policyEnabled) {
      try {
        await policyStore.loadFromCortex();
        api.logger.info(`interactive-permissions: loaded ${policyStore.size} policies from Cortex`);
      } catch {
        api.logger.warn("interactive-permissions: failed to load policies from Cortex");
      }
    }

    api.logger.info(
      `interactive-permissions: registered (autoApproveSafe: ${cfg.autoApproveSafe}, defaultDeny: ${cfg.defaultDeny}, policyEnabled: ${cfg.policyEnabled})`,
    );

    // ========================================================================
    // Hook: before_tool_call — permission enforcement
    // ========================================================================

    api.on(
      "before_tool_call",
      async (event, ctx) => {
        const toolName = event.toolName;
        if (!toolName) return;

        const params = event.params;
        const isExec = toolName === "exec";
        const command = isExec && typeof params.command === "string" ? params.command : undefined;
        const sessionKey = ctx?.sessionKey;

        // Step 1: Classify command risk (only for exec tools)
        const classification = command ? classifyCommand(command) : undefined;
        const riskLevel = classification?.riskLevel ?? "low";

        // Step 2: Auto-approve safe commands
        if (cfg.autoApproveSafe && riskLevel === "safe" && isExec) {
          const decision: PermissionDecision = {
            toolName,
            toolKind: isExec ? "exec" : "tool",
            command,
            riskLevel,
            allowed: true,
            decidedBy: "auto_safe",
            sessionKey,
            timestamp: new Date().toISOString(),
          };
          await audit.recordDecision(decision);
          return;
        }

        // Step 3: Check stored policies
        if (cfg.policyEnabled) {
          const toolArgs =
            typeof params === "object" && params !== null
              ? (params as Record<string, unknown>)
              : {};
          const matchedPolicy = policyStore.findMatchingPolicy(
            toolName,
            command,
            riskLevel,
            toolArgs,
          );

          if (matchedPolicy) {
            const allowed = matchedPolicy.kind === "always_allow";
            const decision: PermissionDecision = {
              toolName,
              toolKind: isExec ? "exec" : "tool",
              command,
              riskLevel,
              allowed,
              decidedBy: "policy",
              policyId: matchedPolicy.id,
              sessionKey,
              timestamp: new Date().toISOString(),
            };
            await audit.recordDecision(decision);

            if (!allowed) {
              return {
                block: true,
                blockReason: `Permission denied by policy "${matchedPolicy.id}" (${matchedPolicy.kind})`,
              };
            }

            return; // allowed by policy
          }
        }

        // Step 4: Non-exec tools without a matching policy
        // Only prompt for exec commands by default; non-exec tools pass through
        // unless defaultDeny is enabled
        if (!isExec) {
          if (cfg.defaultDeny) {
            const decision: PermissionDecision = {
              toolName,
              toolKind: "tool",
              riskLevel: "low",
              allowed: false,
              decidedBy: "deny_default",
              sessionKey,
              timestamp: new Date().toISOString(),
            };
            await audit.recordDecision(decision);
            return {
              block: true,
              blockReason: `Permission denied (default deny): no policy for tool "${toolName}"`,
            };
          }
          return; // allow non-exec tools when not defaultDeny
        }

        // Step 5: Default deny without prompt
        if (cfg.defaultDeny && !process.stdin.isTTY) {
          const decision: PermissionDecision = {
            toolName,
            toolKind: "exec",
            command,
            riskLevel,
            allowed: false,
            decidedBy: "deny_default",
            sessionKey,
            timestamp: new Date().toISOString(),
          };
          await audit.recordDecision(decision);
          return {
            block: true,
            blockReason: `Permission denied (default deny, no TTY): ${command ?? toolName}`,
          };
        }

        // Step 6: Prompt user
        const description = classification?.description ?? "Tool call requires approval";
        const promptResult = await promptUI.promptForPermission(
          toolName,
          command,
          riskLevel,
          description,
        );

        // Persist policy if user chose "always allow" or "never allow"
        if (promptResult.rememberPolicy && cfg.policyEnabled) {
          await policyStore.savePolicy(promptResult.rememberPolicy);
          api.logger.info(
            `interactive-permissions: saved policy "${promptResult.rememberPolicy.id}" (${promptResult.rememberPolicy.kind})`,
          );
        }

        const decision: PermissionDecision = {
          toolName,
          toolKind: "exec",
          command,
          riskLevel,
          allowed: promptResult.allowed,
          decidedBy: "user_prompt",
          policyId: promptResult.rememberPolicy?.id,
          sessionKey,
          timestamp: new Date().toISOString(),
        };
        await audit.recordDecision(decision);

        if (!promptResult.allowed) {
          return {
            block: true,
            blockReason: `Permission denied by user for: ${command ?? toolName}`,
          };
        }
      },
      { priority: 200 },
    );

    // ========================================================================
    // Tool: permissions_classify — classify a command's risk level
    // ========================================================================

    api.registerTool(
      {
        name: "permissions_classify",
        label: "Classify Command Risk",
        description:
          "Classify a shell command's risk level (safe, low, medium, high, critical) and return matched patterns.",
        parameters: Type.Object({
          command: Type.String({ description: "Shell command to classify" }),
        }),
        async execute(_toolCallId, params) {
          const { command: cmd } = params as { command: string };
          const result = classifyCommand(cmd);

          const lines = [
            `Risk Level: ${result.riskLevel.toUpperCase()}`,
            `Category: ${result.category}`,
            `Description: ${result.description}`,
          ];

          if (result.matchedPatterns.length > 0) {
            lines.push(`Matched Patterns:`);
            for (const p of result.matchedPatterns) {
              lines.push(`  - ${p}`);
            }
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {
              riskLevel: result.riskLevel,
              category: result.category,
              matchedPatterns: result.matchedPatterns,
            },
          };
        },
      },
      { name: "permissions_classify" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const perms = program
          .command("permissions")
          .description("Interactive permission management");

        // permissions list
        perms
          .command("list")
          .description("List stored permission policies")
          .action(async () => {
            const policies = policyStore.listPolicies();
            if (policies.length === 0) {
              console.log("No permission policies stored.");
              return;
            }

            console.log(`Permission Policies (${policies.length}):\n`);
            for (const p of policies) {
              const risk = p.maxRiskLevel ? ` (max risk: ${p.maxRiskLevel})` : "";
              console.log(`  ${p.id}`);
              console.log(`    kind: ${p.kind}`);
              console.log(`    matcher: ${p.matcher} (${p.matcherType})`);
              console.log(`    source: ${p.source}${risk}`);
              console.log(`    created: ${p.createdAt}`);
              console.log("");
            }
          });

        // permissions add <pattern>
        perms
          .command("add")
          .description("Add a permission policy")
          .argument("<pattern>", "Pattern to match against tool name or command")
          .option("--kind <kind>", "Policy kind: always_allow, always_deny, ask", "always_allow")
          .option("--type <type>", "Matcher type: exact, glob, regex, wildcard", "exact")
          .option("--risk <level>", "Maximum risk level for this policy")
          .action(async (pattern, options) => {
            const kind = options.kind as PermissionPolicyKind;
            if (!["always_allow", "always_deny", "ask"].includes(kind)) {
              console.log(`Invalid kind: ${kind}. Use always_allow, always_deny, or ask.`);
              return;
            }

            // Auto-detect wildcard expressions like "Bash(git:*)"
            let matcherType = options.type as "exact" | "glob" | "regex" | "wildcard";
            if (matcherType === "exact" && isWildcardExpression(pattern)) {
              matcherType = "wildcard";
            }

            if (!["exact", "glob", "regex", "wildcard"].includes(matcherType)) {
              console.log(`Invalid type: ${matcherType}. Use exact, glob, regex, or wildcard.`);
              return;
            }

            // Wildcard policies are stored with matcherType "exact" since the
            // wildcard expression in the matcher field is parsed at match time
            const storeMatcherType = matcherType === "wildcard" ? "exact" : matcherType;

            const id = generatePolicyId();
            await policyStore.savePolicy({
              id,
              kind,
              matcher: pattern,
              matcherType: storeMatcherType,
              maxRiskLevel: options.risk,
              createdAt: new Date().toISOString(),
              source: "manual",
            });

            console.log(`Policy "${id}" added (${kind}, ${matcherType}: ${pattern}).`);
          });

        // permissions remove <id>
        perms
          .command("remove")
          .description("Remove a permission policy")
          .argument("<id>", "Policy ID to remove")
          .action(async (id) => {
            const existing = policyStore.getPolicy(id);
            if (!existing) {
              console.log(`Policy "${id}" not found.`);
              return;
            }

            await policyStore.removePolicy(id);
            console.log(`Policy "${id}" removed.`);
          });

        // permissions audit
        perms
          .command("audit")
          .description("Show recent permission decisions")
          .option("--limit <n>", "Number of decisions to show", "20")
          .action(async (options) => {
            const limit = parseInt(options.limit, 10) || 20;
            const decisions = await audit.getRecentDecisions(limit);

            if (decisions.length === 0) {
              console.log("No permission decisions recorded.");
              return;
            }

            console.log(`Recent Permission Decisions (${decisions.length}):\n`);
            for (const d of decisions) {
              const status = d.allowed ? "ALLOWED" : "DENIED";
              const cmd = d.command
                ? ` cmd="${d.command.length > 50 ? d.command.slice(0, 47) + "..." : d.command}"`
                : "";
              console.log(
                `  [${d.timestamp}] ${status} tool=${d.toolName}${cmd} risk=${d.riskLevel} by=${d.decidedBy}`,
              );
            }
          });

        // permissions classify <cmd>
        perms
          .command("classify")
          .description("Test the intent classifier on a command")
          .argument("<cmd>", "Shell command to classify")
          .action(async (cmd) => {
            const result = classifyCommand(cmd);
            console.log(`Risk Level: ${result.riskLevel.toUpperCase()}`);
            console.log(`Category: ${result.category}`);
            console.log(`Description: ${result.description}`);
            if (result.matchedPatterns.length > 0) {
              console.log(`Matched Patterns:`);
              for (const p of result.matchedPatterns) {
                console.log(`  - ${p}`);
              }
            }
          });

        // permissions status
        perms
          .command("status")
          .description("Show interactive permissions status")
          .action(async () => {
            console.log("Interactive Permissions Status:");
            console.log(`  autoApproveSafe: ${cfg.autoApproveSafe}`);
            console.log(`  defaultDeny: ${cfg.defaultDeny}`);
            console.log(`  policyEnabled: ${cfg.policyEnabled}`);
            console.log(`  maxStoredDecisions: ${cfg.maxStoredDecisions}`);
            console.log(`  cortex: ${cortexAvailable ? "connected" : "unavailable"}`);
            console.log(`  policies: ${policyStore.size}`);
            console.log(`  audit entries: ${audit.size}`);
          });
      },
      { commands: ["permissions"] },
    );
  },
};

export default interactivePermissionsPlugin;

// Re-export for testing
export { classifyCommand } from "./intent-classifier.js";
export { PolicyStore, generatePolicyId } from "./policy-store.js";
export { CortexAudit } from "./cortex-audit.js";
export { PromptUI } from "./prompt-ui.js";
export { interactivePermissionsConfigSchema } from "./config.js";
export type { PermissionDecision } from "./cortex-audit.js";
export type { PermissionPolicy, PermissionPolicyKind } from "./policy-store.js";
export type { RiskLevel, IntentClassification } from "./intent-classifier.js";
export type { InteractivePermissionsConfig } from "./config.js";
export {
  parsePermissionWildcard,
  matchesWildcardPermission,
  isWildcardExpression,
} from "./wildcard-matcher.js";
export type { ParsedWildcard } from "./wildcard-matcher.js";

/**
 * Mayros Bash Sandbox Plugin
 *
 * Intercepts `exec` tool calls via the before_tool_call hook to enforce
 * command safety: blocklists, dangerous pattern detection, domain allowlists,
 * sudo restrictions, and command length limits.
 *
 * Modes:
 *   enforce — block dangerous commands (default)
 *   warn    — log but allow
 *   off     — disabled
 *
 * Hook: before_tool_call (priority 250)
 * Tool: bash_sandbox_test
 * CLI:  mayros sandbox status|test|allow|deny
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { AuditLog } from "./audit-log.js";
import { checkBlocklist, checkDangerousPatterns } from "./command-blocklist.js";
import { parseCommandChain } from "./command-parser.js";
import { bashSandboxConfigSchema, type BashSandboxConfig } from "./config.js";
import { checkDomains } from "./domain-checker.js";

// ============================================================================
// Helpers
// ============================================================================

/** Network commands that trigger domain checking. */
const NETWORK_COMMANDS = new Set(["curl", "wget", "http", "httpie"]);

type SandboxVerdict = {
  allowed: boolean;
  action: "allowed" | "blocked" | "warned";
  reasons: string[];
  matches: Array<{ pattern: string; severity: string; message: string }>;
};

/**
 * Run a command string through all sandbox checks and return a verdict.
 */
function evaluateCommand(command: string, cfg: BashSandboxConfig): SandboxVerdict {
  const reasons: string[] = [];
  const matches: Array<{ pattern: string; severity: string; message: string }> = [];
  let blocked = false;
  let warned = false;

  // 1. Command length check
  const byteLength = new TextEncoder().encode(command).length;
  if (byteLength > cfg.maxCommandLengthBytes) {
    reasons.push(`Command exceeds max length (${byteLength} > ${cfg.maxCommandLengthBytes} bytes)`);
    blocked = true;
    matches.push({
      pattern: "max-command-length",
      severity: "block",
      message: reasons[reasons.length - 1],
    });
  }

  // 2. Parse command chain
  const chain = parseCommandChain(command);

  // 3. Check command blocklist (filter out overrides)
  const effectiveBlocklist = cfg.commandBlocklist.filter(
    (cmd) => !cfg.commandAllowOverrides.includes(cmd),
  );
  const blocklistMatches = checkBlocklist(chain.commands, effectiveBlocklist);
  for (const match of blocklistMatches) {
    reasons.push(match.message);
    matches.push({
      pattern: match.matchedPattern,
      severity: match.severity,
      message: match.message,
    });
    if (match.severity === "block") blocked = true;
    if (match.severity === "warn") warned = true;
  }

  // 4. Check dangerous patterns
  const patternMatches = checkDangerousPatterns(command, cfg.dangerousPatterns);
  for (const match of patternMatches) {
    reasons.push(match.message);
    matches.push({
      pattern: match.matchedPattern,
      severity: match.severity,
      message: match.message,
    });
    if (match.severity === "block") blocked = true;
    if (match.severity === "warn") warned = true;
  }

  // 5. Check sudo
  if (!cfg.allowSudo) {
    for (const cmd of chain.commands) {
      if (cmd.hasSudo) {
        const msg = `sudo is not allowed (command: ${cmd.executable})`;
        reasons.push(msg);
        matches.push({ pattern: "sudo-blocked", severity: "block", message: msg });
        blocked = true;
      }
    }
  }

  // 6. Check domains for network commands (curl, wget, etc.)
  if (!cfg.allowCurlToArbitraryDomains) {
    const hasNetworkCommand = chain.commands.some((cmd) =>
      NETWORK_COMMANDS.has(cmd.executable.toLowerCase()),
    );

    if (hasNetworkCommand) {
      const domainResult = checkDomains(command, cfg.domainAllowlist, cfg.domainDenylist);
      if (!domainResult.allowed) {
        for (const domain of domainResult.blockedDomains) {
          const msg = `Domain not allowed: ${domain}`;
          reasons.push(msg);
          matches.push({
            pattern: `domain-blocked:${domain}`,
            severity: "block",
            message: msg,
          });
        }
        blocked = true;
      }
    }
  }

  if (blocked) {
    return { allowed: false, action: "blocked", reasons, matches };
  }

  if (warned) {
    return { allowed: true, action: "warned", reasons, matches };
  }

  return { allowed: true, action: "allowed", reasons: [], matches: [] };
}

// ============================================================================
// Plugin Definition
// ============================================================================

const bashSandboxPlugin = {
  id: "bash-sandbox",
  name: "Bash Sandbox",
  description:
    "Bash command sandbox with domain allowlist, command blocklist, and dangerous pattern detection",
  kind: "security" as const,
  configSchema: bashSandboxConfigSchema,

  async register(api: MayrosPluginApi) {
    const cfg = bashSandboxConfigSchema.parse(api.pluginConfig);
    const auditLog = new AuditLog(1000);

    // Session-scoped overrides (not persisted)
    const sessionAllowedDomains: string[] = [];
    const sessionBlockedCommands: string[] = [];

    api.logger.info(
      `bash-sandbox: registered (mode: ${cfg.mode}, blocklist: ${cfg.commandBlocklist.length} commands, allowlist: ${cfg.domainAllowlist.length} domains)`,
    );

    /**
     * Build effective config by merging session overrides.
     */
    function effectiveConfig(): BashSandboxConfig {
      return {
        ...cfg,
        domainAllowlist: [...cfg.domainAllowlist, ...sessionAllowedDomains],
        commandBlocklist: [...cfg.commandBlocklist, ...sessionBlockedCommands],
      };
    }

    // ========================================================================
    // Hook: before_tool_call — sandbox enforcement
    // ========================================================================

    api.on(
      "before_tool_call",
      async (event, _ctx) => {
        // Only intercept exec tool calls
        if (event.toolName !== "exec") return;

        const params = event.params;
        const command = typeof params.command === "string" ? params.command : "";

        if (!command) return;

        // Check bypass env var
        if (process.env[cfg.bypassEnvVar] === "1") {
          auditLog.add({ command, action: "allowed", reason: "bypass env var" });
          return;
        }

        // Mode: off — no enforcement
        if (cfg.mode === "off") {
          auditLog.add({ command, action: "allowed", reason: "mode: off" });
          return;
        }

        const verdict = evaluateCommand(command, effectiveConfig());

        if (verdict.action === "blocked") {
          auditLog.add({
            command,
            action: "blocked",
            reason: verdict.reasons.join("; "),
            matchedPattern: verdict.matches[0]?.pattern,
          });

          if (cfg.mode === "enforce") {
            api.logger.warn(`bash-sandbox: BLOCKED command: ${verdict.reasons.join("; ")}`);
            return {
              block: true,
              blockReason: `Bash sandbox blocked this command: ${verdict.reasons.join("; ")}`,
            };
          }

          // Mode: warn — log but don't block
          api.logger.warn(`bash-sandbox: WARNING (would block): ${verdict.reasons.join("; ")}`);
          auditLog.add({
            command,
            action: "warned",
            reason: verdict.reasons.join("; "),
            matchedPattern: verdict.matches[0]?.pattern,
          });
          return;
        }

        if (verdict.action === "warned") {
          api.logger.warn(`bash-sandbox: WARNING: ${verdict.reasons.join("; ")}`);
          auditLog.add({
            command,
            action: "warned",
            reason: verdict.reasons.join("; "),
            matchedPattern: verdict.matches[0]?.pattern,
          });
          return;
        }

        auditLog.add({ command, action: "allowed" });
      },
      { priority: 250 },
    );

    // ========================================================================
    // Tool: bash_sandbox_test — dry-run a command through the sandbox
    // ========================================================================

    api.registerTool(
      {
        name: "bash_sandbox_test",
        label: "Bash Sandbox Test",
        description:
          "Test a shell command against the bash sandbox rules without executing it. Returns whether the command would be allowed, blocked, or warned.",
        parameters: Type.Object({
          command: Type.String({ description: "Shell command to test" }),
        }),
        async execute(_toolCallId, params) {
          const { command } = params as { command: string };
          const verdict = evaluateCommand(command, effectiveConfig());

          const lines: string[] = [`Verdict: ${verdict.action.toUpperCase()}`, `Mode: ${cfg.mode}`];

          if (verdict.reasons.length > 0) {
            lines.push("Reasons:");
            for (const reason of verdict.reasons) {
              lines.push(`  - ${reason}`);
            }
          }

          if (verdict.matches.length > 0) {
            lines.push("Matched patterns:");
            for (const m of verdict.matches) {
              lines.push(`  - [${m.severity}] ${m.pattern}: ${m.message}`);
            }
          }

          const chain = parseCommandChain(command);
          lines.push(`\nParsed commands (${chain.commands.length}):`);
          for (const cmd of chain.commands) {
            const flags: string[] = [];
            if (cmd.hasSudo) flags.push("sudo");
            if (cmd.isPiped) flags.push("piped");
            if (cmd.isChained) flags.push("chained");
            if (cmd.isSubshell) flags.push("subshell");
            if (cmd.hasRedirect) flags.push("redirect");
            const flagStr = flags.length > 0 ? ` [${flags.join(", ")}]` : "";
            lines.push(`  ${cmd.executable} ${cmd.args.join(" ")}${flagStr}`);
          }

          return {
            content: [{ type: "text", text: lines.join("\n") }],
            details: {
              action: verdict.action,
              reasons: verdict.reasons,
              matches: verdict.matches,
              commandCount: chain.commands.length,
            },
          };
        },
      },
      { name: "bash_sandbox_test" },
    );

    // ========================================================================
    // CLI Commands
    // ========================================================================

    api.registerCli(
      ({ program }) => {
        const sandbox = program.command("sandbox").description("Bash command sandbox management");

        sandbox
          .command("status")
          .description("Show sandbox config and recent blocks")
          .action(async () => {
            console.log(`Bash Sandbox: ${cfg.mode.toUpperCase()}`);
            console.log(`  bypass env: ${cfg.bypassEnvVar}`);
            console.log(`  allowSudo: ${cfg.allowSudo}`);
            console.log(`  allowCurlToArbitraryDomains: ${cfg.allowCurlToArbitraryDomains}`);
            console.log(`  maxCommandLength: ${cfg.maxCommandLengthBytes} bytes`);
            console.log(`  blocklist: ${cfg.commandBlocklist.length} commands`);
            console.log(`  domainAllowlist: ${cfg.domainAllowlist.length} domains`);
            console.log(`  dangerousPatterns: ${cfg.dangerousPatterns.length} patterns`);
            console.log(`  sessionAllowedDomains: ${sessionAllowedDomains.length}`);
            console.log(`  sessionBlockedCommands: ${sessionBlockedCommands.length}`);
            console.log(`  auditLog entries: ${auditLog.size}`);

            const recent = auditLog.getBlocked(5);
            if (recent.length > 0) {
              console.log(`\nRecent blocks:`);
              for (const entry of recent) {
                const cmd =
                  entry.command.length > 60 ? entry.command.slice(0, 57) + "..." : entry.command;
                console.log(`  [${entry.timestamp}] ${cmd}`);
                if (entry.reason) {
                  console.log(`    reason: ${entry.reason}`);
                }
              }
            }
          });

        sandbox
          .command("test")
          .description("Dry-run a command through the sandbox")
          .argument("<command>", "Shell command to test")
          .action(async (command) => {
            const verdict = evaluateCommand(command, effectiveConfig());
            console.log(`Verdict: ${verdict.action.toUpperCase()}`);
            if (verdict.reasons.length > 0) {
              for (const reason of verdict.reasons) {
                console.log(`  - ${reason}`);
              }
            }
            if (verdict.matches.length > 0) {
              for (const m of verdict.matches) {
                console.log(`  [${m.severity}] ${m.pattern}: ${m.message}`);
              }
            }
            if (verdict.action === "allowed" && verdict.reasons.length === 0) {
              console.log("  Command passed all checks.");
            }
          });

        sandbox
          .command("allow")
          .description("Add a domain to the session allowlist")
          .argument("<domain>", "Domain to allow (e.g. api.example.com)")
          .action(async (domain) => {
            sessionAllowedDomains.push(domain);
            console.log(`Added "${domain}" to session allowlist.`);
            console.log(`Session allowlist now has ${sessionAllowedDomains.length} entries.`);
          });

        sandbox
          .command("deny")
          .description("Add a command to the session blocklist")
          .argument("<cmd>", "Command name to block (e.g. rm)")
          .action(async (cmd) => {
            sessionBlockedCommands.push(cmd);
            console.log(`Added "${cmd}" to session blocklist.`);
            console.log(`Session blocklist now has ${sessionBlockedCommands.length} entries.`);
          });
      },
      { commands: ["sandbox"] },
    );
  },
};

export default bashSandboxPlugin;

// Re-export for testing
export { evaluateCommand };
export type { SandboxVerdict };

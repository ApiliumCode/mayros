/**
 * Terminal Prompt UI.
 *
 * Presents interactive permission dialogs when a tool call requires explicit
 * user approval. Uses Node's readline module for terminal interaction.
 *
 * In non-TTY environments (CI, piped stdin), auto-denies to prevent hangs.
 *
 * User options:
 *   [A] Allow once         — allow this invocation only
 *   [D] Deny               — deny this invocation
 *   [a] Always allow       — allow + create persistent "always_allow" policy
 *   [N] Never allow        — deny + create persistent "always_deny" policy
 */

import { createInterface } from "node:readline";
import type { RiskLevel } from "./intent-classifier.js";
import type { PermissionPolicy, PermissionPolicyKind } from "./policy-store.js";
import { generatePolicyId } from "./policy-store.js";

// ============================================================================
// Types
// ============================================================================

export type PromptResult = {
  allowed: boolean;
  rememberPolicy?: PermissionPolicy;
};

// ============================================================================
// Risk Level Display
// ============================================================================

const RISK_COLORS: Record<RiskLevel, string> = {
  safe: "\x1b[32m", // green
  low: "\x1b[36m", // cyan
  medium: "\x1b[33m", // yellow
  high: "\x1b[31m", // red
  critical: "\x1b[35m", // magenta
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";

function formatRisk(level: RiskLevel): string {
  return `${RISK_COLORS[level]}${BOLD}${level.toUpperCase()}${RESET}`;
}

// ============================================================================
// Prompt UI
// ============================================================================

export class PromptUI {
  /**
   * Prompt the user for a permission decision.
   *
   * Returns immediately with denial if stdin is not a TTY.
   */
  async promptForPermission(
    toolName: string,
    command: string | undefined,
    riskLevel: RiskLevel,
    description: string,
  ): Promise<PromptResult> {
    // Non-TTY (CI mode): auto-deny
    if (!process.stdin.isTTY) {
      return { allowed: false };
    }

    const lines = [
      "",
      `${BOLD}=== Permission Required ===${RESET}`,
      `  Tool: ${BOLD}${toolName}${RESET}`,
    ];

    if (command) {
      const displayCmd = command.length > 80 ? command.slice(0, 77) + "..." : command;
      lines.push(`  Command: ${displayCmd}`);
    }

    lines.push(
      `  Risk: ${formatRisk(riskLevel)}`,
      `  Description: ${description}`,
      "",
      "  [A] Allow once  [D] Deny  [a] Always allow  [N] Never allow",
      "",
    );

    console.log(lines.join("\n"));

    const answer = await this.readLine("  Choose [A/D/a/N]: ");
    const choice = answer.trim();

    switch (choice) {
      case "A":
        return { allowed: true };

      case "D":
        return { allowed: false };

      case "a": {
        const matcher = command ?? toolName;
        const policy: PermissionPolicy = {
          id: generatePolicyId(),
          kind: "always_allow",
          matcher,
          matcherType: "exact",
          createdAt: new Date().toISOString(),
          source: "learned",
        };
        if (command) {
          policy.commandPattern = command;
        }
        return { allowed: true, rememberPolicy: policy };
      }

      case "N": {
        const matcher = command ?? toolName;
        const policy: PermissionPolicy = {
          id: generatePolicyId(),
          kind: "always_deny",
          matcher,
          matcherType: "exact",
          createdAt: new Date().toISOString(),
          source: "learned",
        };
        if (command) {
          policy.commandPattern = command;
        }
        return { allowed: false, rememberPolicy: policy };
      }

      default:
        // Unknown input — treat as deny for safety
        console.log("  Unknown choice — denying.");
        return { allowed: false };
    }
  }

  /**
   * Read a single line from stdin.
   */
  private readLine(prompt: string): Promise<string> {
    return new Promise((resolve) => {
      const rl = createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question(prompt, (answer) => {
        rl.close();
        resolve(answer);
      });
    });
  }
}

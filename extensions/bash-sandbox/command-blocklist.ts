/**
 * Command Blocklist & Dangerous Pattern Detection
 *
 * Checks parsed commands against a configurable blocklist and
 * detects dangerous shell patterns using regular expressions.
 */

import type { ParsedCommand } from "./command-parser.js";
import type { DangerousPattern } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type BlocklistMatch = {
  command: string;
  matchedPattern: string;
  severity: "block" | "warn";
  message: string;
};

// ============================================================================
// Default Dangerous Patterns
// ============================================================================

export const DEFAULT_DANGEROUS_PATTERNS: DangerousPattern[] = [
  {
    id: "recursive-delete-root",
    pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|-[a-zA-Z]*f[a-zA-Z]*r)[a-zA-Z]*\\s+/(?:\\s|$)",
    severity: "block",
    message: "Recursive deletion of root filesystem",
  },
  {
    id: "env-exfil-curl",
    pattern: "(env|printenv).*\\|.*(curl|wget)",
    severity: "block",
    message: "Environment exfiltration via HTTP",
  },
  {
    id: "reverse-shell",
    pattern: "(bash\\s+-i\\s+>&|nc\\s+(-[a-zA-Z]*e|--exec)|/dev/tcp/)",
    severity: "block",
    message: "Reverse shell detected",
  },
  {
    id: "crypto-mining",
    pattern: "(xmrig|stratum\\+tcp|coinhive)",
    severity: "block",
    message: "Crypto mining detected",
  },
  {
    id: "pipe-to-shell",
    pattern: "(curl|wget).*\\|.*(bash|sh|zsh)\\b",
    severity: "block",
    message: "Piping remote content to shell",
  },
  {
    id: "chmod-world-writable",
    pattern: "chmod\\s+(777|a\\+rwx)\\s+/",
    severity: "warn",
    message: "World-writable permissions on system path",
  },
];

// ============================================================================
// Blocklist Checking
// ============================================================================

/**
 * Check a list of parsed commands against the command blocklist.
 *
 * A command matches the blocklist if its executable name (lowercase)
 * equals any entry in the blocklist. The match is exact on the basename
 * of the executable (stripping any path prefix).
 *
 * @param commands - Parsed commands from `parseCommandChain`.
 * @param blocklist - Array of blocked command names.
 * @returns Array of matches found.
 */
export function checkBlocklist(commands: ParsedCommand[], blocklist: string[]): BlocklistMatch[] {
  const matches: BlocklistMatch[] = [];
  const blockSet = new Set(blocklist.map((cmd) => cmd.toLowerCase()));

  for (const cmd of commands) {
    if (!cmd.executable) continue;

    // Normalize: strip path prefix and lowercase
    const basename = cmd.executable.split("/").pop() ?? cmd.executable;
    const normalized = basename.toLowerCase();

    if (blockSet.has(normalized)) {
      matches.push({
        command: cmd.raw,
        matchedPattern: normalized,
        severity: "block",
        message: `Command "${normalized}" is in the blocklist`,
      });
    }
  }

  return matches;
}

// ============================================================================
// Dangerous Pattern Detection
// ============================================================================

/**
 * Check a raw command string against an array of dangerous patterns.
 *
 * Each pattern is compiled to a RegExp and tested against the full
 * raw command string. This catches cross-pipe patterns like
 * `curl ... | bash` that span multiple parsed commands.
 *
 * @param raw      - The original raw command string.
 * @param patterns - Array of dangerous pattern definitions.
 * @returns Array of matches found.
 */
export function checkDangerousPatterns(
  raw: string,
  patterns: DangerousPattern[],
): BlocklistMatch[] {
  const matches: BlocklistMatch[] = [];

  for (const pattern of patterns) {
    try {
      const regex = new RegExp(pattern.pattern, "i");
      if (regex.test(raw)) {
        matches.push({
          command: raw,
          matchedPattern: pattern.id,
          severity: pattern.severity,
          message: pattern.message,
        });
      }
    } catch {
      // Invalid regex in config — skip silently
      continue;
    }
  }

  return matches;
}

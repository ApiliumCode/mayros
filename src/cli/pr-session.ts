/**
 * PR Session Resume
 *
 * Resolves GitHub PR numbers to session keys, enabling session resumption
 * for pull request reviews and collaborative work.
 *
 * Uses the `gh` CLI to query PR metadata.
 *
 * Session key convention: `pr-{number}-{sanitized-branch}`
 */

import { execSync } from "node:child_process";

// ============================================================================
// Types
// ============================================================================

export type PrSessionInfo = {
  prNumber: number;
  branch: string;
  sessionKey: string;
  title?: string;
};

// ============================================================================
// Public API
// ============================================================================

/**
 * Resolve a PR number to a branch name using `gh` CLI.
 * Returns null if the PR is not found or `gh` is not available.
 */
export function resolvePrBranch(prNumber: number): string | null {
  try {
    const output = execSync(`gh pr view ${prNumber} --json headRefName --jq .headRefName`, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

/**
 * Get PR title.
 * Returns null if the PR is not found or `gh` is not available.
 */
export function resolvePrTitle(prNumber: number): string | null {
  try {
    const output = execSync(`gh pr view ${prNumber} --json title --jq .title`, {
      encoding: "utf-8",
      timeout: 10_000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
    return output || null;
  } catch {
    return null;
  }
}

/**
 * Build a session key from a PR number.
 * Convention: `pr-{number}-{sanitized-branch}`
 *
 * Branch names are sanitized:
 * - Only alphanumeric, hyphens, and underscores are kept
 * - Other characters are replaced with hyphens
 * - Truncated to 50 characters
 */
export function buildPrSessionKey(prNumber: number, branch: string): string {
  const safeBranch = branch.replace(/[^a-zA-Z0-9_-]/g, "-").slice(0, 50);
  return `pr-${prNumber}-${safeBranch}`;
}

/**
 * Resolve a PR number to full session info.
 * Queries GitHub via `gh` CLI and builds a session key.
 * Returns null if the PR cannot be resolved.
 */
export function resolvePrSession(prNumber: number): PrSessionInfo | null {
  const branch = resolvePrBranch(prNumber);
  if (!branch) return null;

  const title = resolvePrTitle(prNumber) ?? undefined;
  const sessionKey = buildPrSessionKey(prNumber, branch);

  return { prNumber, branch, sessionKey, title };
}

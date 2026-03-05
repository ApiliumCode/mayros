/**
 * Git Worktree Manager
 *
 * Low-level git worktree operations for parallel agent isolation.
 * Uses execFileSync consistent with src/infra/git-root.ts and git-commit.ts.
 */

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================

export type WorktreeInfo = {
  path: string;
  branch: string;
  baseBranch: string;
  createdAt: string;
};

export type WorktreeEntry = {
  path: string;
  head: string;
  branch: string;
  isBare: boolean;
};

export type GitWorktreeErrorCode =
  | "GIT_NOT_FOUND"
  | "WORKTREE_EXISTS"
  | "WORKTREE_NOT_FOUND"
  | "INVALID_NAME"
  | "BRANCH_EXISTS"
  | "COMMAND_FAILED";

export class GitWorktreeError extends Error {
  constructor(
    message: string,
    public readonly code: GitWorktreeErrorCode,
  ) {
    super(message);
    this.name = "GitWorktreeError";
  }
}

// ============================================================================
// Constants
// ============================================================================

const WORKTREE_BASE = ".mayros/worktrees";
const BRANCH_PREFIX = "mayros/worktree/";
const NAME_REGEX = /^[a-zA-Z][a-zA-Z0-9_-]*$/;

// ============================================================================
// Helpers
// ============================================================================

function validateName(name: string): void {
  if (!NAME_REGEX.test(name)) {
    throw new GitWorktreeError(
      `Invalid worktree name "${name}": must start with a letter and contain only letters, digits, hyphens, or underscores`,
      "INVALID_NAME",
    );
  }
}

function gitExec(repoRoot: string, args: string[]): string {
  try {
    return execFileSync("git", args, {
      cwd: repoRoot,
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes("ENOENT") || message.includes("not found")) {
      throw new GitWorktreeError("git executable not found", "GIT_NOT_FOUND");
    }
    throw new GitWorktreeError(`git command failed: ${message}`, "COMMAND_FAILED");
  }
}

function resolveCurrentBranch(repoRoot: string): string {
  const ref = gitExec(repoRoot, ["symbolic-ref", "--short", "HEAD"]);
  return ref || "HEAD";
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Create a new git worktree with a dedicated branch.
 */
export function createWorktree(opts: {
  repoRoot: string;
  name: string;
  baseBranch?: string;
}): WorktreeInfo {
  const { repoRoot, name, baseBranch } = opts;
  validateName(name);

  const worktreePath = path.join(repoRoot, WORKTREE_BASE, name);
  const branchName = `${BRANCH_PREFIX}${name}`;

  if (fs.existsSync(worktreePath)) {
    throw new GitWorktreeError(
      `Worktree "${name}" already exists at ${worktreePath}`,
      "WORKTREE_EXISTS",
    );
  }

  // Check if branch already exists
  try {
    gitExec(repoRoot, ["rev-parse", "--verify", `refs/heads/${branchName}`]);
    throw new GitWorktreeError(`Branch "${branchName}" already exists`, "BRANCH_EXISTS");
  } catch (err) {
    if (err instanceof GitWorktreeError && err.code === "BRANCH_EXISTS") {
      throw err;
    }
    // Branch doesn't exist — expected
  }

  const base = baseBranch ?? resolveCurrentBranch(repoRoot);

  // Ensure parent directory exists
  const parentDir = path.dirname(worktreePath);
  fs.mkdirSync(parentDir, { recursive: true });

  gitExec(repoRoot, ["worktree", "add", "-b", branchName, worktreePath, base]);

  return {
    path: worktreePath,
    branch: branchName,
    baseBranch: base,
    createdAt: new Date().toISOString(),
  };
}

/**
 * Remove a git worktree and its branch.
 */
export function removeWorktree(opts: { repoRoot: string; worktreePath: string }): void {
  const { repoRoot, worktreePath } = opts;

  if (!fs.existsSync(worktreePath)) {
    throw new GitWorktreeError(`Worktree not found at ${worktreePath}`, "WORKTREE_NOT_FOUND");
  }

  gitExec(repoRoot, ["worktree", "remove", worktreePath, "--force"]);

  // Clean up the branch if it was a mayros worktree branch
  const relPath = path.relative(repoRoot, worktreePath);
  const name = path.basename(relPath);
  const branchName = `${BRANCH_PREFIX}${name}`;

  try {
    gitExec(repoRoot, ["branch", "-D", branchName]);
  } catch {
    // Branch may already be gone or wasn't a mayros branch
  }
}

/**
 * List all git worktrees for the repository.
 */
export function listWorktrees(repoRoot: string): WorktreeEntry[] {
  const raw = gitExec(repoRoot, ["worktree", "list", "--porcelain"]);
  if (!raw) return [];

  const entries: WorktreeEntry[] = [];
  let current: Partial<WorktreeEntry> = {};

  for (const line of raw.split("\n")) {
    if (line.startsWith("worktree ")) {
      if (current.path) {
        entries.push({
          path: current.path,
          head: current.head ?? "",
          branch: current.branch ?? "",
          isBare: current.isBare ?? false,
        });
      }
      current = { path: line.slice("worktree ".length) };
    } else if (line.startsWith("HEAD ")) {
      current.head = line.slice("HEAD ".length);
    } else if (line.startsWith("branch ")) {
      const ref = line.slice("branch ".length);
      current.branch = ref.replace(/^refs\/heads\//, "");
    } else if (line === "bare") {
      current.isBare = true;
    }
  }

  if (current.path) {
    entries.push({
      path: current.path,
      head: current.head ?? "",
      branch: current.branch ?? "",
      isBare: current.isBare ?? false,
    });
  }

  return entries;
}

/**
 * Prune stale worktree metadata.
 */
export function pruneWorktrees(repoRoot: string): void {
  gitExec(repoRoot, ["worktree", "prune"]);
}

/**
 * Check if a path is inside a mayros worktree.
 */
export function isWorktreePath(checkPath: string, repoRoot: string): boolean {
  const worktreeBase = path.join(repoRoot, WORKTREE_BASE);
  const resolved = path.resolve(checkPath);
  return resolved.startsWith(worktreeBase + path.sep) || resolved === worktreeBase;
}

/**
 * Find the worktree entry that contains a given path.
 */
export function findWorktreeForPath(checkPath: string, repoRoot: string): WorktreeEntry | null {
  const resolved = path.resolve(checkPath);
  const entries = listWorktrees(repoRoot);

  // Find the most specific (longest path) matching worktree
  let best: WorktreeEntry | null = null;
  let bestLen = -1;

  for (const entry of entries) {
    const entryResolved = path.resolve(entry.path);
    if (
      (resolved.startsWith(entryResolved + path.sep) || resolved === entryResolved) &&
      entryResolved.length > bestLen
    ) {
      best = entry;
      bestLen = entryResolved.length;
    }
  }
  return best;
}

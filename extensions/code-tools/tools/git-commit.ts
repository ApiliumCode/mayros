/**
 * Git commit, push, and PR tools — Auto-commit + PR creation.
 *
 * Pure git utility functions using execFileSync (no shell injection)
 * plus tool registration for git_commit, git_push, and git_create_pr.
 */

import { execFileSync } from "node:child_process";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import type { CodeToolsConfig } from "../config.js";

// ============================================================================
// Types
// ============================================================================

export type CommitResult = {
  hash: string;
  message: string;
  branch: string;
  filesChanged: number;
};

export type PrResult = {
  number: number;
  url: string;
  title: string;
  branch: string;
};

export type GitStatusEntry = {
  status: string; // "M", "A", "D", "??"
  path: string;
};

// ============================================================================
// Git Utility Functions
// ============================================================================

/** Get current branch name. */
export function getCurrentBranch(cwd: string): string {
  return execFileSync("git", ["branch", "--show-current"], { cwd, encoding: "utf-8" }).trim();
}

/** Get git status (porcelain v1 format). */
export function getGitStatus(cwd: string): GitStatusEntry[] {
  const out = execFileSync("git", ["status", "--porcelain"], { cwd, encoding: "utf-8" });
  return out
    .split("\n")
    .filter((l) => l.length > 0)
    .map((line) => ({
      status: line.slice(0, 2).trim(),
      path: line.slice(3),
    }));
}

/** Get staged diff (for commit message context). */
export function getStagedDiff(cwd: string): string {
  try {
    return execFileSync("git", ["diff", "--cached", "--stat"], { cwd, encoding: "utf-8" }).trim();
  } catch {
    return "";
  }
}

/** Stage specific files. */
export function stageFiles(cwd: string, files: string[]): void {
  if (files.length === 0) return;
  execFileSync("git", ["add", ...files], { cwd, encoding: "utf-8" });
}

/** Stage all changes (tracked + untracked). */
export function stageAll(cwd: string): void {
  execFileSync("git", ["add", "-A"], { cwd, encoding: "utf-8" });
}

/** Create a commit. Returns the commit hash. */
export function createCommit(cwd: string, message: string): CommitResult {
  execFileSync("git", ["commit", "-m", message], { cwd, encoding: "utf-8" });
  const hash = execFileSync("git", ["rev-parse", "--short", "HEAD"], {
    cwd,
    encoding: "utf-8",
  }).trim();
  const branch = getCurrentBranch(cwd);
  const diffStat = execFileSync("git", ["diff", "--stat", "HEAD~1..HEAD"], {
    cwd,
    encoding: "utf-8",
  });
  const filesChanged = diffStat.split("\n").filter((l) => l.includes("|")).length;
  return { hash, message, branch, filesChanged };
}

/** Push current branch to remote. */
export function pushBranch(cwd: string, remote = "origin", setUpstream = false): string {
  const branch = getCurrentBranch(cwd);
  const args = ["push"];
  if (setUpstream) args.push("-u");
  args.push(remote, branch);
  return execFileSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  })
    .toString()
    .trim();
}

/** Check if gh CLI is available. */
export function isGhAvailable(): boolean {
  try {
    execFileSync("gh", ["--version"], { encoding: "utf-8", stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

/** Create a pull request using gh CLI. */
export function createPullRequest(
  cwd: string,
  opts: { title: string; body?: string; base?: string; draft?: boolean },
): PrResult {
  const args = ["pr", "create", "--title", opts.title];
  if (opts.body) args.push("--body", opts.body);
  if (opts.base) args.push("--base", opts.base);
  if (opts.draft) args.push("--draft");

  const output = execFileSync("gh", args, { cwd, encoding: "utf-8" }).trim();
  // gh pr create outputs the PR URL
  const url = output.split("\n").pop()?.trim() ?? output;

  // Extract PR number from URL
  const numberMatch = url.match(/\/pull\/(\d+)/);
  const number = numberMatch ? parseInt(numberMatch[1], 10) : 0;
  const branch = getCurrentBranch(cwd);

  return { number, url, title: opts.title, branch };
}

/** Get diff summary between current branch and base. */
export function getDiffSummary(cwd: string, base = "main"): string {
  try {
    const stat = execFileSync("git", ["diff", `${base}...HEAD`, "--stat"], {
      cwd,
      encoding: "utf-8",
    });
    return stat.trim();
  } catch {
    return "";
  }
}

/** Get list of commits between base and HEAD. */
export function getCommitLog(cwd: string, base = "main"): string {
  try {
    return execFileSync("git", ["log", `${base}..HEAD`, "--oneline", "--no-decorate"], {
      cwd,
      encoding: "utf-8",
    }).trim();
  } catch {
    return "";
  }
}

/** Check if there are uncommitted changes. */
export function hasUncommittedChanges(cwd: string): boolean {
  return getGitStatus(cwd).length > 0;
}

/** Check if remote tracking branch exists. */
export function hasRemoteTracking(cwd: string): boolean {
  try {
    execFileSync("git", ["rev-parse", "--abbrev-ref", "@{u}"], {
      cwd,
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Tool Registration
// ============================================================================

export function registerGitCommit(api: MayrosPluginApi, _cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "git_commit",
      label: "Git Commit",
      description: "Stage files and create a git commit. Can stage specific files or all changes.",
      parameters: Type.Object({
        message: Type.String({ description: "Commit message" }),
        files: Type.Optional(
          Type.Array(Type.String(), {
            description: "Files to stage. Omit to stage all changes.",
          }),
        ),
      }),
      async execute(_toolCallId, params) {
        const { message, files } = params as { message: string; files?: string[] };
        const cwd = _cfg.workspaceRoot;

        if (!hasUncommittedChanges(cwd) && !getStagedDiff(cwd)) {
          return {
            content: [{ type: "text" as const, text: "No changes to commit." }],
            details: { error: "no_changes" },
          };
        }

        if (files && files.length > 0) {
          stageFiles(cwd, files);
        } else {
          stageAll(cwd);
        }

        const result = createCommit(cwd, message);
        return {
          content: [
            {
              type: "text" as const,
              text: `Committed ${result.hash} on ${result.branch}: "${result.message}" (${result.filesChanged} file(s))`,
            },
          ],
          details: result,
        };
      },
    },
    { name: "git_commit" },
  );
}

export function registerGitPush(api: MayrosPluginApi, _cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "git_push",
      label: "Git Push",
      description: "Push current branch to remote. Automatically sets upstream if needed.",
      parameters: Type.Object({
        remote: Type.Optional(Type.String({ description: "Remote name (default: origin)" })),
      }),
      async execute(_toolCallId, params) {
        const { remote } = params as { remote?: string };
        const cwd = _cfg.workspaceRoot;
        const branch = getCurrentBranch(cwd);
        const needsUpstream = !hasRemoteTracking(cwd);

        try {
          pushBranch(cwd, remote ?? "origin", needsUpstream);
          return {
            content: [
              {
                type: "text" as const,
                text: `Pushed ${branch} to ${remote ?? "origin"}${needsUpstream ? " (set upstream)" : ""}`,
              },
            ],
            details: { branch, remote: remote ?? "origin", setUpstream: needsUpstream },
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `Push failed: ${String(err)}` }],
            details: { error: String(err) },
          };
        }
      },
    },
    { name: "git_push" },
  );
}

export function registerGitCreatePr(api: MayrosPluginApi, _cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "git_create_pr",
      label: "Create Pull Request",
      description: "Create a GitHub pull request for the current branch using gh CLI.",
      parameters: Type.Object({
        title: Type.String({ description: "PR title" }),
        body: Type.Optional(Type.String({ description: "PR description (markdown)" })),
        base: Type.Optional(Type.String({ description: "Base branch (default: main)" })),
        draft: Type.Optional(Type.Boolean({ description: "Create as draft PR" })),
      }),
      async execute(_toolCallId, params) {
        const { title, body, base, draft } = params as {
          title: string;
          body?: string;
          base?: string;
          draft?: boolean;
        };
        const cwd = _cfg.workspaceRoot;

        if (!isGhAvailable()) {
          return {
            content: [
              {
                type: "text" as const,
                text: "GitHub CLI (gh) is not installed. Install it from https://cli.github.com/",
              },
            ],
            details: { error: "gh_not_available" },
          };
        }

        // Ensure branch is pushed
        const branch = getCurrentBranch(cwd);
        if (!hasRemoteTracking(cwd)) {
          try {
            pushBranch(cwd, "origin", true);
          } catch (err) {
            return {
              content: [
                {
                  type: "text" as const,
                  text: `Failed to push branch: ${String(err)}`,
                },
              ],
              details: { error: String(err) },
            };
          }
        }

        try {
          const result = createPullRequest(cwd, { title, body, base, draft });
          return {
            content: [
              {
                type: "text" as const,
                text: `PR #${result.number} created: ${result.url}`,
              },
            ],
            details: result,
          };
        } catch (err) {
          return {
            content: [{ type: "text" as const, text: `PR creation failed: ${String(err)}` }],
            details: { error: String(err) },
          };
        }
      },
    },
    { name: "git_create_pr" },
  );
}

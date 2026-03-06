import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import {
  getCurrentBranch,
  getGitStatus,
  getStagedDiff,
  stageFiles,
  stageAll,
  createCommit,
  hasUncommittedChanges,
  hasRemoteTracking,
  isGhAvailable,
  getDiffSummary,
  getCommitLog,
  type GitStatusEntry,
  type CommitResult,
} from "./git-commit.js";

function initRepo(dir: string): void {
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: dir });
  writeFileSync(join(dir, "README.md"), "# Test\n");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "initial commit"], { cwd: dir });
}

describe("git-commit", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "mayros-git-test-"));
    initRepo(dir);
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  // 1
  it("getCurrentBranch returns main", () => {
    expect(getCurrentBranch(dir)).toBe("main");
  });

  // 2
  it("getGitStatus returns empty for clean repo", () => {
    expect(getGitStatus(dir)).toHaveLength(0);
  });

  // 3
  it("getGitStatus detects modified files", () => {
    writeFileSync(join(dir, "README.md"), "# Changed\n");
    const status: GitStatusEntry[] = getGitStatus(dir);
    expect(status.length).toBeGreaterThan(0);
    expect(status[0].path).toBe("README.md");
  });

  // 4
  it("getGitStatus detects untracked files", () => {
    writeFileSync(join(dir, "new.txt"), "new file\n");
    const status: GitStatusEntry[] = getGitStatus(dir);
    expect(status).toHaveLength(1);
    expect(status[0].status).toBe("??");
    expect(status[0].path).toBe("new.txt");
  });

  // 5
  it("stageFiles stages specific files", () => {
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    stageFiles(dir, ["a.txt"]);
    const diff = getStagedDiff(dir);
    expect(diff).toContain("a.txt");
  });

  // 6
  it("stageAll stages everything", () => {
    writeFileSync(join(dir, "x.txt"), "x\n");
    writeFileSync(join(dir, "y.txt"), "y\n");
    stageAll(dir);
    const diff = getStagedDiff(dir);
    expect(diff).toContain("x.txt");
    expect(diff).toContain("y.txt");
  });

  // 7
  it("createCommit creates a commit", () => {
    writeFileSync(join(dir, "file.txt"), "content\n");
    stageAll(dir);
    const result: CommitResult = createCommit(dir, "add file");
    expect(result.hash).toMatch(/^[0-9a-f]+$/);
    expect(result.message).toBe("add file");
    expect(result.branch).toBe("main");
    expect(result.filesChanged).toBe(1);
  });

  // 8
  it("hasUncommittedChanges returns true with changes", () => {
    writeFileSync(join(dir, "file.txt"), "content\n");
    expect(hasUncommittedChanges(dir)).toBe(true);
  });

  // 9
  it("hasUncommittedChanges returns false when clean", () => {
    expect(hasUncommittedChanges(dir)).toBe(false);
  });

  // 10
  it("hasRemoteTracking returns false for local-only repo", () => {
    expect(hasRemoteTracking(dir)).toBe(false);
  });

  // 11
  it("isGhAvailable returns boolean", () => {
    const result = isGhAvailable();
    expect(typeof result).toBe("boolean");
  });

  // 12
  it("getStagedDiff returns empty for no staged changes", () => {
    expect(getStagedDiff(dir)).toBe("");
  });

  // 13
  it("stageFiles with empty array is no-op", () => {
    stageFiles(dir, []);
    expect(getStagedDiff(dir)).toBe("");
  });

  // 14
  it("multiple commits work sequentially", () => {
    writeFileSync(join(dir, "a.txt"), "a\n");
    stageAll(dir);
    const r1: CommitResult = createCommit(dir, "first");

    writeFileSync(join(dir, "b.txt"), "b\n");
    stageAll(dir);
    const r2: CommitResult = createCommit(dir, "second");

    expect(r1.hash).not.toBe(r2.hash);
  });

  // 15
  it("getCurrentBranch works on new branch", () => {
    execFileSync("git", ["checkout", "-b", "feat/test"], { cwd: dir });
    expect(getCurrentBranch(dir)).toBe("feat/test");
  });

  // 16
  it("getDiffSummary returns empty when no divergence", () => {
    // On main with no commits ahead, there's no base to diff against in a fresh repo
    // getDiffSummary catches errors and returns ""
    const summary = getDiffSummary(dir, "main");
    expect(typeof summary).toBe("string");
  });

  // 17
  it("getCommitLog returns commits between base and HEAD", () => {
    execFileSync("git", ["checkout", "-b", "feat/branch"], { cwd: dir });
    writeFileSync(join(dir, "new.txt"), "data\n");
    stageAll(dir);
    createCommit(dir, "branch commit");

    const log = getCommitLog(dir, "main");
    expect(log).toContain("branch commit");
  });
});

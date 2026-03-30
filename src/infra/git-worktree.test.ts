/**
 * Git Worktree Manager Tests
 *
 * Tests use mocked execFileSync to avoid real git operations.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import path from "node:path";

// Mock child_process before importing the module
vi.mock("node:child_process", () => ({
  execFileSync: vi.fn(),
}));

vi.mock("node:fs", () => {
  const actual = vi.importActual("node:fs");
  return {
    ...actual,
    default: {
      existsSync: vi.fn(),
      mkdirSync: vi.fn(),
    },
    existsSync: vi.fn(),
    mkdirSync: vi.fn(),
  };
});

import { execFileSync } from "node:child_process";
import fs from "node:fs";

const mockedExec = vi.mocked(execFileSync);
const mockedExistsSync = vi.mocked(fs.existsSync);
const mockedMkdirSync = vi.mocked(fs.mkdirSync);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("git-worktree", () => {
  // ========================================================================
  // createWorktree
  // ========================================================================

  describe("createWorktree", () => {
    it("creates a worktree with default base branch", async () => {
      const { createWorktree } = await import("./git-worktree.js");

      mockedExistsSync.mockReturnValue(false);
      mockedMkdirSync.mockReturnValue(undefined);

      // First call: rev-parse --verify (branch check — should fail)
      // Second call: symbolic-ref --short HEAD
      // Third call: worktree add
      let callIdx = 0;
      mockedExec.mockImplementation((_cmd, args) => {
        callIdx++;
        const argArr = args as string[];

        if (argArr[0] === "rev-parse" && argArr[1] === "--verify") {
          throw new Error("not a valid ref");
        }
        if (argArr[0] === "symbolic-ref") {
          return "main" as never;
        }
        if (argArr[0] === "worktree" && argArr[1] === "add") {
          return "" as never;
        }
        return "" as never;
      });

      const repoRoot = path.resolve("/repo");
      const result = createWorktree({ repoRoot, name: "feature-a" });

      expect(result.path).toBe(path.join(repoRoot, ".mayros/worktrees/feature-a"));
      expect(result.branch).toBe("mayros/worktree/feature-a");
      expect(result.baseBranch).toBe("main");
      expect(result.createdAt).toBeTruthy();
    });

    it("creates a worktree with explicit base branch", async () => {
      const { createWorktree } = await import("./git-worktree.js");

      mockedExistsSync.mockReturnValue(false);
      mockedMkdirSync.mockReturnValue(undefined);

      mockedExec.mockImplementation((_cmd, args) => {
        const argArr = args as string[];
        if (argArr[0] === "rev-parse") throw new Error("not a valid ref");
        return "" as never;
      });

      const result = createWorktree({
        repoRoot: "/repo",
        name: "hotfix",
        baseBranch: "develop",
      });

      expect(result.baseBranch).toBe("develop");
      expect(result.branch).toBe("mayros/worktree/hotfix");
    });

    it("throws WORKTREE_EXISTS when directory already exists", async () => {
      const { createWorktree, GitWorktreeError } = await import("./git-worktree.js");

      mockedExistsSync.mockReturnValue(true);

      expect(() => createWorktree({ repoRoot: "/repo", name: "existing" })).toThrow(
        GitWorktreeError,
      );

      try {
        createWorktree({ repoRoot: "/repo", name: "existing" });
      } catch (err) {
        expect((err as InstanceType<typeof GitWorktreeError>).code).toBe("WORKTREE_EXISTS");
      }
    });

    it("throws BRANCH_EXISTS when branch already exists", async () => {
      const { createWorktree, GitWorktreeError } = await import("./git-worktree.js");

      mockedExistsSync.mockReturnValue(false);
      mockedMkdirSync.mockReturnValue(undefined);

      // rev-parse succeeds → branch exists
      mockedExec.mockImplementation((_cmd, args) => {
        const argArr = args as string[];
        if (argArr[0] === "rev-parse") return "abc1234" as never;
        return "" as never;
      });

      expect(() => createWorktree({ repoRoot: "/repo", name: "taken" })).toThrow(GitWorktreeError);

      try {
        createWorktree({ repoRoot: "/repo", name: "taken" });
      } catch (err) {
        expect((err as InstanceType<typeof GitWorktreeError>).code).toBe("BRANCH_EXISTS");
      }
    });

    it("throws INVALID_NAME for names starting with digit", async () => {
      const { createWorktree, GitWorktreeError } = await import("./git-worktree.js");

      expect(() => createWorktree({ repoRoot: "/repo", name: "123bad" })).toThrow(GitWorktreeError);

      try {
        createWorktree({ repoRoot: "/repo", name: "123bad" });
      } catch (err) {
        expect((err as InstanceType<typeof GitWorktreeError>).code).toBe("INVALID_NAME");
      }
    });

    it("throws INVALID_NAME for names with special characters", async () => {
      const { createWorktree } = await import("./git-worktree.js");

      expect(() => createWorktree({ repoRoot: "/repo", name: "bad name" })).toThrow(/Invalid/);
      expect(() => createWorktree({ repoRoot: "/repo", name: "bad.name" })).toThrow(/Invalid/);
      expect(() => createWorktree({ repoRoot: "/repo", name: "" })).toThrow(/Invalid/);
    });

    it("throws GIT_NOT_FOUND when git is missing", async () => {
      const { createWorktree, GitWorktreeError } = await import("./git-worktree.js");

      mockedExistsSync.mockReturnValue(false);
      mockedMkdirSync.mockReturnValue(undefined);

      mockedExec.mockImplementation(() => {
        const err = new Error("ENOENT") as NodeJS.ErrnoException;
        err.code = "ENOENT";
        throw err;
      });

      try {
        createWorktree({ repoRoot: "/repo", name: "test" });
      } catch (err) {
        expect(err).toBeInstanceOf(GitWorktreeError);
        expect((err as InstanceType<typeof GitWorktreeError>).code).toBe("GIT_NOT_FOUND");
      }
    });
  });

  // ========================================================================
  // removeWorktree
  // ========================================================================

  describe("removeWorktree", () => {
    it("removes an existing worktree", async () => {
      const { removeWorktree } = await import("./git-worktree.js");

      mockedExistsSync.mockReturnValue(true);
      mockedExec.mockReturnValue("" as never);

      expect(() =>
        removeWorktree({ repoRoot: "/repo", worktreePath: "/repo/.mayros/worktrees/old" }),
      ).not.toThrow();
    });

    it("throws WORKTREE_NOT_FOUND when path missing", async () => {
      const { removeWorktree, GitWorktreeError } = await import("./git-worktree.js");

      mockedExistsSync.mockReturnValue(false);

      try {
        removeWorktree({ repoRoot: "/repo", worktreePath: "/repo/.mayros/worktrees/gone" });
      } catch (err) {
        expect(err).toBeInstanceOf(GitWorktreeError);
        expect((err as InstanceType<typeof GitWorktreeError>).code).toBe("WORKTREE_NOT_FOUND");
      }
    });
  });

  // ========================================================================
  // listWorktrees
  // ========================================================================

  describe("listWorktrees", () => {
    it("parses porcelain output correctly", async () => {
      const { listWorktrees } = await import("./git-worktree.js");

      const porcelain = [
        "worktree /repo",
        "HEAD abc1234def5678",
        "branch refs/heads/main",
        "",
        "worktree /repo/.mayros/worktrees/feature-a",
        "HEAD def5678abc1234",
        "branch refs/heads/mayros/worktree/feature-a",
        "",
      ].join("\n");

      mockedExec.mockReturnValue(porcelain as never);

      const entries = listWorktrees("/repo");

      expect(entries).toHaveLength(2);
      expect(entries[0].path).toBe("/repo");
      expect(entries[0].head).toBe("abc1234def5678");
      expect(entries[0].branch).toBe("main");
      expect(entries[0].isBare).toBe(false);
      expect(entries[1].path).toBe("/repo/.mayros/worktrees/feature-a");
      expect(entries[1].branch).toBe("mayros/worktree/feature-a");
    });

    it("handles empty output", async () => {
      const { listWorktrees } = await import("./git-worktree.js");

      mockedExec.mockReturnValue("" as never);

      const entries = listWorktrees("/repo");
      expect(entries).toHaveLength(0);
    });

    it("handles bare worktree entries", async () => {
      const { listWorktrees } = await import("./git-worktree.js");

      const porcelain = ["worktree /repo", "HEAD abc123", "bare", ""].join("\n");

      mockedExec.mockReturnValue(porcelain as never);

      const entries = listWorktrees("/repo");
      expect(entries).toHaveLength(1);
      expect(entries[0].isBare).toBe(true);
    });
  });

  // ========================================================================
  // pruneWorktrees
  // ========================================================================

  describe("pruneWorktrees", () => {
    it("calls git worktree prune", async () => {
      const { pruneWorktrees } = await import("./git-worktree.js");

      mockedExec.mockReturnValue("" as never);

      pruneWorktrees("/repo");

      expect(mockedExec).toHaveBeenCalledWith(
        "git",
        ["worktree", "prune"],
        expect.objectContaining({ cwd: "/repo" }),
      );
    });
  });

  // ========================================================================
  // isWorktreePath
  // ========================================================================

  describe("isWorktreePath", () => {
    it("returns true for paths inside worktree base", async () => {
      const { isWorktreePath } = await import("./git-worktree.js");
      const repoRoot = path.resolve("/repo");

      expect(isWorktreePath(path.join(repoRoot, ".mayros/worktrees/feature-a"), repoRoot)).toBe(
        true,
      );
      expect(
        isWorktreePath(path.join(repoRoot, ".mayros/worktrees/feature-a/src/file.ts"), repoRoot),
      ).toBe(true);
    });

    it("returns false for paths outside worktree base", async () => {
      const { isWorktreePath } = await import("./git-worktree.js");
      const repoRoot = path.resolve("/repo");

      expect(isWorktreePath(path.join(repoRoot, "src/file.ts"), repoRoot)).toBe(false);
      expect(isWorktreePath(path.resolve("/other/path"), repoRoot)).toBe(false);
    });
  });

  // ========================================================================
  // findWorktreeForPath
  // ========================================================================

  describe("findWorktreeForPath", () => {
    it("finds matching worktree entry", async () => {
      const { findWorktreeForPath } = await import("./git-worktree.js");

      const porcelain = [
        "worktree /repo",
        "HEAD abc123",
        "branch refs/heads/main",
        "",
        "worktree /repo/.mayros/worktrees/feature-a",
        "HEAD def456",
        "branch refs/heads/mayros/worktree/feature-a",
        "",
      ].join("\n");

      mockedExec.mockReturnValue(porcelain as never);

      const entry = findWorktreeForPath("/repo/.mayros/worktrees/feature-a/src/file.ts", "/repo");

      expect(entry).not.toBeNull();
      expect(entry!.branch).toBe("mayros/worktree/feature-a");
    });

    it("returns null when no worktree matches", async () => {
      const { findWorktreeForPath } = await import("./git-worktree.js");

      mockedExec.mockReturnValue("" as never);

      const entry = findWorktreeForPath("/unrelated/path", "/repo");
      expect(entry).toBeNull();
    });
  });
});

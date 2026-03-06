import { describe, it, expect } from "vitest";
import { parseDiffStats } from "../../../src/tui/diff-renderer.js";

describe("parseDiffStats", () => {
  it("counts additions and deletions from unified diff", () => {
    const diff = [
      "diff --git a/file.ts b/file.ts",
      "--- a/file.ts",
      "+++ b/file.ts",
      "@@ -1,3 +1,4 @@",
      " line1",
      "-old line",
      "+new line",
      "+extra line",
      " line3",
    ].join("\n");
    const stats = parseDiffStats(diff);
    expect(stats).toEqual({ files: 1, additions: 2, deletions: 1 });
  });

  it("counts from simple +/- snippet (no diff headers)", () => {
    const snippet = ["-removed", "+added1", "+added2"].join("\n");
    const stats = parseDiffStats(snippet);
    expect(stats).toEqual({ files: 1, additions: 2, deletions: 1 });
  });

  it("handles multi-file diff", () => {
    const diff = [
      "diff --git a/a.ts b/a.ts",
      "--- a/a.ts",
      "+++ b/a.ts",
      "@@ -1,2 +1,2 @@",
      "-old",
      "+new",
      "diff --git a/b.ts b/b.ts",
      "--- a/b.ts",
      "+++ b/b.ts",
      "@@ -1,2 +1,3 @@",
      " keep",
      "+added",
    ].join("\n");
    const stats = parseDiffStats(diff);
    expect(stats).toEqual({ files: 2, additions: 2, deletions: 1 });
  });

  it("returns zero counts for empty string", () => {
    const stats = parseDiffStats("");
    expect(stats).toEqual({ files: 1, additions: 0, deletions: 0 });
  });

  it("ignores --- and +++ header lines", () => {
    const diff = ["--- a/file.ts", "+++ b/file.ts", "-actual deletion", "+actual addition"].join(
      "\n",
    );
    const stats = parseDiffStats(diff);
    expect(stats.additions).toBe(1);
    expect(stats.deletions).toBe(1);
  });

  it("handles diff with only additions", () => {
    const diff = ["+line1", "+line2", "+line3"].join("\n");
    const stats = parseDiffStats(diff);
    expect(stats).toEqual({ files: 1, additions: 3, deletions: 0 });
  });

  it("handles diff with only deletions", () => {
    const diff = ["-line1", "-line2"].join("\n");
    const stats = parseDiffStats(diff);
    expect(stats).toEqual({ files: 1, additions: 0, deletions: 2 });
  });

  it("handles context lines without counting them", () => {
    const diff = [" context1", "-removed", " context2", "+added", " context3"].join("\n");
    const stats = parseDiffStats(diff);
    expect(stats).toEqual({ files: 1, additions: 1, deletions: 1 });
  });
});

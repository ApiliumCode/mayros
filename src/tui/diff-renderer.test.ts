import { describe, expect, it } from "vitest";
import { parseDiffLines, renderDiff, renderDiffStats } from "./diff-renderer.js";

const stripAnsi = (str: string) =>
  str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

const SAMPLE_DIFF = `diff --git a/src/foo.ts b/src/foo.ts
index abc1234..def5678 100644
--- a/src/foo.ts
+++ b/src/foo.ts
@@ -1,5 +1,6 @@
 const x = 1;
-const y = 2;
+const y = 3;
+const z = 4;
 const a = 5;`;

describe("parseDiffLines", () => {
  it("classifies all line types", () => {
    const lines = parseDiffLines(SAMPLE_DIFF);
    const types = lines.map((l) => l.type);
    expect(types).toContain("header");
    expect(types).toContain("hunk");
    expect(types).toContain("add");
    expect(types).toContain("del");
    expect(types).toContain("context");
  });

  it("classifies diff --git as header", () => {
    const lines = parseDiffLines(SAMPLE_DIFF);
    expect(lines[0]?.type).toBe("header");
    expect(lines[0]?.text).toContain("diff --git");
  });

  it("classifies @@ as hunk", () => {
    const lines = parseDiffLines(SAMPLE_DIFF);
    const hunks = lines.filter((l) => l.type === "hunk");
    expect(hunks).toHaveLength(1);
    expect(hunks[0]?.text).toMatch(/^@@/);
  });

  it("classifies + lines as add", () => {
    const lines = parseDiffLines(SAMPLE_DIFF);
    const adds = lines.filter((l) => l.type === "add");
    expect(adds).toHaveLength(2);
  });

  it("classifies - lines as del", () => {
    const lines = parseDiffLines(SAMPLE_DIFF);
    const dels = lines.filter((l) => l.type === "del");
    expect(dels).toHaveLength(1);
  });

  it("handles empty input", () => {
    expect(parseDiffLines("")).toEqual([{ type: "context", text: "" }]);
  });
});

describe("renderDiff", () => {
  it("returns styled lines", () => {
    const rendered = renderDiff(SAMPLE_DIFF);
    expect(rendered.length).toBeGreaterThan(0);
    // All lines should have text content when stripped
    for (const line of rendered) {
      expect(typeof line).toBe("string");
    }
  });

  it("preserves text content", () => {
    const rendered = renderDiff(SAMPLE_DIFF);
    const stripped = rendered.map(stripAnsi);
    expect(stripped).toContain("+const y = 3;");
    expect(stripped).toContain("-const y = 2;");
  });
});

describe("renderDiffStats", () => {
  it("counts files, additions, and deletions", () => {
    const stats = renderDiffStats(SAMPLE_DIFF);
    expect(stats.files).toBe(1);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
  });

  it("handles multiple files", () => {
    const multi = `diff --git a/src/a.ts b/src/a.ts
+added line
diff --git a/src/b.ts b/src/b.ts
-removed line
+new line`;
    const stats = renderDiffStats(multi);
    expect(stats.files).toBe(2);
    expect(stats.additions).toBe(2);
    expect(stats.deletions).toBe(1);
  });

  it("returns zeros for empty diff", () => {
    const stats = renderDiffStats("");
    expect(stats.files).toBe(0);
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
  });

  it("handles diff with no changes", () => {
    const noChanges = `diff --git a/src/foo.ts b/src/foo.ts
 context line only`;
    const stats = renderDiffStats(noChanges);
    expect(stats.files).toBe(1);
    expect(stats.additions).toBe(0);
    expect(stats.deletions).toBe(0);
  });
});

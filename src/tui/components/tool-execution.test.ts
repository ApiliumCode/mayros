import chalk from "chalk";
import { describe, expect, it } from "vitest";
import {
  formatDiffStatsLine,
  parseDiffStats,
  renderDiff,
  type DiffStats,
} from "../diff-renderer.js";

const stripAnsi = (str: string) =>
  str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

// Constants mirrored from tool-execution.ts for testing the logic
const DIFF_TOOLS = new Set(["code_edit", "code_write", "code_multi_edit"]);
const DIFF_PREVIEW_LINES = 20;

// ────────────────────────────────────────────────────────────────────
// formatDiffStatsLine
// ────────────────────────────────────────────────────────────────────
describe("formatDiffStatsLine", () => {
  it("shows green additions only", () => {
    const stats: DiffStats = { files: 1, additions: 5, deletions: 0 };
    const result = formatDiffStatsLine(stats);
    const stripped = stripAnsi(result);
    expect(stripped).toBe("+5 (1 file)");
    expect(result).toContain(chalk.green("+5"));
  });

  it("shows red deletions only", () => {
    const stats: DiffStats = { files: 1, additions: 0, deletions: 3 };
    const result = formatDiffStatsLine(stats);
    const stripped = stripAnsi(result);
    expect(stripped).toBe("-3 (1 file)");
    expect(result).toContain(chalk.red("-3"));
  });

  it("shows both additions and deletions with file count", () => {
    const stats: DiffStats = { files: 2, additions: 7, deletions: 4 };
    const result = formatDiffStatsLine(stats);
    const stripped = stripAnsi(result);
    expect(stripped).toBe("+7 -4 (2 files)");
    expect(result).toContain(chalk.green("+7"));
    expect(result).toContain(chalk.red("-4"));
  });

  it("shows only file label when no additions or deletions", () => {
    const stats: DiffStats = { files: 1, additions: 0, deletions: 0 };
    const result = formatDiffStatsLine(stats);
    expect(result).toBe("(1 file)");
  });

  it("uses plural for multiple files", () => {
    const stats: DiffStats = { files: 3, additions: 1, deletions: 0 };
    const result = formatDiffStatsLine(stats);
    const stripped = stripAnsi(result);
    expect(stripped).toBe("+1 (3 files)");
  });
});

// ────────────────────────────────────────────────────────────────────
// Diff tool detection (DIFF_TOOLS set)
// ────────────────────────────────────────────────────────────────────
describe("diff tool detection", () => {
  it("recognizes code_edit as a diff tool", () => {
    expect(DIFF_TOOLS.has("code_edit")).toBe(true);
  });

  it("recognizes code_write as a diff tool", () => {
    expect(DIFF_TOOLS.has("code_write")).toBe(true);
  });

  it("recognizes code_multi_edit as a diff tool", () => {
    expect(DIFF_TOOLS.has("code_multi_edit")).toBe(true);
  });

  it("does not recognize unknown tools as diff tools", () => {
    expect(DIFF_TOOLS.has("bash")).toBe(false);
    expect(DIFF_TOOLS.has("web_search")).toBe(false);
    expect(DIFF_TOOLS.has("code_read")).toBe(false);
  });
});

// ────────────────────────────────────────────────────────────────────
// Diff preview logic (expand/collapse + stats line behavior)
// ────────────────────────────────────────────────────────────────────

/**
 * Simulates the diff preview logic from ToolExecutionComponent.refresh().
 * This mirrors the exact branching used in the component.
 */
function buildDiffDisplay(raw: string, expanded: boolean): string[] {
  const colored = renderDiff(raw);
  const stats = parseDiffStats(raw);
  const statsLine = formatDiffStatsLine(stats);
  const maxLines = expanded ? Infinity : DIFF_PREVIEW_LINES;
  if (colored.length > maxLines) {
    return [...colored.slice(0, maxLines), "…", statsLine];
  }
  return [...colored, "", statsLine];
}

describe("diff preview expand/collapse", () => {
  // Build a large diff with >20 lines
  const largeDiffLines = [
    "diff --git a/src/big.ts b/src/big.ts",
    "--- a/src/big.ts",
    "+++ b/src/big.ts",
    "@@ -1,30 +1,30 @@",
  ];
  for (let i = 1; i <= 25; i++) {
    largeDiffLines.push(`+line ${i}`);
  }
  const largeDiff = largeDiffLines.join("\n");

  const smallDiff = ["diff --git a/src/s.ts b/src/s.ts", "@@ -1,3 +1,3 @@", "-old", "+new"].join(
    "\n",
  );

  it("collapsed diff truncates to DIFF_PREVIEW_LINES (20) and appends stats", () => {
    const display = buildDiffDisplay(largeDiff, false);
    // 20 visible lines + "…" + stats line = 22
    expect(display).toHaveLength(22);
    expect(display[20]).toBe("…");
    // Last line should contain stats
    const lastLine = stripAnsi(display[display.length - 1]);
    expect(lastLine).toContain("+25");
    expect(lastLine).toContain("1 file");
  });

  it("expanded diff shows all lines with stats", () => {
    const display = buildDiffDisplay(largeDiff, true);
    // All rendered lines + empty separator + stats line
    const totalParsedLines = largeDiff.split("\n").length;
    expect(display).toHaveLength(totalParsedLines + 2); // +2 for "" and stats
    // No ellipsis in expanded mode
    expect(display).not.toContain("…");
  });

  it("small diff shows all lines without truncation", () => {
    const display = buildDiffDisplay(smallDiff, false);
    const totalParsedLines = smallDiff.split("\n").length;
    expect(display).toHaveLength(totalParsedLines + 2); // +2 for "" and stats
    expect(display).not.toContain("…");
  });

  it("stats line appears at the end of the display", () => {
    const display = buildDiffDisplay(smallDiff, false);
    const lastLine = stripAnsi(display[display.length - 1]);
    expect(lastLine).toMatch(/\(\d+ files?\)/);
  });
});

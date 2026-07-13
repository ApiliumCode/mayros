import chalk from "chalk";

export type DiffLineType = "add" | "del" | "context" | "header" | "hunk";

export type DiffLine = {
  type: DiffLineType;
  text: string;
};

export type DiffStats = {
  files: number;
  additions: number;
  deletions: number;
};

/**
 * Color functions for diff rendering, each taking text and returning it styled.
 * Matches the shape of the TUI theme color functions so the active palette can
 * be passed straight through, keeping diff colors consistent with the theme
 * (correct under light and high-contrast presets).
 */
export type DiffColors = {
  add: (text: string) => string;
  del: (text: string) => string;
  header: (text: string) => string;
  hunk: (text: string) => string;
  context: (text: string) => string;
};

/** Default (terminal-default) colors used when no theme is supplied. */
const DEFAULT_DIFF_COLORS: DiffColors = {
  add: (t) => chalk.green(t),
  del: (t) => chalk.red(t),
  header: (t) => chalk.bold(chalk.white(t)),
  hunk: (t) => chalk.cyan(t),
  context: (t) => chalk.dim(t),
};

export function parseDiffLines(raw: string): DiffLine[] {
  const lines: DiffLine[] = [];
  for (const text of raw.split("\n")) {
    if (
      text.startsWith("diff --git") ||
      text.startsWith("index ") ||
      text.startsWith("---") ||
      text.startsWith("+++")
    ) {
      lines.push({ type: "header", text });
    } else if (text.startsWith("@@")) {
      lines.push({ type: "hunk", text });
    } else if (text.startsWith("+")) {
      lines.push({ type: "add", text });
    } else if (text.startsWith("-")) {
      lines.push({ type: "del", text });
    } else {
      lines.push({ type: "context", text });
    }
  }
  return lines;
}

export function renderDiff(raw: string, colors?: Partial<DiffColors>): string[] {
  const c = { ...DEFAULT_DIFF_COLORS, ...colors };
  const parsed = parseDiffLines(raw);
  return parsed.map((line) => {
    switch (line.type) {
      case "add":
        return c.add(line.text);
      case "del":
        return c.del(line.text);
      case "header":
        return c.header(line.text);
      case "hunk":
        return c.hunk(line.text);
      default:
        return c.context(line.text);
    }
  });
}

export function renderDiffStats(raw: string): DiffStats {
  const parsed = parseDiffLines(raw);
  const fileSet = new Set<string>();
  let additions = 0;
  let deletions = 0;

  for (const line of parsed) {
    if (line.type === "header" && line.text.startsWith("diff --git")) {
      const match = line.text.match(/b\/(.+)$/);
      if (match?.[1]) {
        fileSet.add(match[1]);
      }
    } else if (line.type === "add") {
      additions++;
    } else if (line.type === "del") {
      deletions++;
    }
  }

  return { files: fileSet.size, additions, deletions };
}

/**
 * Format a single-line summary of diff stats with colors.
 * Example: "+5 -3 (2 files)"
 */
export function formatDiffStatsLine(
  stats: DiffStats,
  colors?: { add?: (text: string) => string; del?: (text: string) => string },
): string {
  const add = colors?.add ?? ((t: string) => chalk.green(t));
  const del = colors?.del ?? ((t: string) => chalk.red(t));
  const parts: string[] = [];
  if (stats.additions > 0) parts.push(add(`+${stats.additions}`));
  if (stats.deletions > 0) parts.push(del(`-${stats.deletions}`));
  const fileLabel = stats.files === 1 ? "1 file" : `${stats.files} files`;
  return parts.length > 0 ? `${parts.join(" ")} (${fileLabel})` : `(${fileLabel})`;
}

/**
 * Pure data extraction — no chalk. Counts additions/deletions from raw diff text.
 * Works with both standard unified diff and simple +/- line format.
 */
export function parseDiffStats(raw: string): DiffStats {
  const lines = raw.split("\n");
  let additions = 0;
  let deletions = 0;
  let files = 0;
  for (const line of lines) {
    if (line.startsWith("diff --git")) {
      files++;
    } else if (line.startsWith("+") && !line.startsWith("+++")) {
      additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      deletions++;
    }
  }
  return { files: Math.max(files, 1), additions, deletions };
}

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

export function renderDiff(raw: string): string[] {
  const parsed = parseDiffLines(raw);
  return parsed.map((line) => {
    switch (line.type) {
      case "add":
        return chalk.green(line.text);
      case "del":
        return chalk.red(line.text);
      case "header":
        return chalk.bold(chalk.white(line.text));
      case "hunk":
        return chalk.cyan(line.text);
      default:
        return chalk.dim(line.text);
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

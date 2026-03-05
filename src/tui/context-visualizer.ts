import chalk from "chalk";

export type ContextParams = {
  usedTokens: number;
  maxTokens: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  barWidth?: number;
};

const BLOCKS = ["░", "▒", "▓", "█"] as const;

function selectBlock(ratio: number): string {
  if (ratio >= 0.75) return BLOCKS[3];
  if (ratio >= 0.5) return BLOCKS[2];
  if (ratio >= 0.25) return BLOCKS[1];
  return BLOCKS[0];
}

function colorForRatio(ratio: number): (text: string) => string {
  if (ratio >= 0.9) return chalk.red;
  if (ratio >= 0.7) return chalk.yellow;
  return chalk.green;
}

export function buildContextBar(params: ContextParams): string {
  const { usedTokens, maxTokens, barWidth = 40 } = params;
  if (maxTokens <= 0) {
    return "no context limit";
  }
  const ratio = Math.min(1, Math.max(0, usedTokens / maxTokens));
  const filled = Math.round(ratio * barWidth);
  const empty = barWidth - filled;
  const block = selectBlock(ratio);
  const color = colorForRatio(ratio);
  const bar = color(block.repeat(filled)) + chalk.dim("░".repeat(empty));
  const pct = (ratio * 100).toFixed(1);
  return `[${bar}] ${pct}%`;
}

export function formatContextVisualization(params: ContextParams): string[] {
  const { usedTokens, maxTokens, inputTokens, outputTokens } = params;
  const lines: string[] = [];

  lines.push(chalk.bold("Context Window Usage"));
  lines.push("");
  lines.push(buildContextBar(params));
  lines.push("");

  const fmt = (n: number) => n.toLocaleString("en-US");

  lines.push(`  Total:   ${fmt(usedTokens)} / ${maxTokens > 0 ? fmt(maxTokens) : "unlimited"}`);
  if (inputTokens != null) {
    lines.push(`  Input:   ${fmt(inputTokens)}`);
  }
  if (outputTokens != null) {
    lines.push(`  Output:  ${fmt(outputTokens)}`);
  }
  if (maxTokens > 0) {
    const remaining = Math.max(0, maxTokens - usedTokens);
    lines.push(`  Free:    ${fmt(remaining)}`);
  }

  return lines;
}

import type { TransformResult } from "./var-to-const.js";

/**
 * Count parentheses depth outside of string literals.
 * Tracks single-quoted, double-quoted, and backtick strings,
 * properly handling escaped characters within those strings.
 */
function countParensOutsideStrings(line: string): number {
  let depth = 0;
  let inStr: "'" | '"' | "`" | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    // Handle escaped characters inside strings
    if (ch === "\\" && inStr !== null) {
      i++; // skip next character
      continue;
    }
    if (inStr === null) {
      if (ch === "'" || ch === '"' || ch === "`") {
        inStr = ch;
      } else if (ch === "(") {
        depth++;
      } else if (ch === ")") {
        depth--;
      }
    } else if (ch === inStr) {
      inStr = null;
    }
  }
  return depth;
}

export function removeConsole(source: string, _filePath: string): TransformResult {
  const lines = source.split("\n");
  const result: string[] = [];
  let edits = 0;
  let inMultiLine = false;
  let parenDepth = 0;

  for (const line of lines) {
    if (inMultiLine) {
      // Count parens outside strings to detect end of multi-line console call
      parenDepth += countParensOutsideStrings(line);
      edits++;
      if (parenDepth <= 0) {
        inMultiLine = false;
        parenDepth = 0;
      }
      continue;
    }

    const consoleMatch = line.match(
      /^\s*console\.(log|debug|warn|info|error|trace|dir|table|time|timeEnd)\s*\(/,
    );
    if (consoleMatch) {
      // Count open/close parens on this line (outside strings)
      const depth = countParensOutsideStrings(line);
      edits++;
      if (depth > 0) {
        // Multi-line console call
        inMultiLine = true;
        parenDepth = depth;
      }
      continue;
    }

    result.push(line);
  }

  return {
    output: result.join("\n"),
    changed: edits > 0,
    edits,
    description:
      edits > 0 ? `Removed ${edits} console statement(s)` : "No console statements found",
  };
}

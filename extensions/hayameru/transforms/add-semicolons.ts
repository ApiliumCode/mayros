import type { TransformResult } from "./var-to-const.js";

const SKIP_PATTERNS = [
  /^\s*$/, // empty line
  /^\s*\/\//, // single-line comment
  /^\s*\/?\*/, // block comment
  /[{}[\](,]\s*$/, // ends with opening bracket/comma
  /^\s*(?:if|else|for|while|do|switch|try|catch|finally|class|function|interface|type|enum|namespace)\b/,
  /=>\s*\{?\s*$/, // arrow function
  /^\s*(?:import|export)\b/, // import/export (handled separately)
  /:\s*$/, // lines ending with `:` (object properties, switch cases)
  /^\s*(?:return|throw|yield|break|continue)\s*$/, // standalone keywords with no expression
  /^\s*case\s+.+:\s*$/, // case ...:
  /^\s*default\s*:\s*$/, // default:
  /^\s*@\S/, // decorators (@Component, @Injectable, etc.)
  /^\s*\./, // chained method calls (line starts with `.`)
];

export function addSemicolons(source: string, _filePath: string): TransformResult {
  const lines = source.split("\n");
  const result: string[] = [];
  let edits = 0;

  for (const line of lines) {
    const trimmed = line.trimEnd();

    if (
      trimmed === "" ||
      trimmed.endsWith(";") ||
      trimmed.endsWith(",") ||
      trimmed.endsWith("{") ||
      trimmed.endsWith("}")
    ) {
      result.push(line);
      continue;
    }

    const shouldSkip = SKIP_PATTERNS.some((p) => p.test(trimmed));
    if (shouldSkip) {
      result.push(line);
      continue;
    }

    // Likely a statement that needs a semicolon
    result.push(trimmed + ";");
    edits++;
  }

  return {
    output: result.join("\n"),
    changed: edits > 0,
    edits,
    description: edits > 0 ? `Added ${edits} semicolon(s)` : "No missing semicolons found",
  };
}

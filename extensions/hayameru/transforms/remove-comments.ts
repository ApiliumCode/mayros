import type { TransformResult } from "./var-to-const.js";

/**
 * Checks if a given index in a line falls inside a string literal.
 * Handles single-quoted, double-quoted, and template literal (backtick) strings,
 * including escaped characters within those strings.
 */
function isInString(line: string, targetIdx: number): boolean {
  let inStr: "'" | '"' | "`" | null = null;
  for (let i = 0; i < targetIdx; i++) {
    const ch = line[i]!;
    if (ch === "\\" && inStr !== null) {
      // Skip the next character (escaped)
      i++;
      continue;
    }
    if (inStr === null) {
      if (ch === "'" || ch === '"' || ch === "`") {
        inStr = ch;
      }
    } else if (ch === inStr) {
      inStr = null;
    }
  }
  return inStr !== null;
}

export function removeComments(source: string, _filePath: string): TransformResult {
  const lines = source.split("\n");
  const result: string[] = [];
  let edits = 0;
  let inBlockComment = false;
  let inJsDoc = false;

  for (const line of lines) {
    // Inside JSDoc — preserve
    if (inJsDoc) {
      result.push(line);
      if (line.includes("*/")) inJsDoc = false;
      continue;
    }

    // Inside block comment — skip
    if (inBlockComment) {
      edits++;
      if (line.includes("*/")) {
        inBlockComment = false;
        const after = line.slice(line.indexOf("*/") + 2).trim();
        if (after) result.push(after);
      }
      continue;
    }

    const trimmed = line.trimStart();

    // JSDoc start — preserve
    if (trimmed.startsWith("/**")) {
      result.push(line);
      if (!line.includes("*/")) inJsDoc = true;
      continue;
    }

    // Scan for block comment start (/*) outside of strings
    let foundBlock = false;
    for (let i = 0; i < line.length - 1; i++) {
      const ch = line[i]!;
      // Skip escaped characters inside strings
      if (ch === "\\" && isInString(line, i)) {
        i++;
        continue;
      }
      if (ch === "/" && line[i + 1] === "*" && !isInString(line, i)) {
        const blockIdx = i;
        const before = line.slice(0, blockIdx).trimEnd();
        const endIdx = line.indexOf("*/", blockIdx + 2);
        if (endIdx !== -1) {
          const after = line.slice(endIdx + 2);
          const combined = (before + after).trimEnd();
          if (combined) result.push(combined);
        } else {
          inBlockComment = true;
          if (before) result.push(before);
        }
        edits++;
        foundBlock = true;
        break;
      }
    }
    if (foundBlock) continue;

    // Scan for single-line comment (//) outside of strings
    let foundSingle = false;
    for (let i = 0; i < line.length - 1; i++) {
      const ch = line[i]!;
      if (ch === "\\" && isInString(line, i)) {
        i++;
        continue;
      }
      if (ch === "/" && line[i + 1] === "/" && !isInString(line, i)) {
        const trimBefore = line.slice(0, i).trimEnd();
        if (trimBefore) result.push(trimBefore);
        edits++;
        foundSingle = true;
        break;
      }
    }
    if (foundSingle) continue;

    result.push(line);
  }

  return {
    output: result.join("\n"),
    changed: edits > 0,
    edits,
    description: edits > 0 ? `Removed ${edits} comment(s) (preserved JSDoc)` : "No comments found",
  };
}

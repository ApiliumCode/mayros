import type { TransformResult } from "./var-to-const.js";

type ImportLine = {
  raw: string;
  source: string;
  group: number; // 0=node:, 1=@scope, 2=bare, 3=relative
};

/** Side-effect imports like `import "polyfill"` or `import './setup'` */
type SideEffectImport = {
  raw: string;
  originalIndex: number;
};

function classifyImport(source: string): number {
  if (source.startsWith("node:")) return 0;
  if (source.startsWith("@")) return 1;
  if (source.startsWith(".")) return 3;
  return 2;
}

const SIDE_EFFECT_RE = /^import\s+["'][^"']+["']\s*;?\s*$/;
const IMPORT_FROM_RE = /^import\s+.*?from\s+["']([^"']+)["']/;

export function sortImports(source: string, _filePath: string): TransformResult {
  const lines = source.split("\n");
  const result: string[] = [];
  const importBlock: ImportLine[] = [];
  const sideEffects: SideEffectImport[] = [];
  let blockStart = -1;
  let edits = 0;

  // Track multi-line import state
  let multiLineAccum: string[] = [];
  let inMultiLineImport = false;

  function flushBlock() {
    if (importBlock.length <= 1 && sideEffects.length === 0) {
      for (const imp of importBlock) result.push(imp.raw);
      importBlock.length = 0;
      sideEffects.length = 0;
      blockStart = -1;
      return;
    }

    if (importBlock.length <= 1 && sideEffects.length > 0) {
      // Only side-effect imports, push them as-is
      for (const se of sideEffects) result.push(se.raw);
      for (const imp of importBlock) result.push(imp.raw);
      importBlock.length = 0;
      sideEffects.length = 0;
      blockStart = -1;
      return;
    }

    const original = importBlock.map((i) => i.raw).join("\n");

    // Sort by group, then alphabetically within group
    const sorted = [...importBlock].sort((a, b) => {
      if (a.group !== b.group) return a.group - b.group;
      return a.source.localeCompare(b.source);
    });

    // Side-effect imports go first (they stay in relative order)
    for (const se of sideEffects) {
      result.push(se.raw);
    }

    // Add blank lines between groups
    let lastGroup = -1;
    for (const imp of sorted) {
      if (lastGroup !== -1 && imp.group !== lastGroup) {
        result.push("");
      }
      result.push(imp.raw);
      lastGroup = imp.group;
    }

    const sortedStr = sorted.map((i) => i.raw).join("\n");
    if (original !== sortedStr) edits++;

    importBlock.length = 0;
    sideEffects.length = 0;
    blockStart = -1;
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]!;

    // Multi-line import continuation
    if (inMultiLineImport) {
      multiLineAccum.push(line);
      // Check if this line closes the import (contains `}` and `from`)
      const joined = multiLineAccum.join("\n");
      const closedMatch = joined.match(/^import\s+.*?from\s+["']([^"']+)["']/s);
      if (closedMatch) {
        // Multi-line import is complete
        inMultiLineImport = false;
        if (blockStart === -1) blockStart = i;
        importBlock.push({
          raw: joined,
          source: closedMatch[1]!,
          group: classifyImport(closedMatch[1]!),
        });
        multiLineAccum = [];
      }
      continue;
    }

    // Side-effect import
    if (SIDE_EFFECT_RE.test(line.trim())) {
      if (blockStart === -1) blockStart = i;
      sideEffects.push({ raw: line, originalIndex: i });
      continue;
    }

    // Standard single-line import
    const importMatch = line.match(IMPORT_FROM_RE);
    if (importMatch) {
      if (blockStart === -1) blockStart = i;
      importBlock.push({
        raw: line,
        source: importMatch[1]!,
        group: classifyImport(importMatch[1]!),
      });
      continue;
    }

    // Detect start of multi-line import: `import {` or `import type {` without `from` on same line
    if (
      /^\s*import\s/.test(line) &&
      line.includes("{") &&
      !line.includes("}") &&
      !IMPORT_FROM_RE.test(line)
    ) {
      inMultiLineImport = true;
      multiLineAccum = [line];
      if (blockStart === -1) blockStart = i;
      continue;
    }

    if ((importBlock.length > 0 || sideEffects.length > 0) && line.trim() === "") {
      // Empty line in import block — keep collecting
      continue;
    }

    flushBlock();
    result.push(line);
  }

  // Flush any remaining multi-line accumulator as raw lines
  if (inMultiLineImport && multiLineAccum.length > 0) {
    for (const ml of multiLineAccum) result.push(ml);
  }

  flushBlock();

  return {
    output: result.join("\n"),
    changed: edits > 0,
    edits,
    description: edits > 0 ? "Sorted and grouped import statements" : "Imports already sorted",
  };
}

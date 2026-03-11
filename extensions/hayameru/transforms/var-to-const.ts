export type TransformResult = {
  output: string;
  changed: boolean;
  edits: number;
  description: string;
};

/**
 * Extract variable names from a destructuring pattern (array or object).
 * Handles simple patterns like `[a, b]` and `{x, y}`.
 */
function extractDestructuredNames(pattern: string): string[] {
  // Remove outer brackets/braces
  const inner = pattern.slice(1, -1).trim();
  if (!inner) return [];
  return inner
    .split(",")
    .map((s) => {
      const trimmed = s.trim();
      // Handle renaming: `{ orig: alias }` -> alias
      if (trimmed.includes(":")) {
        return trimmed.split(":").pop()!.trim();
      }
      // Handle rest: `...rest` -> rest
      if (trimmed.startsWith("...")) {
        return trimmed.slice(3).trim();
      }
      return trimmed;
    })
    .filter(Boolean);
}

export function varToConst(source: string, _filePath: string): TransformResult {
  const lines = source.split("\n");
  let edits = 0;
  const result: string[] = [];

  // Track variables that are reassigned
  const reassigned = new Set<string>();
  for (const line of lines) {
    // Standard reassignment: `identifier =`, `identifier +=`, etc.
    const assignMatch = line.match(/^\s*(\w+)\s*(?:\+|-|\*|\/|%|\|\||&&)?=/);
    if (assignMatch && !line.match(/^\s*(?:var|let|const)\s/)) {
      reassigned.add(assignMatch[1]!);
    }

    // Array destructuring reassignment: `[a, b] = ...`
    const arrayDestructMatch = line.match(/^\s*(\[[^\]]+\])\s*=/);
    if (arrayDestructMatch && !line.match(/^\s*(?:var|let|const)\s/)) {
      for (const name of extractDestructuredNames(arrayDestructMatch[1]!)) {
        reassigned.add(name);
      }
    }

    // Object destructuring reassignment: `({x, y} = ...)` or `{x, y} = ...`
    // Note: bare `{x} = expr` is technically a syntax error without parens,
    // but we detect both patterns for robustness.
    const objDestructMatch = line.match(/^\s*\(?\s*(\{[^}]+\})\s*\)?\s*=/);
    if (objDestructMatch && !line.match(/^\s*(?:var|let|const)\s/)) {
      for (const name of extractDestructuredNames(objDestructMatch[1]!)) {
        reassigned.add(name);
      }
    }
  }

  for (const line of lines) {
    const match = line.match(/^(\s*)var\s+(\w+)/);
    if (match) {
      const [, indent, varName] = match;
      if (reassigned.has(varName!)) {
        result.push(line.replace(/^(\s*)var\s/, `${indent}let `));
      } else {
        result.push(line.replace(/^(\s*)var\s/, `${indent}const `));
      }
      edits++;
    } else {
      result.push(line);
    }
  }

  return {
    output: result.join("\n"),
    changed: edits > 0,
    edits,
    description:
      edits > 0
        ? `Converted ${edits} var declaration(s) to const/let`
        : "No var declarations found",
  };
}

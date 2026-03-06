import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

export type MayrosIgnoreResult = {
  patterns: string[];
  source: string | null;
};

const IGNORE_FILENAMES = [".mayrosignore", ".mayros/ignore"];

/**
 * Load ignore patterns from .mayrosignore or .mayros/ignore file.
 * Each non-empty, non-comment line is a glob pattern.
 */
export function loadMayrosIgnore(rootDir?: string): MayrosIgnoreResult {
  const dir = rootDir ?? process.cwd();

  for (const filename of IGNORE_FILENAMES) {
    const filePath = join(dir, filename);
    if (!existsSync(filePath)) continue;

    try {
      const content = readFileSync(filePath, "utf-8");
      const patterns = content
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"));
      return { patterns, source: filePath };
    } catch {
      continue;
    }
  }

  return { patterns: [], source: null };
}

/**
 * Check if a relative path matches any ignore pattern.
 * Uses simple glob matching (supports * and **).
 */
export function shouldIgnore(relativePath: string, patterns: string[]): boolean {
  for (const pattern of patterns) {
    if (matchPattern(relativePath, pattern)) return true;
  }
  return false;
}

function matchPattern(path: string, pattern: string): boolean {
  // Convert glob pattern to regex
  const negated = pattern.startsWith("!");
  const cleanPattern = negated ? pattern.slice(1) : pattern;

  const regexStr = cleanPattern
    .replace(/\./g, "\\.")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*")
    .replace(/\?/g, "[^/]");

  const regex = new RegExp(`^${regexStr}$`);
  const matches = regex.test(path);
  return negated ? !matches : matches;
}

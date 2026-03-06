/**
 * File Discovery Service
 *
 * Smart file discovery for context injection — finds files relevant
 * to a given query or topic by walking the project tree and scoring
 * each path against the search terms.
 */

import fs from "node:fs";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================

export type FileDiscoveryConfig = {
  maxFiles: number;
  maxDepth: number;
  ignorePatterns: string[];
};

export type DiscoveredFile = {
  path: string;
  relevance: number;
  reason: string;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_IGNORE_PATTERNS = ["node_modules", ".git", "dist", "build"];

/** Files that are always considered "key" project files. */
const KEY_FILES = new Set([
  "package.json",
  "tsconfig.json",
  "vitest.config.ts",
  "vite.config.ts",
  ".env.example",
  "Dockerfile",
  "docker-compose.yml",
]);

// ============================================================================
// FileDiscoveryService
// ============================================================================

export class FileDiscoveryService {
  private readonly rootDir: string;
  private readonly config: FileDiscoveryConfig;

  constructor(rootDir: string, config?: Partial<FileDiscoveryConfig>) {
    this.rootDir = rootDir;
    this.config = {
      maxFiles: config?.maxFiles ?? 20,
      maxDepth: config?.maxDepth ?? 5,
      ignorePatterns: config?.ignorePatterns ?? DEFAULT_IGNORE_PATTERNS,
    };
  }

  // --------------------------------------------------------------------------
  // Public API
  // --------------------------------------------------------------------------

  /**
   * Find files relevant to a query string, sorted by relevance score.
   */
  async discoverRelevant(query: string): Promise<DiscoveredFile[]> {
    const allFiles = await this.walkTree(this.rootDir, 0);

    const scored: DiscoveredFile[] = [];
    for (const filePath of allFiles) {
      const rel = path.relative(this.rootDir, filePath);
      const relevance = this.scoreRelevance(rel, query);
      if (relevance > 0) {
        scored.push({
          path: rel,
          relevance,
          reason: buildReason(rel, query),
        });
      }
    }

    scored.sort((a, b) => b.relevance - a.relevance);
    return scored.slice(0, this.config.maxFiles);
  }

  /**
   * Find all files matching a set of extensions.
   */
  async findByExtension(extensions: string[]): Promise<string[]> {
    const normalised = new Set(extensions.map((e) => (e.startsWith(".") ? e : `.${e}`)));
    const allFiles = await this.walkTree(this.rootDir, 0);
    return allFiles.filter((f) => normalised.has(path.extname(f)));
  }

  /**
   * Score a file path's relevance to a query (0-1).
   *
   * Breakdown:
   *   filename match  — 0.4
   *   directory match  — 0.3
   *   extension match  — 0.3
   */
  scoreRelevance(filePath: string, query: string): number {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length === 0) return 0;

    const basename = path.basename(filePath).toLowerCase();
    const dir = path.dirname(filePath).toLowerCase();
    const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");

    let filenameScore = 0;
    let dirScore = 0;
    let extScore = 0;

    for (const term of terms) {
      if (basename.includes(term)) filenameScore = 1;
      if (dir.includes(term)) dirScore = 1;
      if (ext === term) extScore = 1;
    }

    return filenameScore * 0.4 + dirScore * 0.3 + extScore * 0.3;
  }

  /**
   * Return a concise tree-like string showing top-level directories
   * and key project files.
   */
  async getProjectStructure(): Promise<string> {
    const entries = await fs.promises.readdir(this.rootDir, { withFileTypes: true });

    const lines: string[] = [];
    for (const entry of entries) {
      if (this.isIgnored(entry.name)) continue;

      if (entry.isDirectory()) {
        lines.push(`${entry.name}/`);
      } else if (KEY_FILES.has(entry.name)) {
        lines.push(entry.name);
      }
    }

    lines.sort();
    return lines.join("\n");
  }

  // --------------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------------

  private async walkTree(dir: string, depth: number): Promise<string[]> {
    if (depth > this.config.maxDepth) return [];

    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return [];
    }

    const results: string[] = [];

    for (const entry of entries) {
      if (this.isIgnored(entry.name)) continue;

      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        const sub = await this.walkTree(full, depth + 1);
        results.push(...sub);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }

    return results;
  }

  private isIgnored(name: string): boolean {
    return this.config.ignorePatterns.some((pat) => name === pat || name.startsWith(pat));
  }
}

// ============================================================================
// Private helpers
// ============================================================================

function buildReason(filePath: string, query: string): string {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const basename = path.basename(filePath).toLowerCase();
  const dir = path.dirname(filePath).toLowerCase();

  const matched: string[] = [];
  for (const term of terms) {
    if (basename.includes(term)) matched.push(`filename contains "${term}"`);
    else if (dir.includes(term)) matched.push(`path contains "${term}"`);
  }

  if (matched.length === 0) {
    const ext = path.extname(filePath).replace(/^\./, "");
    if (terms.includes(ext)) matched.push(`extension matches "${ext}"`);
  }

  return matched.length > 0 ? matched.join(", ") : "partial match";
}

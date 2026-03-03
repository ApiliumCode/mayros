/**
 * Incremental indexing via SHA-256 content hashing.
 *
 * Tracks file hashes to detect changes. On re-index, only files whose
 * content hash differs from the stored hash are re-scanned and their
 * triples replaced in Cortex.
 */

import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { join, relative, extname } from "node:path";
import type { CortexClient, CreateTripleRequest } from "../shared/cortex-client.js";
import type { CodeIndexerConfig } from "./config.js";
import { scanFileContent, type FileScanResult } from "./scanner.js";
import { codePredicate, fileSubject, fileScanToTriples, fileSubjects } from "./rdf-mapper.js";

// ============================================================================
// Types
// ============================================================================

export type IndexStats = {
  totalFiles: number;
  newFiles: number;
  changedFiles: number;
  unchangedFiles: number;
  removedFiles: number;
  totalEntities: number;
  totalTriples: number;
  durationMs: number;
};

export type StoredFileHash = {
  path: string;
  hash: string;
};

// ============================================================================
// Hash computation
// ============================================================================

export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

// ============================================================================
// File discovery
// ============================================================================

function shouldIgnore(filePath: string, ignorePatterns: string[]): boolean {
  for (const pattern of ignorePatterns) {
    // Simple pattern matching: exact segment match or glob-like *.ext
    if (pattern.startsWith("*.")) {
      const ext = pattern.slice(1);
      if (filePath.endsWith(ext)) return true;
    } else if (filePath.includes(`/${pattern}/`) || filePath.startsWith(`${pattern}/`)) {
      return true;
    }
  }
  return false;
}

async function discoverFiles(
  rootDir: string,
  scanPaths: string[],
  config: CodeIndexerConfig,
): Promise<string[]> {
  const files: string[] = [];

  async function walk(dir: string): Promise<void> {
    if (files.length >= config.maxFiles) return;

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return;
    }

    for (const entry of entries) {
      if (files.length >= config.maxFiles) break;

      const fullPath = join(dir, entry);
      const relPath = relative(rootDir, fullPath);

      if (shouldIgnore(relPath, config.ignore)) continue;

      let info;
      try {
        info = await stat(fullPath);
      } catch {
        continue;
      }

      if (info.isDirectory()) {
        await walk(fullPath);
      } else if (info.isFile() && config.extensions.includes(extname(entry))) {
        files.push(relPath);
      }
    }
  }

  for (const scanPath of scanPaths) {
    const absPath = join(rootDir, scanPath);
    await walk(absPath);
  }

  return files;
}

// ============================================================================
// Stored hash retrieval
// ============================================================================

async function getStoredHashes(client: CortexClient, ns: string): Promise<Map<string, string>> {
  const hashes = new Map<string, string>();

  try {
    const result = await client.patternQuery({
      predicate: codePredicate(ns, "hash"),
      limit: 10000,
    });

    for (const match of result.matches) {
      // Subject: {ns}:code:file:{path}, Object: hash string
      const path = match.subject.replace(`${ns}:code:file:`, "");
      const hash = typeof match.object === "string" ? match.object : String(match.object);
      hashes.set(path, hash);
    }
  } catch {
    // Cortex may be empty or unavailable
  }

  return hashes;
}

// ============================================================================
// Delete file triples
// ============================================================================

async function deleteFileTriples(
  client: CortexClient,
  ns: string,
  filePath: string,
): Promise<void> {
  // Delete all triples with subject starting with the file subject
  const fileSub = fileSubject(ns, filePath);

  try {
    // Delete the file entity triples
    const fileTriples = await client.listTriples({ subject: fileSub, limit: 200 });
    for (const t of fileTriples.triples) {
      if (t.id) {
        await client.deleteTriple(t.id);
      }
    }

    // Also delete entity triples that reference this file path
    const pathTriples = await client.patternQuery({
      predicate: codePredicate(ns, "path"),
      object: filePath,
      limit: 500,
    });

    for (const match of pathTriples.matches) {
      const entityTriples = await client.listTriples({ subject: match.subject, limit: 20 });
      for (const t of entityTriples.triples) {
        if (t.id) {
          await client.deleteTriple(t.id);
        }
      }
    }
  } catch {
    // Best-effort deletion
  }
}

// ============================================================================
// Incremental Index
// ============================================================================

/**
 * Run an incremental index: discover files, compare hashes, scan changed
 * files, store triples, remove stale entries.
 */
export async function runIncrementalIndex(
  client: CortexClient,
  ns: string,
  rootDir: string,
  config: CodeIndexerConfig,
  logger?: { info: (msg: string) => void; warn: (msg: string) => void },
): Promise<IndexStats> {
  const start = Date.now();
  const stats: IndexStats = {
    totalFiles: 0,
    newFiles: 0,
    changedFiles: 0,
    unchangedFiles: 0,
    removedFiles: 0,
    totalEntities: 0,
    totalTriples: 0,
    durationMs: 0,
  };

  // 1. Discover files
  const files = await discoverFiles(rootDir, config.paths, config);
  stats.totalFiles = files.length;

  // 2. Get stored hashes from Cortex
  const storedHashes = await getStoredHashes(client, ns);

  // 3. Determine what changed
  const currentFiles = new Set(files);
  const filesToIndex: Array<{ path: string; content: string; hash: string }> = [];

  for (const filePath of files) {
    let content: string;
    try {
      content = await readFile(join(rootDir, filePath), "utf-8");
    } catch {
      continue;
    }

    const hash = computeHash(content);
    const storedHash = storedHashes.get(filePath);

    if (!storedHash) {
      stats.newFiles++;
      filesToIndex.push({ path: filePath, content, hash });
    } else if (storedHash !== hash) {
      stats.changedFiles++;
      filesToIndex.push({ path: filePath, content, hash });
    } else {
      stats.unchangedFiles++;
    }
  }

  // 4. Detect removed files
  for (const storedPath of storedHashes.keys()) {
    if (!currentFiles.has(storedPath)) {
      stats.removedFiles++;
      await deleteFileTriples(client, ns, storedPath);
      logger?.info(`code-indexer: removed ${storedPath}`);
    }
  }

  // 5. Index changed/new files
  for (const file of filesToIndex) {
    // Delete old triples for changed files
    if (storedHashes.has(file.path)) {
      await deleteFileTriples(client, ns, file.path);
    }

    // Scan and generate triples
    const scan = scanFileContent(file.content, file.path);
    const triples = fileScanToTriples(ns, scan, file.hash);

    stats.totalEntities += scan.entities.length;
    stats.totalTriples += triples.length;

    // Store triples
    for (const t of triples) {
      try {
        await client.createTriple(t);
      } catch (err) {
        logger?.warn(`code-indexer: failed to store triple: ${String(err)}`);
      }
    }
  }

  stats.durationMs = Date.now() - start;
  return stats;
}

/**
 * Get current index statistics from Cortex without re-indexing.
 */
export async function getIndexStats(
  client: CortexClient,
  ns: string,
): Promise<{
  files: number;
  functions: number;
  classes: number;
  imports: number;
  lastIndexed: string | null;
}> {
  const result = {
    files: 0,
    functions: 0,
    classes: 0,
    imports: 0,
    lastIndexed: null as string | null,
  };

  try {
    const files = await client.patternQuery({
      predicate: codePredicate(ns, "type"),
      object: "file",
      limit: 10000,
    });
    result.files = files.total;

    const functions = await client.patternQuery({
      predicate: codePredicate(ns, "type"),
      object: "function",
      limit: 10000,
    });
    result.functions = functions.total;

    const classes = await client.patternQuery({
      predicate: codePredicate(ns, "type"),
      object: "class",
      limit: 10000,
    });
    result.classes = classes.total;

    const imports = await client.patternQuery({
      predicate: codePredicate(ns, "type"),
      object: "import",
      limit: 10000,
    });
    result.imports = imports.total;

    // Get most recent indexedAt timestamp
    const timestamps = await client.patternQuery({
      predicate: codePredicate(ns, "indexedAt"),
      limit: 1,
    });
    if (timestamps.matches.length > 0) {
      const val = timestamps.matches[0].object;
      result.lastIndexed = typeof val === "string" ? val : null;
    }
  } catch {
    // Cortex unavailable
  }

  return result;
}

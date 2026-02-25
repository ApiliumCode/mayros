import { createHash, randomBytes } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import { isPathInside } from "../../src/security/scan-paths.js";

export type PackageManifest = {
  files: Array<{
    path: string;
    hash: string;
    size: number;
  }>;
  totalSize: number;
};

const EXCLUDED_DIRS = new Set([".git", "node_modules", ".DS_Store"]);
const MAX_PACKAGE_SIZE = 10 * 1024 * 1024; // 10 MB

/**
 * Compute Blake3-like hash using SHA-256 (Blake3 requires external dep;
 * SHA-256 is sufficient for content hashing and is built-in).
 */
export function hashContent(content: Buffer): string {
  return createHash("sha256").update(content).digest("hex");
}

/**
 * Walk a skill directory and collect all files with their hashes.
 */
async function collectFiles(
  dir: string,
  baseDir: string,
): Promise<Array<{ path: string; hash: string; size: number; content: Buffer }>> {
  const files: Array<{ path: string; hash: string; size: number; content: Buffer }> = [];
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    if (entry.name.startsWith(".") || EXCLUDED_DIRS.has(entry.name)) {
      continue;
    }

    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      const subFiles = await collectFiles(fullPath, baseDir);
      files.push(...subFiles);
    } else if (entry.isFile()) {
      const content = await readFile(fullPath);
      const relPath = relative(baseDir, fullPath);
      files.push({
        path: relPath,
        hash: hashContent(content),
        size: content.length,
        content,
      });
    }
  }

  return files;
}

/**
 * Build a package manifest for a skill directory.
 */
export async function buildPackageManifest(skillDir: string): Promise<PackageManifest> {
  const dirStat = await stat(skillDir);
  if (!dirStat.isDirectory()) {
    throw new Error(`${skillDir} is not a directory`);
  }

  const files = await collectFiles(skillDir, skillDir);

  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_PACKAGE_SIZE) {
    throw new Error(
      `Skill package too large: ${(totalSize / 1024 / 1024).toFixed(2)} MB (max: ${MAX_PACKAGE_SIZE / 1024 / 1024} MB)`,
    );
  }

  return {
    files: files.map((f) => ({ path: f.path, hash: f.hash, size: f.size })),
    totalSize,
  };
}

/**
 * Build file hashes map for signing (path → hash).
 */
export async function buildFileHashes(skillDir: string): Promise<Record<string, string>> {
  const manifest = await buildPackageManifest(skillDir);
  const hashes: Record<string, string> = {};
  for (const f of manifest.files) {
    hashes[f.path] = f.hash;
  }
  return hashes;
}

/**
 * Verify that on-disk file hashes match a declared set of hashes.
 */
export async function verifyFileHashes(
  skillDir: string,
  declaredHashes: Record<string, string>,
): Promise<{ valid: boolean; mismatches: string[] }> {
  const currentHashes = await buildFileHashes(skillDir);
  const mismatches: string[] = [];

  for (const [path, expectedHash] of Object.entries(declaredHashes)) {
    const actualHash = currentHashes[path];
    if (!actualHash) {
      mismatches.push(`${path}: missing on disk`);
    } else if (actualHash !== expectedHash) {
      mismatches.push(`${path}: hash mismatch`);
    }
  }

  // Check for extra files not in the declared set
  for (const path of Object.keys(currentHashes)) {
    if (!(path in declaredHashes)) {
      mismatches.push(`${path}: undeclared file`);
    }
  }

  return { valid: mismatches.length === 0, mismatches };
}

// ============================================================================
// Package Archive — self-contained JSON archive with embedded file contents
// ============================================================================

export type PackageArchiveEntry = {
  path: string;
  hash: string;
  size: number;
  /** Base64-encoded file content. */
  content: string;
};

export type PackageArchive = {
  format: "mayros-skill-archive-v1";
  files: PackageArchiveEntry[];
  totalSize: number;
};

/**
 * Build a self-contained JSON archive from a skill directory.
 * Each file's content is embedded as base64.
 */
export async function buildPackageArchive(skillDir: string): Promise<PackageArchive> {
  const dirStat = await stat(skillDir);
  if (!dirStat.isDirectory()) {
    throw new Error(`${skillDir} is not a directory`);
  }

  const files = await collectFiles(skillDir, skillDir);
  const totalSize = files.reduce((sum, f) => sum + f.size, 0);
  if (totalSize > MAX_PACKAGE_SIZE) {
    throw new Error(
      `Skill package too large: ${(totalSize / 1024 / 1024).toFixed(2)} MB (max: ${MAX_PACKAGE_SIZE / 1024 / 1024} MB)`,
    );
  }

  return {
    format: "mayros-skill-archive-v1",
    files: files.map((f) => ({
      path: f.path,
      hash: f.hash,
      size: f.size,
      content: f.content.toString("base64"),
    })),
    totalSize,
  };
}

/**
 * Extract a PackageArchive (from a Buffer of JSON) into a target directory.
 * Creates directories as needed and writes each file.
 */
export async function extractPackageArchive(
  archiveBuffer: Buffer,
  targetDir: string,
): Promise<{ files: string[]; totalSize: number }> {
  const archive = JSON.parse(archiveBuffer.toString("utf-8")) as PackageArchive;

  if (archive.format !== "mayros-skill-archive-v1") {
    throw new Error(`Unknown archive format: ${archive.format}`);
  }

  const extractedFiles: string[] = [];
  const resolvedTarget = resolve(targetDir);

  for (const entry of archive.files) {
    // Path traversal protection
    if (entry.path.startsWith("/") || entry.path.includes("..")) {
      throw new Error(`Path traversal blocked: ${entry.path}`);
    }
    const filePath = join(targetDir, entry.path);
    if (!isPathInside(resolvedTarget, resolve(filePath))) {
      throw new Error(`Path traversal blocked: ${entry.path}`);
    }
    await mkdir(dirname(filePath), { recursive: true });
    const content = Buffer.from(entry.content, "base64");

    // Verify hash
    const actualHash = hashContent(content);
    if (actualHash !== entry.hash) {
      throw new Error(`Hash mismatch for ${entry.path}: expected ${entry.hash}, got ${actualHash}`);
    }

    await writeFile(filePath, content);
    extractedFiles.push(entry.path);
  }

  return { files: extractedFiles, totalSize: archive.totalSize };
}

// ============================================================================
// Atomic install helpers — extract to temp, verify, promote
// ============================================================================

/**
 * Generate a temp directory name alongside the final target directory.
 * e.g. `skills/.installing-my-skill-a1b2c3`
 */
export function tempInstallDir(skillsDir: string, slug: string): string {
  const suffix = randomBytes(4).toString("hex");
  return join(skillsDir, `.installing-${slug}-${suffix}`);
}

/**
 * Extract a PackageArchive into a temporary directory.
 * Returns the temp path and extraction result.
 */
export async function extractPackageArchiveToTemp(
  archiveBuffer: Buffer,
  skillsDir: string,
  slug: string,
): Promise<{ tempDir: string; files: string[]; totalSize: number }> {
  const tempDir = tempInstallDir(skillsDir, slug);
  await mkdir(tempDir, { recursive: true });

  try {
    const result = await extractPackageArchive(archiveBuffer, tempDir);
    return { tempDir, ...result };
  } catch (err) {
    // Cleanup on extraction failure
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    throw err;
  }
}

/**
 * Promote a temp directory to the final skill directory (atomic rename on same fs).
 * Removes the existing target directory first if it exists.
 */
export async function promoteDir(tempDir: string, targetDir: string): Promise<void> {
  // Remove existing target if present
  await rm(targetDir, { recursive: true, force: true }).catch(() => {});
  await rename(tempDir, targetDir);
}

/**
 * Clean up a temp install directory on verification failure.
 */
export async function cleanupTempDir(tempDir: string): Promise<void> {
  await rm(tempDir, { recursive: true, force: true }).catch(() => {});
}

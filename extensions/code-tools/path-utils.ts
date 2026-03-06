/**
 * Shared path utilities for code-tools.
 *
 * Provides workspace-relative path resolution, traversal protection,
 * image file detection, and binary buffer detection.
 */

import path from "node:path";

/**
 * Returns true if `childPath` is inside `parentPath`.
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
  const rel = path.relative(parentPath, childPath);
  return !rel.startsWith("..") && !path.isAbsolute(rel);
}

/**
 * Resolves a user-provided path to an absolute path within the workspace.
 * Throws if the resolved path escapes the workspace root.
 */
export function resolveSafePath(inputPath: string, workspaceRoot: string): string {
  const resolved = path.isAbsolute(inputPath) ? inputPath : path.resolve(workspaceRoot, inputPath);

  if (!isPathInside(resolved, workspaceRoot)) {
    throw new Error(`Path "${inputPath}" is outside workspace root`);
  }
  return resolved;
}

const IMAGE_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".bmp",
  ".tiff",
  ".tif",
]);

/**
 * Returns true if the file has a recognized image extension.
 */
export function isImageFile(filePath: string): boolean {
  return IMAGE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Returns true if the buffer likely contains binary content (has null bytes).
 */
export function isBinaryBuffer(buffer: Buffer, checkBytes = 8192): boolean {
  const len = Math.min(buffer.length, checkBytes);
  for (let i = 0; i < len; i++) {
    if (buffer[i] === 0) return true;
  }
  return false;
}

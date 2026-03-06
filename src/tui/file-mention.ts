/**
 * File Mention Handler
 *
 * Detects @path/to/file patterns in user messages, reads the files,
 * and appends their contents as context blocks.
 */

import { readFile, stat, readdir, open } from "node:fs/promises";
import path from "node:path";

async function isBinaryFile(filePath: string): Promise<boolean> {
  let handle;
  try {
    handle = await open(filePath, "r");
    const buf = Buffer.alloc(512);
    const { bytesRead } = await handle.read(buf, 0, 512, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } catch {
    return false;
  } finally {
    await handle?.close();
  }
}

/** Regex to match @file mentions in user text */
const FILE_MENTION_PATTERN = /@((?:~\/|\.\/|\/|[\w][\w.-]*\/)[\w./-]+)/g;

const MAX_FILE_SIZE = 2 * 1024 * 1024; // 2MB
const MAX_MENTIONS_PER_MESSAGE = 10;

export type FileMention = {
  original: string;
  resolvedPath: string;
  content: string;
};

/**
 * Scan text for @file mentions and read their contents.
 * Returns the original text (with @mentions preserved) plus file context blocks.
 */
export async function expandFileMentions(
  text: string,
  cwd?: string,
): Promise<{ text: string; mentions: FileMention[]; contextBlock: string }> {
  const workDir = cwd ?? process.cwd();
  const mentions: FileMention[] = [];
  const seen = new Set<string>();

  let match: RegExpExecArray | null;
  const regex = new RegExp(FILE_MENTION_PATTERN.source, FILE_MENTION_PATTERN.flags);

  while ((match = regex.exec(text)) !== null && mentions.length < MAX_MENTIONS_PER_MESSAGE) {
    const filePath = match[1];
    const resolved = filePath.startsWith("~")
      ? path.join(process.env.HOME ?? "", filePath.slice(1))
      : filePath.startsWith("/")
        ? filePath
        : path.resolve(workDir, filePath);

    if (seen.has(resolved)) continue;
    seen.add(resolved);

    try {
      const fileStat = await stat(resolved);
      if (!fileStat.isFile()) continue;
      if (fileStat.size > MAX_FILE_SIZE) {
        mentions.push({
          original: `@${filePath}`,
          resolvedPath: resolved,
          content: `[File too large: ${fileStat.size} bytes]`,
        });
        continue;
      }

      // Check for binary content
      if (await isBinaryFile(resolved)) {
        mentions.push({
          original: `@${filePath}`,
          resolvedPath: resolved,
          content: `[Binary file: ${fileStat.size} bytes]`,
        });
        continue;
      }

      const content = await readFile(resolved, "utf-8");
      mentions.push({
        original: `@${filePath}`,
        resolvedPath: resolved,
        content,
      });
    } catch {
      // File not found or unreadable — skip silently
    }
  }

  if (mentions.length === 0) {
    return { text, mentions: [], contextBlock: "" };
  }

  // Build context blocks
  const blocks = mentions.map(
    (m) => `<file-context path="${m.resolvedPath}">\n${m.content}\n</file-context>`,
  );

  return {
    text,
    mentions,
    contextBlock: blocks.join("\n\n"),
  };
}

/**
 * Glob files matching a prefix for autocomplete suggestions.
 * Uses Node.js built-in readdir — no external dependencies required.
 */
export async function globFilesForMention(
  prefix: string,
  cwd?: string,
): Promise<Array<{ value: string; label: string }>> {
  const workDir = cwd ?? process.cwd();

  try {
    // Determine the directory to list and the name prefix to filter
    const prefixDir = prefix.includes("/") ? path.dirname(prefix) : ".";
    const namePrefix = prefix.includes("/") ? path.basename(prefix) : prefix;

    const targetDir = path.resolve(workDir, prefixDir);
    const entries = await readdir(targetDir, { withFileTypes: true });

    const IGNORED = new Set(["node_modules", ".git", ".DS_Store"]);
    const results: Array<{ value: string; label: string }> = [];

    for (const entry of entries) {
      if (IGNORED.has(entry.name)) continue;
      if (entry.name.startsWith(".")) continue;
      if (namePrefix && !entry.name.startsWith(namePrefix)) continue;
      if (!entry.isFile()) continue;

      const relPath = prefixDir === "." ? entry.name : path.join(prefixDir, entry.name);

      results.push({
        value: `@${relPath}`,
        label: relPath,
      });

      if (results.length >= 20) break;
    }

    return results;
  } catch {
    return [];
  }
}

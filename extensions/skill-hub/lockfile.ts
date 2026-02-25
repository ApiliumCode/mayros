/**
 * Skill Lockfile Management
 *
 * Persists resolved dependency versions to skills.lock
 * for deterministic installs.
 */

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type SkillLockEntry = {
  version: string;
  hash: string;
  resolvedAt: string; // ISO 8601
};

export type SkillLock = {
  version: 1;
  resolved: Record<string, SkillLockEntry>;
};

const LOCKFILE_NAME = "skills.lock";

/**
 * Read a lockfile from a directory.
 * Returns undefined if no lockfile exists.
 */
export async function readLockfile(dir: string): Promise<SkillLock | undefined> {
  try {
    const content = await readFile(join(dir, LOCKFILE_NAME), "utf-8");
    const parsed = JSON.parse(content) as SkillLock;
    if (parsed.version !== 1) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/**
 * Write a lockfile to a directory.
 */
export async function writeLockfile(dir: string, lock: SkillLock): Promise<void> {
  const content = JSON.stringify(lock, null, 2) + "\n";
  await writeFile(join(dir, LOCKFILE_NAME), content, "utf-8");
}

/**
 * Merge new resolved entries into an existing lockfile.
 * New entries overwrite existing ones by slug.
 */
export function mergeLockfile(
  existing: SkillLock | undefined,
  newEntries: Record<string, SkillLockEntry>,
): SkillLock {
  const resolved = { ...existing?.resolved, ...newEntries };
  return { version: 1, resolved };
}

/**
 * Create a lock entry from resolved skill info.
 */
export function createLockEntry(version: string, hash: string): SkillLockEntry {
  return {
    version,
    hash,
    resolvedAt: new Date().toISOString(),
  };
}

import { readdirSync, statSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type CleanupResult = {
  scanned: number;
  removed: number;
  bytesFreed: number;
};

export type CleanupOptions = {
  maxAgeDays?: number;
  maxSessions?: number;
  sessionDir?: string;
  dryRun?: boolean;
};

const DEFAULT_MAX_AGE_DAYS = 30;
const DEFAULT_MAX_SESSIONS = 100;

export function cleanupStaleSessions(opts: CleanupOptions = {}): CleanupResult {
  const maxAgeDays = opts.maxAgeDays ?? DEFAULT_MAX_AGE_DAYS;
  const maxSessions = opts.maxSessions ?? DEFAULT_MAX_SESSIONS;
  const sessionDir = opts.sessionDir ?? join(homedir(), ".mayros", "sessions");
  const dryRun = opts.dryRun ?? false;

  let scanned = 0;
  let removed = 0;
  let bytesFreed = 0;

  let entries: { name: string; path: string; mtime: number; size: number }[];
  try {
    const files = readdirSync(sessionDir);
    entries = files
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const fullPath = join(sessionDir, f);
        try {
          const st = statSync(fullPath);
          return { name: f, path: fullPath, mtime: st.mtimeMs, size: st.size };
        } catch {
          return null;
        }
      })
      .filter((e): e is NonNullable<typeof e> => e !== null);
  } catch {
    return { scanned: 0, removed: 0, bytesFreed: 0 };
  }

  scanned = entries.length;
  const now = Date.now();
  const maxAgeMs = maxAgeDays * 24 * 60 * 60 * 1000;

  // Sort by mtime descending (newest first)
  entries.sort((a, b) => b.mtime - a.mtime);

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i]!;
    const age = now - entry.mtime;
    const isStale = age > maxAgeMs;
    const isOverLimit = i >= maxSessions;

    if (isStale || isOverLimit) {
      if (!dryRun) {
        try {
          unlinkSync(entry.path);
        } catch {
          continue;
        }
      }
      removed++;
      bytesFreed += entry.size;
    }
  }

  return { scanned, removed, bytesFreed };
}

export function shouldRunCleanup(): boolean {
  // Run cleanup at most once per day
  const markerPath = join(homedir(), ".mayros", ".last-cleanup");
  try {
    const st = statSync(markerPath);
    const hoursSince = (Date.now() - st.mtimeMs) / (1000 * 60 * 60);
    return hoursSince >= 24;
  } catch {
    return true; // marker doesn't exist yet
  }
}

export function markCleanupDone(): void {
  const markerPath = join(homedir(), ".mayros", ".last-cleanup");
  try {
    const { writeFileSync, mkdirSync } = require("node:fs");
    const { dirname } = require("node:path");
    mkdirSync(dirname(markerPath), { recursive: true });
    writeFileSync(markerPath, new Date().toISOString(), "utf-8");
  } catch {
    /* ignore */
  }
}

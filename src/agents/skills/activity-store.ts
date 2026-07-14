/**
 * Skill activity tracking.
 *
 * A lightweight JSON sidecar at ~/.mayros/skills/skill-activity.json that
 * records when each skill was last invoked and how many times. The curator
 * uses this data to transition skills through lifecycle states (active →
 * stale → archived).
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { resolveStateDir } from "../../config/paths.js";

export type SkillActivity = {
  lastInvokedAt: number;
  invocationCount: number;
  firstInvokedAt: number;
};

export type SkillActivityStore = Record<string, SkillActivity>;

/** Resolve the activity store path (~/.mayros/skills/skill-activity.json). */
export function resolveActivityStorePath(): string {
  return join(resolveStateDir(), "skills", "skill-activity.json");
}

/** Read the activity store, returning an empty record if it does not exist. */
export function readActivityStore(path?: string): SkillActivityStore {
  const filePath = path ?? resolveActivityStorePath();
  try {
    if (!existsSync(filePath)) return {};
    const content = readFileSync(filePath, "utf8");
    return JSON.parse(content) as SkillActivityStore;
  } catch {
    return {};
  }
}

/** Write the activity store, creating the directory if needed. */
export function writeActivityStore(store: SkillActivityStore, path?: string): void {
  const filePath = path ?? resolveActivityStorePath();
  mkdirSync(join(filePath, ".."), { recursive: true });
  writeFileSync(filePath, JSON.stringify(store, null, 2) + "\n", "utf8");
}

/**
 * Record a skill invocation: bump the count and update timestamps.
 * Returns the updated entry.
 */
export function recordSkillInvocation(
  skillKey: string,
  now: number = Date.now(),
  path?: string,
): SkillActivity {
  const store = readActivityStore(path);
  const existing = store[skillKey];
  const updated: SkillActivity = {
    lastInvokedAt: now,
    invocationCount: (existing?.invocationCount ?? 0) + 1,
    firstInvokedAt: existing?.firstInvokedAt ?? now,
  };
  store[skillKey] = updated;
  writeActivityStore(store, path);
  return updated;
}

/** Get activity for a specific skill, or null if never invoked. */
export function getSkillActivity(skillKey: string, path?: string): SkillActivity | null {
  const store = readActivityStore(path);
  return store[skillKey] ?? null;
}

/**
 * Determine the days since last invocation for a skill.
 * Returns Infinity if the skill was never invoked.
 */
export function daysSinceLastInvoked(
  skillKey: string,
  now: number = Date.now(),
  path?: string,
): number {
  const activity = getSkillActivity(skillKey, path);
  if (!activity) return Infinity;
  return Math.floor((now - activity.lastInvokedAt) / (1000 * 60 * 60 * 24));
}

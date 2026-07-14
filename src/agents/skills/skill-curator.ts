/**
 * Skill curator — automatic lifecycle management.
 *
 * Runs as a background sweep (piggy-backed on the cron timer, mirroring
 * session-reaper.ts) to transition skills through lifecycle states based
 * on activity data:
 *
 *   active  → stale     when not invoked for staleAfterDays (default 30)
 *   stale   → archived  when not invoked for archiveAfterDays (default 90)
 *
 * Pinned skills are never transitioned. Only skills with source
 * "mayros-managed" (agent-created) are eligible for archival; user skills
 * can go stale but are never archived automatically.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import {
  daysSinceLastInvoked,
  readActivityStore,
  type SkillActivityStore,
} from "./activity-store.js";

export type CuratorConfig = {
  enabled: boolean;
  staleAfterDays: number;
  archiveAfterDays: number;
};

export const DEFAULT_CURATOR_CONFIG: CuratorConfig = {
  enabled: true,
  staleAfterDays: 30,
  archiveAfterDays: 90,
};

export type SkillSummary = {
  skillKey: string;
  name: string;
  source: string;
  state: string;
  pinned: boolean;
  filePath: string;
  daysSinceInvoked: number;
};

export type CuratorSweepResult = {
  scanned: number;
  stale: number;
  archived: number;
  skipped: number;
};

const MIN_SWEEP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
let lastSweepAt = 0;

/**
 * Discover skill files in the managed skills directory (~/.mayros/skills/).
 * Returns a list of skill summaries with metadata parsed from frontmatter.
 */
export function discoverManagedSkills(skillsDir?: string): SkillSummary[] {
  const dir = skillsDir ?? join(resolveStateDir(), "skills");
  if (!existsSync(dir)) return [];

  const { readdirSync } = require("node:fs") as typeof import("node:fs");
  const skills: SkillSummary[] = [];

  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(dir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;

    try {
      const content = readFileSync(skillFile, "utf8");
      const meta = parseSkillFrontmatter(content);
      skills.push({
        skillKey: meta.skillKey ?? entry.name,
        name: meta.name ?? entry.name,
        source: meta.source ?? "mayros-managed",
        state: meta.state ?? "active",
        pinned: meta.pinned ?? false,
        filePath: skillFile,
        daysSinceInvoked: daysSinceLastInvoked(meta.skillKey ?? entry.name),
      });
    } catch {
      // Skip unreadable skills.
    }
  }

  return skills;
}

/**
 * Run a lifecycle sweep: transition stale and archived skills based on
 * activity data. Self-throttled to avoid running more than once per
 * MIN_SWEEP_INTERVAL_MS.
 */
export function sweepSkillLifecycle(
  config: CuratorConfig = DEFAULT_CURATOR_CONFIG,
  opts?: { skillsDir?: string; now?: number; activityPath?: string },
): CuratorSweepResult {
  const now = opts?.now ?? Date.now();
  if (!config.enabled) return { scanned: 0, stale: 0, archived: 0, skipped: 0 };
  if (now - lastSweepAt < MIN_SWEEP_INTERVAL_MS) {
    return { scanned: 0, stale: 0, archived: 0, skipped: 0 };
  }
  lastSweepAt = now;

  const skills = discoverManagedSkills(opts?.skillsDir);
  let stale = 0;
  let archived = 0;
  let skipped = 0;

  for (const skill of skills) {
    // Pinned skills never transition.
    if (skill.pinned) {
      skipped++;
      continue;
    }

    if (skill.state === "archived") {
      skipped++;
      continue;
    }

    const days = skill.daysSinceInvoked;

    // active → stale
    if (skill.state === "active" && days > config.staleAfterDays) {
      updateSkillState(skill.filePath, "stale");
      stale++;
      continue;
    }

    // stale → archived (only for agent-created skills)
    if (
      skill.state === "stale" &&
      days > config.archiveAfterDays &&
      skill.source === "mayros-managed"
    ) {
      archiveSkill(skill.filePath, skill.name);
      archived++;
      continue;
    }
  }

  return { scanned: skills.length, stale, archived, skipped };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type ParsedFrontmatter = {
  name?: string;
  skillKey?: string;
  source?: string;
  state?: string;
  pinned?: boolean;
};

function parseSkillFrontmatter(content: string): ParsedFrontmatter {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return {};
  const yaml = match[1];
  const result: ParsedFrontmatter = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^(\w[\w-]*):\s*(.*)$/);
    if (!m) continue;
    const [, key, value] = m;
    if (key === "name") result.name = value;
    else if (key === "skillKey") result.skillKey = value;
    else if (key === "source") result.source = value;
    else if (key === "state") result.state = value;
    else if (key === "pinned") result.pinned = value === "true";
  }
  return result;
}

function updateSkillState(filePath: string, newState: string): void {
  try {
    const content = readFileSync(filePath, "utf8");
    // Update or add the state field in the frontmatter.
    if (/^state:\s*/m.test(content)) {
      const updated = content.replace(/^state:\s*.*$/m, `state: ${newState}`);
      writeFileSync(filePath, updated, "utf8");
    } else {
      // Add state after the first line of frontmatter.
      const updated = content.replace(/^---\n/, `---\nstate: ${newState}\n`);
      writeFileSync(filePath, updated, "utf8");
    }
  } catch {
    // Best-effort — if the file is unreadable, skip.
  }
}

function archiveSkill(filePath: string, skillName: string): void {
  try {
    const archiveDir = join(resolveStateDir(), "skills.archived", skillName);
    mkdirSync(archiveDir, { recursive: true });
    const dest = join(archiveDir, "SKILL.md");
    // Move the entire skill directory to the archive.
    const skillDir = join(filePath, "..");
    renameSync(skillDir, archiveDir);
  } catch {
    // Best-effort — if the move fails, just mark as archived in frontmatter.
    updateSkillState(filePath, "archived");
  }
}

/** Reset the sweep throttle (for testing). */
export function resetCuratorThrottle(): void {
  lastSweepAt = 0;
}

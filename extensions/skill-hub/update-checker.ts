/**
 * Skill Update Checker
 *
 * Scans installed skills for available updates from the Hub.
 * Reads SKILL.md frontmatter for local version, compares with Hub latest.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type UpdateInfo = {
  slug: string;
  currentVersion: string;
  latestVersion: string;
  hasUpdate: boolean;
};

type HubClientLike = {
  getSkill: (slug: string) => Promise<{ version: string }>;
};

/**
 * Extract the skillVersion from a SKILL.md file's frontmatter.
 * Returns undefined if no version is found.
 */
function extractSkillVersion(content: string): string | undefined {
  const match = content.match(/skillVersion:\s*["']?(\d+\.\d+\.\d+[^\s"']*)["']?/);
  return match?.[1];
}

/**
 * Compare two semver strings. Returns:
 *  -1 if a < b, 0 if a == b, 1 if a > b.
 * Handles simple x.y.z format; ignores pre-release tags for ordering.
 */
function compareSemver(a: string, b: string): number {
  const pa = a.replace(/-.+$/, "").split(".").map(Number);
  const pb = b.replace(/-.+$/, "").split(".").map(Number);

  for (let i = 0; i < 3; i++) {
    const va = pa[i] ?? 0;
    const vb = pb[i] ?? 0;
    if (va < vb) return -1;
    if (va > vb) return 1;
  }
  return 0;
}

export class UpdateChecker {
  /**
   * Check a single skill for updates.
   */
  async checkSingle(
    slug: string,
    currentVersion: string,
    hubClient: HubClientLike,
  ): Promise<UpdateInfo> {
    const info = await hubClient.getSkill(slug);
    const hasUpdate = compareSemver(currentVersion, info.version) < 0;
    return {
      slug,
      currentVersion,
      latestVersion: info.version,
      hasUpdate,
    };
  }

  /**
   * Check all installed skills for updates.
   * Scans `skillsDir` for directories containing SKILL.md with a skillVersion.
   */
  async checkForUpdates(skillsDir: string, hubClient: HubClientLike): Promise<UpdateInfo[]> {
    const results: UpdateInfo[] = [];

    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(skillsDir, { withFileTypes: true });
    } catch {
      return results;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const slug = entry.name;
      const skillMdPath = join(skillsDir, slug, "SKILL.md");

      let content: string;
      try {
        content = await readFile(skillMdPath, "utf-8");
      } catch {
        continue; // No SKILL.md, skip
      }

      const currentVersion = extractSkillVersion(content);
      if (!currentVersion) continue;

      try {
        const info = await this.checkSingle(slug, currentVersion, hubClient);
        results.push(info);
      } catch {
        // Hub lookup failed for this skill, skip
      }
    }

    return results;
  }
}

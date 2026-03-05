/**
 * Skill Update Checker
 *
 * Scans installed skills for available updates from the Hub.
 * Reads SKILL.md frontmatter for local version, compares with Hub latest.
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import type { CortexClientLike } from "../shared/cortex-client.js";

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

// ============================================================================
// Cortex persistence helpers
// ============================================================================

function updateSubject(ns: string, slug: string): string {
  return `${ns}:skill:update:${slug}`;
}

function updatePred(ns: string, field: string): string {
  return `${ns}:skill:update:${field}`;
}

export class UpdateChecker {
  private readonly cortex: CortexClientLike | null;
  private readonly ns: string;

  constructor(cortex?: CortexClientLike, ns = "mayros") {
    this.cortex = cortex ?? null;
    this.ns = ns;
  }

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
    const result: UpdateInfo = {
      slug,
      currentVersion,
      latestVersion: info.version,
      hasUpdate,
    };

    await this.persistCheck(result);
    return result;
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

  /**
   * Retrieve the last persisted update check for a skill from Cortex.
   */
  async getLastCheck(slug: string): Promise<(UpdateInfo & { checkedAt: string }) | null> {
    if (!this.cortex) return null;

    try {
      const subject = updateSubject(this.ns, slug);
      const { matches } = await this.cortex.patternQuery({ subject, limit: 10 });
      if (matches.length === 0) return null;

      const fields = new Map<string, string>();
      for (const t of matches) {
        const key = t.predicate.split(":").pop() ?? "";
        fields.set(key, String(t.object));
      }

      return {
        slug,
        currentVersion: fields.get("currentVersion") ?? "unknown",
        latestVersion: fields.get("latestVersion") ?? "unknown",
        hasUpdate: fields.get("hasUpdate") === "true",
        checkedAt: fields.get("checkedAt") ?? "",
      };
    } catch {
      return null;
    }
  }

  /**
   * Persist an update check result to Cortex as RDF triples.
   */
  private async persistCheck(info: UpdateInfo): Promise<void> {
    if (!this.cortex) return;

    try {
      const subject = updateSubject(this.ns, info.slug);
      const pred = (field: string) => updatePred(this.ns, field);
      const now = new Date().toISOString();

      const fields: Array<[string, string | boolean]> = [
        ["currentVersion", info.currentVersion],
        ["latestVersion", info.latestVersion],
        ["hasUpdate", String(info.hasUpdate)],
        ["checkedAt", now],
      ];

      for (const [field, value] of fields) {
        const { matches } = await this.cortex.patternQuery({
          subject,
          predicate: pred(field),
          limit: 1,
        });
        for (const t of matches) {
          if (t.id) await this.cortex.deleteTriple(t.id);
        }
        await this.cortex.createTriple({ subject, predicate: pred(field), object: value });
      }
    } catch {
      // Cortex persistence failure is non-fatal
    }
  }
}

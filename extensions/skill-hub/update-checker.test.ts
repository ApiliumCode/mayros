import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { UpdateChecker, type UpdateInfo } from "./update-checker.js";

// ============================================================================
// Helpers
// ============================================================================

let tmpDirs: string[] = [];

async function createTmpSkillsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "uc-test-"));
  tmpDirs.push(dir);
  return dir;
}

async function writeSkillMd(skillsDir: string, slug: string, version: string): Promise<void> {
  const skillDir = path.join(skillsDir, slug);
  await fs.mkdir(skillDir, { recursive: true });
  await fs.writeFile(
    path.join(skillDir, "SKILL.md"),
    `---\nname: ${slug}\nskillVersion: "${version}"\n---\n# ${slug}\n`,
    "utf-8",
  );
}

function mockHubClient(versions: Record<string, string>) {
  return {
    getSkill: async (slug: string) => {
      const v = versions[slug];
      if (!v) throw new Error(`skill not found: ${slug}`);
      return { version: v };
    },
  };
}

afterEach(async () => {
  for (const dir of tmpDirs) {
    await fs.rm(dir, { recursive: true, force: true });
  }
  tmpDirs = [];
});

// ============================================================================
// Tests
// ============================================================================

describe("UpdateChecker.checkSingle", () => {
  const checker = new UpdateChecker();

  it("detects update available", async () => {
    const hub = mockHubClient({ "my-skill": "2.0.0" });
    const result = await checker.checkSingle("my-skill", "1.0.0", hub);
    expect(result.hasUpdate).toBe(true);
    expect(result.latestVersion).toBe("2.0.0");
    expect(result.currentVersion).toBe("1.0.0");
  });

  it("detects no update when same version", async () => {
    const hub = mockHubClient({ "my-skill": "1.0.0" });
    const result = await checker.checkSingle("my-skill", "1.0.0", hub);
    expect(result.hasUpdate).toBe(false);
  });

  it("detects no update when local is newer", async () => {
    const hub = mockHubClient({ "my-skill": "1.0.0" });
    const result = await checker.checkSingle("my-skill", "2.0.0", hub);
    expect(result.hasUpdate).toBe(false);
  });

  it("handles patch version differences", async () => {
    const hub = mockHubClient({ "my-skill": "1.0.2" });
    const result = await checker.checkSingle("my-skill", "1.0.1", hub);
    expect(result.hasUpdate).toBe(true);
  });

  it("handles minor version differences", async () => {
    const hub = mockHubClient({ "my-skill": "1.2.0" });
    const result = await checker.checkSingle("my-skill", "1.1.0", hub);
    expect(result.hasUpdate).toBe(true);
  });

  it("propagates hub errors", async () => {
    const hub = mockHubClient({});
    await expect(checker.checkSingle("missing", "1.0.0", hub)).rejects.toThrow("skill not found");
  });
});

describe("UpdateChecker.checkForUpdates", () => {
  const checker = new UpdateChecker();

  it("finds updates for installed skills", async () => {
    const dir = await createTmpSkillsDir();
    await writeSkillMd(dir, "skill-a", "1.0.0");
    await writeSkillMd(dir, "skill-b", "2.0.0");
    const hub = mockHubClient({ "skill-a": "1.1.0", "skill-b": "2.0.0" });

    const results = await checker.checkForUpdates(dir, hub);
    expect(results).toHaveLength(2);

    const a = results.find((r) => r.slug === "skill-a");
    expect(a?.hasUpdate).toBe(true);

    const b = results.find((r) => r.slug === "skill-b");
    expect(b?.hasUpdate).toBe(false);
  });

  it("skips directories without SKILL.md", async () => {
    const dir = await createTmpSkillsDir();
    await fs.mkdir(path.join(dir, "no-manifest"), { recursive: true });
    await writeSkillMd(dir, "valid-skill", "1.0.0");
    const hub = mockHubClient({ "valid-skill": "1.0.0" });

    const results = await checker.checkForUpdates(dir, hub);
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("valid-skill");
  });

  it("skips skills without skillVersion in frontmatter", async () => {
    const dir = await createTmpSkillsDir();
    const skillDir = path.join(dir, "no-version");
    await fs.mkdir(skillDir, { recursive: true });
    await fs.writeFile(
      path.join(skillDir, "SKILL.md"),
      "---\nname: no-version\n---\n# No version\n",
      "utf-8",
    );
    const hub = mockHubClient({ "no-version": "1.0.0" });

    const results = await checker.checkForUpdates(dir, hub);
    expect(results).toHaveLength(0);
  });

  it("returns empty array for nonexistent directory", async () => {
    const hub = mockHubClient({});
    const results = await checker.checkForUpdates("/nonexistent-path-xyz", hub);
    expect(results).toHaveLength(0);
  });

  it("skips skills that fail hub lookup", async () => {
    const dir = await createTmpSkillsDir();
    await writeSkillMd(dir, "found", "1.0.0");
    await writeSkillMd(dir, "missing", "1.0.0");
    const hub = mockHubClient({ found: "1.1.0" });

    const results = await checker.checkForUpdates(dir, hub);
    expect(results).toHaveLength(1);
    expect(results[0].slug).toBe("found");
  });
});

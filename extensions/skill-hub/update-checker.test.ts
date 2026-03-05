import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CortexClientLike } from "../shared/cortex-client.js";
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

// ============================================================================
// Cortex persistence tests
// ============================================================================

type StoredTriple = {
  id: string;
  subject: string;
  predicate: string;
  object: string | number | boolean | { node: string };
};

function createMockCortex(): CortexClientLike & { triples: StoredTriple[] } {
  let nextId = 1;
  const triples: StoredTriple[] = [];

  return {
    triples,
    createTriple: vi.fn(async (req) => {
      const id = String(nextId++);
      const t: StoredTriple = {
        id,
        subject: req.subject,
        predicate: req.predicate,
        object: req.object,
      };
      triples.push(t);
      return { ...t };
    }),
    listTriples: vi.fn(async (query) => {
      const matches = triples.filter((t) => {
        if (query.subject && t.subject !== query.subject) return false;
        if (query.predicate && t.predicate !== query.predicate) return false;
        return true;
      });
      return { triples: matches, total: matches.length };
    }),
    patternQuery: vi.fn(async (req) => {
      const matches = triples.filter((t) => {
        if (req.subject && t.subject !== req.subject) return false;
        if (req.predicate && t.predicate !== req.predicate) return false;
        return true;
      });
      return { matches, total: matches.length };
    }),
    deleteTriple: vi.fn(async (id: string) => {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
    }),
  };
}

describe("UpdateChecker — Cortex persistence", () => {
  it("persists update check as triples", async () => {
    const hub = mockHubClient({ "my-skill": "2.0.0" });
    const cortex = createMockCortex();
    const checker = new UpdateChecker(cortex, "test");

    await checker.checkSingle("my-skill", "1.0.0", hub);

    expect(cortex.createTriple).toHaveBeenCalled();

    const triples = cortex.triples.filter((t) => t.subject === "test:skill:update:my-skill");
    const preds = triples.map((t) => t.predicate.split(":").pop());
    expect(preds).toContain("currentVersion");
    expect(preds).toContain("latestVersion");
    expect(preds).toContain("hasUpdate");
    expect(preds).toContain("checkedAt");

    const hasUpdateTriple = triples.find((t) => t.predicate.endsWith(":hasUpdate"));
    expect(hasUpdateTriple?.object).toBe("true");
  });

  it("retrieves last check from Cortex via getLastCheck", async () => {
    const hub = mockHubClient({ "my-skill": "2.0.0" });
    const cortex = createMockCortex();
    const checker = new UpdateChecker(cortex, "test");

    await checker.checkSingle("my-skill", "1.0.0", hub);

    const last = await checker.getLastCheck("my-skill");
    expect(last).not.toBeNull();
    expect(last!.slug).toBe("my-skill");
    expect(last!.currentVersion).toBe("1.0.0");
    expect(last!.latestVersion).toBe("2.0.0");
    expect(last!.hasUpdate).toBe(true);
    expect(last!.checkedAt).toBeTruthy();
  });

  it("getLastCheck returns null without cortex", async () => {
    const checker = new UpdateChecker();
    const result = await checker.getLastCheck("anything");
    expect(result).toBeNull();
  });

  it("skips persistence silently without cortex", async () => {
    const hub = mockHubClient({ "my-skill": "1.0.0" });
    const checker = new UpdateChecker(); // no cortex

    // Should not throw
    const result = await checker.checkSingle("my-skill", "1.0.0", hub);
    expect(result.hasUpdate).toBe(false);
  });

  it("overwrites previous check triples on re-check", async () => {
    const hub = mockHubClient({ "my-skill": "2.0.0" });
    const cortex = createMockCortex();
    const checker = new UpdateChecker(cortex, "test");

    await checker.checkSingle("my-skill", "1.0.0", hub);
    const countAfterFirst = cortex.triples.filter(
      (t) => t.subject === "test:skill:update:my-skill",
    ).length;

    await checker.checkSingle("my-skill", "1.5.0", hub);
    const countAfterSecond = cortex.triples.filter(
      (t) => t.subject === "test:skill:update:my-skill",
    ).length;

    expect(countAfterSecond).toBe(countAfterFirst);

    // Version should be updated
    const versionTriple = cortex.triples.find(
      (t) => t.subject === "test:skill:update:my-skill" && t.predicate.endsWith(":currentVersion"),
    );
    expect(versionTriple?.object).toBe("1.5.0");
  });

  it("persists during checkForUpdates for each skill", async () => {
    const dir = await createTmpSkillsDir();
    await writeSkillMd(dir, "skill-a", "1.0.0");
    await writeSkillMd(dir, "skill-b", "2.0.0");
    const hub = mockHubClient({ "skill-a": "1.1.0", "skill-b": "2.0.0" });
    const cortex = createMockCortex();
    const checker = new UpdateChecker(cortex, "test");

    await checker.checkForUpdates(dir, hub);

    const aTriples = cortex.triples.filter((t) => t.subject === "test:skill:update:skill-a");
    const bTriples = cortex.triples.filter((t) => t.subject === "test:skill:update:skill-b");
    expect(aTriples.length).toBeGreaterThan(0);
    expect(bTriples.length).toBeGreaterThan(0);
  });
});

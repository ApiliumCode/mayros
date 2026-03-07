import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveDefaultConfigCandidates,
  resolveConfigPathCandidate,
  resolveConfigPath,
  resolveOAuthDir,
  resolveOAuthPath,
  resolveStateDir,
} from "./paths.js";

describe("oauth paths", () => {
  it("prefers MAYROS_OAUTH_DIR over MAYROS_STATE_DIR", () => {
    const env = {
      MAYROS_OAUTH_DIR: "/custom/oauth",
      MAYROS_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.resolve("/custom/oauth"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join(path.resolve("/custom/oauth"), "oauth.json"),
    );
  });

  it("derives oauth path from MAYROS_STATE_DIR when unset", () => {
    const env = {
      MAYROS_STATE_DIR: "/custom/state",
    } as NodeJS.ProcessEnv;

    expect(resolveOAuthDir(env, "/custom/state")).toBe(path.join("/custom/state", "credentials"));
    expect(resolveOAuthPath(env, "/custom/state")).toBe(
      path.join("/custom/state", "credentials", "oauth.json"),
    );
  });
});

describe("state + config path candidates", () => {
  function expectMayrosHomeDefaults(env: NodeJS.ProcessEnv): void {
    const configuredHome = env.MAYROS_HOME;
    if (!configuredHome) {
      throw new Error("MAYROS_HOME must be set for this assertion helper");
    }
    const resolvedHome = path.resolve(configuredHome);
    expect(resolveStateDir(env)).toBe(path.join(resolvedHome, ".mayros"));

    const candidates = resolveDefaultConfigCandidates(env);
    expect(candidates[0]).toBe(path.join(resolvedHome, ".mayros", "mayros.json"));
  }

  it("uses MAYROS_STATE_DIR when set", () => {
    const env = {
      MAYROS_STATE_DIR: "/new/state",
    } as NodeJS.ProcessEnv;

    expect(resolveStateDir(env, () => "/home/test")).toBe(path.resolve("/new/state"));
  });

  it("uses MAYROS_HOME for default state/config locations", () => {
    const env = {
      MAYROS_HOME: "/srv/mayros-home",
    } as NodeJS.ProcessEnv;
    expectMayrosHomeDefaults(env);
  });

  it("prefers MAYROS_HOME over HOME for default state/config locations", () => {
    const env = {
      MAYROS_HOME: "/srv/mayros-home",
      HOME: "/home/other",
    } as NodeJS.ProcessEnv;
    expectMayrosHomeDefaults(env);
  });

  it("orders default config candidates in a stable order", () => {
    const home = "/home/test";
    const resolvedHome = path.resolve(home);
    const candidates = resolveDefaultConfigCandidates({} as NodeJS.ProcessEnv, () => home);
    const expected = [path.join(resolvedHome, ".mayros", "mayros.json")];
    expect(candidates).toEqual(expected);
  });

  it("prefers ~/.mayros when it exists and legacy dir is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mayros-state-"));
    try {
      const newDir = path.join(root, ".mayros");
      await fs.mkdir(newDir, { recursive: true });
      const resolved = resolveStateDir({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(newDir);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("CONFIG_PATH prefers existing config when present", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mayros-config-"));
    try {
      const legacyDir = path.join(root, ".mayros");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyPath = path.join(legacyDir, "mayros.json");
      await fs.writeFile(legacyPath, "{}", "utf-8");

      const resolved = resolveConfigPathCandidate({} as NodeJS.ProcessEnv, () => root);
      expect(resolved).toBe(legacyPath);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });

  it("respects state dir overrides when config is missing", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "mayros-config-override-"));
    try {
      const legacyDir = path.join(root, ".mayros");
      await fs.mkdir(legacyDir, { recursive: true });
      const legacyConfig = path.join(legacyDir, "mayros.json");
      await fs.writeFile(legacyConfig, "{}", "utf-8");

      const overrideDir = path.join(root, "override");
      const env = { MAYROS_STATE_DIR: overrideDir } as NodeJS.ProcessEnv;
      const resolved = resolveConfigPath(env, overrideDir, () => root);
      expect(resolved).toBe(path.join(overrideDir, "mayros.json"));
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

import path from "node:path";
import { describe, expect, it } from "vitest";
import { formatCliCommand } from "./command-format.js";
import { applyCliProfileEnv, parseCliProfileArgs } from "./profile.js";

describe("parseCliProfileArgs", () => {
  it("leaves gateway --dev for subcommands", () => {
    const res = parseCliProfileArgs(["node", "mayros", "gateway", "--dev", "--allow-unconfigured"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBeNull();
    expect(res.argv).toEqual(["node", "mayros", "gateway", "--dev", "--allow-unconfigured"]);
  });

  it("still accepts global --dev before subcommand", () => {
    const res = parseCliProfileArgs(["node", "mayros", "--dev", "gateway"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("dev");
    expect(res.argv).toEqual(["node", "mayros", "gateway"]);
  });

  it("parses --profile value and strips it", () => {
    const res = parseCliProfileArgs(["node", "mayros", "--profile", "work", "status"]);
    if (!res.ok) {
      throw new Error(res.error);
    }
    expect(res.profile).toBe("work");
    expect(res.argv).toEqual(["node", "mayros", "status"]);
  });

  it("rejects missing profile value", () => {
    const res = parseCliProfileArgs(["node", "mayros", "--profile"]);
    expect(res.ok).toBe(false);
  });

  it.each([
    ["--dev first", ["node", "mayros", "--dev", "--profile", "work", "status"]],
    ["--profile first", ["node", "mayros", "--profile", "work", "--dev", "status"]],
  ])("rejects combining --dev with --profile (%s)", (_name, argv) => {
    const res = parseCliProfileArgs(argv);
    expect(res.ok).toBe(false);
  });
});

describe("applyCliProfileEnv", () => {
  it("fills env defaults for dev profile", () => {
    const env: Record<string, string | undefined> = {};
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    const expectedStateDir = path.join(path.resolve("/home/peter"), ".mayros-dev");
    expect(env.MAYROS_PROFILE).toBe("dev");
    expect(env.MAYROS_STATE_DIR).toBe(expectedStateDir);
    expect(env.MAYROS_CONFIG_PATH).toBe(path.join(expectedStateDir, "mayros.json"));
    expect(env.MAYROS_GATEWAY_PORT).toBe("19001");
  });

  it("does not override explicit env values", () => {
    const env: Record<string, string | undefined> = {
      MAYROS_STATE_DIR: "/custom",
      MAYROS_GATEWAY_PORT: "19099",
    };
    applyCliProfileEnv({
      profile: "dev",
      env,
      homedir: () => "/home/peter",
    });
    expect(env.MAYROS_STATE_DIR).toBe("/custom");
    expect(env.MAYROS_GATEWAY_PORT).toBe("19099");
    expect(env.MAYROS_CONFIG_PATH).toBe(path.join("/custom", "mayros.json"));
  });

  it("uses MAYROS_HOME when deriving profile state dir", () => {
    const env: Record<string, string | undefined> = {
      MAYROS_HOME: "/srv/mayros-home",
      HOME: "/home/other",
    };
    applyCliProfileEnv({
      profile: "work",
      env,
      homedir: () => "/home/fallback",
    });

    const resolvedHome = path.resolve("/srv/mayros-home");
    expect(env.MAYROS_STATE_DIR).toBe(path.join(resolvedHome, ".mayros-work"));
    expect(env.MAYROS_CONFIG_PATH).toBe(path.join(resolvedHome, ".mayros-work", "mayros.json"));
  });
});

describe("formatCliCommand", () => {
  it.each([
    {
      name: "no profile is set",
      cmd: "mayros doctor --fix",
      env: {},
      expected: "mayros doctor --fix",
    },
    {
      name: "profile is default",
      cmd: "mayros doctor --fix",
      env: { MAYROS_PROFILE: "default" },
      expected: "mayros doctor --fix",
    },
    {
      name: "profile is Default (case-insensitive)",
      cmd: "mayros doctor --fix",
      env: { MAYROS_PROFILE: "Default" },
      expected: "mayros doctor --fix",
    },
    {
      name: "profile is invalid",
      cmd: "mayros doctor --fix",
      env: { MAYROS_PROFILE: "bad profile" },
      expected: "mayros doctor --fix",
    },
    {
      name: "--profile is already present",
      cmd: "mayros --profile work doctor --fix",
      env: { MAYROS_PROFILE: "work" },
      expected: "mayros --profile work doctor --fix",
    },
    {
      name: "--dev is already present",
      cmd: "mayros --dev doctor",
      env: { MAYROS_PROFILE: "dev" },
      expected: "mayros --dev doctor",
    },
  ])("returns command unchanged when $name", ({ cmd, env, expected }) => {
    expect(formatCliCommand(cmd, env)).toBe(expected);
  });

  it("inserts --profile flag when profile is set", () => {
    expect(formatCliCommand("mayros doctor --fix", { MAYROS_PROFILE: "work" })).toBe(
      "mayros --profile work doctor --fix",
    );
  });

  it("trims whitespace from profile", () => {
    expect(formatCliCommand("mayros doctor --fix", { MAYROS_PROFILE: "  jbmayros  " })).toBe(
      "mayros --profile jbmayros doctor --fix",
    );
  });

  it("handles command with no args after mayros", () => {
    expect(formatCliCommand("mayros", { MAYROS_PROFILE: "test" })).toBe("mayros --profile test");
  });

  it("handles pnpm wrapper", () => {
    expect(formatCliCommand("pnpm mayros doctor", { MAYROS_PROFILE: "work" })).toBe(
      "pnpm mayros --profile work doctor",
    );
  });
});

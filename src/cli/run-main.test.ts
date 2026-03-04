import { describe, expect, it } from "vitest";
import {
  resolveDefaultCommand,
  rewriteUpdateFlagArgv,
  shouldEnsureCliPath,
  shouldRegisterPrimarySubcommand,
  shouldSkipPluginCommandRegistration,
} from "./run-main.js";

describe("rewriteUpdateFlagArgv", () => {
  it("leaves argv unchanged when --update is absent", () => {
    const argv = ["node", "entry.js", "status"];
    expect(rewriteUpdateFlagArgv(argv)).toBe(argv);
  });

  it("rewrites --update into the update command", () => {
    expect(rewriteUpdateFlagArgv(["node", "entry.js", "--update"])).toEqual([
      "node",
      "entry.js",
      "update",
    ]);
  });

  it("preserves global flags that appear before --update", () => {
    expect(rewriteUpdateFlagArgv(["node", "entry.js", "--profile", "p", "--update"])).toEqual([
      "node",
      "entry.js",
      "--profile",
      "p",
      "update",
    ]);
  });

  it("keeps update options after the rewritten command", () => {
    expect(rewriteUpdateFlagArgv(["node", "entry.js", "--update", "--json"])).toEqual([
      "node",
      "entry.js",
      "update",
      "--json",
    ]);
  });
});

describe("shouldRegisterPrimarySubcommand", () => {
  it("skips eager primary registration for help/version invocations", () => {
    expect(shouldRegisterPrimarySubcommand(["node", "mayros", "status", "--help"])).toBe(false);
    expect(shouldRegisterPrimarySubcommand(["node", "mayros", "-V"])).toBe(false);
    expect(shouldRegisterPrimarySubcommand(["node", "mayros", "-v"])).toBe(false);
  });

  it("keeps eager primary registration for regular command runs", () => {
    expect(shouldRegisterPrimarySubcommand(["node", "mayros", "status"])).toBe(true);
    expect(shouldRegisterPrimarySubcommand(["node", "mayros", "acp", "-v"])).toBe(true);
  });
});

describe("shouldSkipPluginCommandRegistration", () => {
  it("skips plugin registration for root help/version", () => {
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "mayros", "--help"],
        primary: null,
        hasBuiltinPrimary: false,
      }),
    ).toBe(true);
  });

  it("skips plugin registration for builtin subcommand help", () => {
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "mayros", "config", "--help"],
        primary: "config",
        hasBuiltinPrimary: true,
      }),
    ).toBe(true);
  });

  it("skips plugin registration for builtin command runs", () => {
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "mayros", "sessions", "--json"],
        primary: "sessions",
        hasBuiltinPrimary: true,
      }),
    ).toBe(true);
  });

  it("keeps plugin registration for non-builtin help", () => {
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "mayros", "voicecall", "--help"],
        primary: "voicecall",
        hasBuiltinPrimary: false,
      }),
    ).toBe(false);
  });

  it("keeps plugin registration for non-builtin command runs", () => {
    expect(
      shouldSkipPluginCommandRegistration({
        argv: ["node", "mayros", "voicecall", "status"],
        primary: "voicecall",
        hasBuiltinPrimary: false,
      }),
    ).toBe(false);
  });
});

describe("resolveDefaultCommand", () => {
  it("returns onboard when config does not exist", () => {
    expect(resolveDefaultCommand({ exists: false })).toBe("onboard");
  });

  it("returns onboard when config exists but wizard.lastRunAt is missing", () => {
    expect(resolveDefaultCommand({ exists: true, config: {} })).toBe("onboard");
    expect(resolveDefaultCommand({ exists: true, config: { wizard: {} } })).toBe("onboard");
  });

  it("returns code when config exists and wizard.lastRunAt is set", () => {
    expect(
      resolveDefaultCommand({
        exists: true,
        config: { wizard: { lastRunAt: "2024-01-01T00:00:00Z" } },
      }),
    ).toBe("code");
  });
});

describe("shouldEnsureCliPath", () => {
  it("skips path bootstrap for help/version invocations", () => {
    expect(shouldEnsureCliPath(["node", "mayros", "--help"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "mayros", "-V"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "mayros", "-v"])).toBe(false);
  });

  it("skips path bootstrap for read-only fast paths", () => {
    expect(shouldEnsureCliPath(["node", "mayros", "status"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "mayros", "sessions", "--json"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "mayros", "config", "get", "update"])).toBe(false);
    expect(shouldEnsureCliPath(["node", "mayros", "models", "status", "--json"])).toBe(false);
  });

  it("keeps path bootstrap for mutating or unknown commands", () => {
    expect(shouldEnsureCliPath(["node", "mayros", "message", "send"])).toBe(true);
    expect(shouldEnsureCliPath(["node", "mayros", "voicecall", "status"])).toBe(true);
    expect(shouldEnsureCliPath(["node", "mayros", "acp", "-v"])).toBe(true);
  });
});

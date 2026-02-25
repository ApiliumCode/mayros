import { describe, expect, it } from "vitest";
import {
  buildParseArgv,
  getFlagValue,
  getCommandPath,
  getPrimaryCommand,
  getPositiveIntFlagValue,
  getVerboseFlag,
  hasHelpOrVersion,
  hasFlag,
  shouldMigrateState,
  shouldMigrateStateFromPath,
} from "./argv.js";

describe("argv helpers", () => {
  it.each([
    {
      name: "help flag",
      argv: ["node", "mayros", "--help"],
      expected: true,
    },
    {
      name: "version flag",
      argv: ["node", "mayros", "-V"],
      expected: true,
    },
    {
      name: "normal command",
      argv: ["node", "mayros", "status"],
      expected: false,
    },
    {
      name: "root -v alias",
      argv: ["node", "mayros", "-v"],
      expected: true,
    },
    {
      name: "root -v alias with profile",
      argv: ["node", "mayros", "--profile", "work", "-v"],
      expected: true,
    },
    {
      name: "subcommand -v should not be treated as version",
      argv: ["node", "mayros", "acp", "-v"],
      expected: false,
    },
    {
      name: "root -v alias with equals profile",
      argv: ["node", "mayros", "--profile=work", "-v"],
      expected: true,
    },
    {
      name: "subcommand path after global root flags should not be treated as version",
      argv: ["node", "mayros", "--dev", "skills", "list", "-v"],
      expected: false,
    },
  ])("detects help/version flags: $name", ({ argv, expected }) => {
    expect(hasHelpOrVersion(argv)).toBe(expected);
  });

  it.each([
    {
      name: "single command with trailing flag",
      argv: ["node", "mayros", "status", "--json"],
      expected: ["status"],
    },
    {
      name: "two-part command",
      argv: ["node", "mayros", "agents", "list"],
      expected: ["agents", "list"],
    },
    {
      name: "terminator cuts parsing",
      argv: ["node", "mayros", "status", "--", "ignored"],
      expected: ["status"],
    },
  ])("extracts command path: $name", ({ argv, expected }) => {
    expect(getCommandPath(argv, 2)).toEqual(expected);
  });

  it.each([
    {
      name: "returns first command token",
      argv: ["node", "mayros", "agents", "list"],
      expected: "agents",
    },
    {
      name: "returns null when no command exists",
      argv: ["node", "mayros"],
      expected: null,
    },
  ])("returns primary command: $name", ({ argv, expected }) => {
    expect(getPrimaryCommand(argv)).toBe(expected);
  });

  it.each([
    {
      name: "detects flag before terminator",
      argv: ["node", "mayros", "status", "--json"],
      flag: "--json",
      expected: true,
    },
    {
      name: "ignores flag after terminator",
      argv: ["node", "mayros", "--", "--json"],
      flag: "--json",
      expected: false,
    },
  ])("parses boolean flags: $name", ({ argv, flag, expected }) => {
    expect(hasFlag(argv, flag)).toBe(expected);
  });

  it.each([
    {
      name: "value in next token",
      argv: ["node", "mayros", "status", "--timeout", "5000"],
      expected: "5000",
    },
    {
      name: "value in equals form",
      argv: ["node", "mayros", "status", "--timeout=2500"],
      expected: "2500",
    },
    {
      name: "missing value",
      argv: ["node", "mayros", "status", "--timeout"],
      expected: null,
    },
    {
      name: "next token is another flag",
      argv: ["node", "mayros", "status", "--timeout", "--json"],
      expected: null,
    },
    {
      name: "flag appears after terminator",
      argv: ["node", "mayros", "--", "--timeout=99"],
      expected: undefined,
    },
  ])("extracts flag values: $name", ({ argv, expected }) => {
    expect(getFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("parses verbose flags", () => {
    expect(getVerboseFlag(["node", "mayros", "status", "--verbose"])).toBe(true);
    expect(getVerboseFlag(["node", "mayros", "status", "--debug"])).toBe(false);
    expect(getVerboseFlag(["node", "mayros", "status", "--debug"], { includeDebug: true })).toBe(
      true,
    );
  });

  it.each([
    {
      name: "missing flag",
      argv: ["node", "mayros", "status"],
      expected: undefined,
    },
    {
      name: "missing value",
      argv: ["node", "mayros", "status", "--timeout"],
      expected: null,
    },
    {
      name: "valid positive integer",
      argv: ["node", "mayros", "status", "--timeout", "5000"],
      expected: 5000,
    },
    {
      name: "invalid integer",
      argv: ["node", "mayros", "status", "--timeout", "nope"],
      expected: undefined,
    },
  ])("parses positive integer flag values: $name", ({ argv, expected }) => {
    expect(getPositiveIntFlagValue(argv, "--timeout")).toBe(expected);
  });

  it("builds parse argv from raw args", () => {
    const cases = [
      {
        rawArgs: ["node", "mayros", "status"],
        expected: ["node", "mayros", "status"],
      },
      {
        rawArgs: ["node-22", "mayros", "status"],
        expected: ["node-22", "mayros", "status"],
      },
      {
        rawArgs: ["node-22.2.0.exe", "mayros", "status"],
        expected: ["node-22.2.0.exe", "mayros", "status"],
      },
      {
        rawArgs: ["node-22.2", "mayros", "status"],
        expected: ["node-22.2", "mayros", "status"],
      },
      {
        rawArgs: ["node-22.2.exe", "mayros", "status"],
        expected: ["node-22.2.exe", "mayros", "status"],
      },
      {
        rawArgs: ["/usr/bin/node-22.2.0", "mayros", "status"],
        expected: ["/usr/bin/node-22.2.0", "mayros", "status"],
      },
      {
        rawArgs: ["nodejs", "mayros", "status"],
        expected: ["nodejs", "mayros", "status"],
      },
      {
        rawArgs: ["node-dev", "mayros", "status"],
        expected: ["node", "mayros", "node-dev", "mayros", "status"],
      },
      {
        rawArgs: ["mayros", "status"],
        expected: ["node", "mayros", "status"],
      },
      {
        rawArgs: ["bun", "src/entry.ts", "status"],
        expected: ["bun", "src/entry.ts", "status"],
      },
    ] as const;

    for (const testCase of cases) {
      const parsed = buildParseArgv({
        programName: "mayros",
        rawArgs: [...testCase.rawArgs],
      });
      expect(parsed).toEqual([...testCase.expected]);
    }
  });

  it("builds parse argv from fallback args", () => {
    const fallbackArgv = buildParseArgv({
      programName: "mayros",
      fallbackArgv: ["status"],
    });
    expect(fallbackArgv).toEqual(["node", "mayros", "status"]);
  });

  it("decides when to migrate state", () => {
    const nonMutatingArgv = [
      ["node", "mayros", "status"],
      ["node", "mayros", "health"],
      ["node", "mayros", "sessions"],
      ["node", "mayros", "config", "get", "update"],
      ["node", "mayros", "config", "unset", "update"],
      ["node", "mayros", "models", "list"],
      ["node", "mayros", "models", "status"],
      ["node", "mayros", "memory", "status"],
      ["node", "mayros", "agent", "--message", "hi"],
    ] as const;
    const mutatingArgv = [
      ["node", "mayros", "agents", "list"],
      ["node", "mayros", "message", "send"],
    ] as const;

    for (const argv of nonMutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(false);
    }
    for (const argv of mutatingArgv) {
      expect(shouldMigrateState([...argv])).toBe(true);
    }
  });

  it.each([
    { path: ["status"], expected: false },
    { path: ["config", "get"], expected: false },
    { path: ["models", "status"], expected: false },
    { path: ["agents", "list"], expected: true },
  ])("reuses command path for migrate state decisions: $path", ({ path, expected }) => {
    expect(shouldMigrateStateFromPath(path)).toBe(expected);
  });
});

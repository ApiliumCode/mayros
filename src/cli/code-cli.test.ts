import { Command } from "commander";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { runTui } = vi.hoisted(() => ({ runTui: vi.fn() }));
const readConfigFileSnapshot = vi.hoisted(() => vi.fn());
const onboardCommand = vi.hoisted(() => vi.fn());
const runtime = vi.hoisted(() => ({
  log: vi.fn(),
  error: vi.fn(),
  exit: vi.fn(),
}));

vi.mock("../tui/tui.js", () => ({ runTui }));
vi.mock("../terminal/links.js", () => ({ formatDocsLink: (p: string) => p }));
vi.mock("../terminal/theme.js", () => ({
  theme: { muted: (s: string) => s, accent: (s: string) => s },
}));
vi.mock("../config/paths.js", () => ({
  resolveStateDir: () => "/tmp/mayros-test-state",
  resolveConfigPath: () => "/tmp/mayros-test-state/mayros.json",
}));
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return { ...actual, default: { ...actual, existsSync: () => true } };
});
vi.mock("../config/config.js", () => ({ readConfigFileSnapshot }));
vi.mock("../commands/onboard.js", () => ({ onboardCommand }));
vi.mock("../runtime.js", () => ({ defaultRuntime: runtime }));
vi.mock("./parse-timeout.js", () => ({ parseTimeoutMs: () => undefined }));
vi.mock("../models/model-aliases.js", () => ({
  resolveModelAlias: (input: string) => {
    const aliases: Record<string, string> = {
      sonnet: "anthropic/claude-sonnet",
      opus: "anthropic/claude-opus",
    };
    return aliases[input.toLowerCase()] ?? input;
  },
}));
vi.mock("node:crypto", () => ({
  randomUUID: () => "abcdef12-0000-0000-0000-000000000000",
}));

import { registerCodeCli } from "./code-cli.js";

function makeSnapshot(overrides: Record<string, unknown> = {}) {
  return {
    exists: false,
    config: {},
    valid: false,
    raw: null,
    parsed: null,
    resolved: {},
    issues: [],
    warnings: [],
    path: "/tmp/mayros.json",
    ...overrides,
  };
}

function onboardedSnapshot() {
  return makeSnapshot({
    exists: true,
    config: { wizard: { lastRunAt: "2025-01-01T00:00:00Z" } },
    valid: true,
    raw: "{}",
    parsed: {},
  });
}

describe("code cli", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTui.mockResolvedValue(undefined);
    onboardCommand.mockResolvedValue(undefined);
    // Default: already onboarded so existing tests pass unchanged
    readConfigFileSnapshot.mockResolvedValue(onboardedSnapshot());
  });

  it("registers the 'code' command", () => {
    const program = new Command();
    registerCodeCli(program);
    const cmd = program.commands.find((c) => c.name() === "code");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toBe("Start interactive coding session");
  });

  it("parses --session and --url options", async () => {
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code", "--session", "dev", "--url", "ws://localhost:9090"], {
      from: "user",
    });
    expect(runTui).toHaveBeenCalledWith(
      expect.objectContaining({
        session: "dev",
        url: "ws://localhost:9090",
      }),
    );
  });

  it("passes default options when invoked without flags", async () => {
    runTui.mockReset();
    readConfigFileSnapshot.mockResolvedValue(onboardedSnapshot());
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code"], { from: "user" });
    expect(runTui).toHaveBeenCalledWith(
      expect.objectContaining({
        deliver: false,
        historyLimit: 200,
      }),
    );
  });

  it("parses --deliver and --thinking flags", async () => {
    runTui.mockReset();
    readConfigFileSnapshot.mockResolvedValue(onboardedSnapshot());
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code", "--deliver", "--thinking", "high"], { from: "user" });
    expect(runTui).toHaveBeenCalledWith(
      expect.objectContaining({
        deliver: true,
        thinking: "high",
      }),
    );
  });
});

describe("code-cli zero-config setup redirect", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTui.mockResolvedValue(undefined);
    onboardCommand.mockResolvedValue(undefined);
  });

  it("skips onboard when already onboarded (wizard.lastRunAt present)", async () => {
    readConfigFileSnapshot.mockResolvedValue(onboardedSnapshot());

    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code"], { from: "user" });

    expect(onboardCommand).not.toHaveBeenCalled();
    expect(runTui).toHaveBeenCalledTimes(1);
  });

  it("runs onboard when not onboarded, completes successfully", async () => {
    // First call: not onboarded
    readConfigFileSnapshot.mockResolvedValueOnce(makeSnapshot());
    // Second call after onboard: now onboarded
    readConfigFileSnapshot.mockResolvedValueOnce(onboardedSnapshot());

    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code"], { from: "user" });

    expect(onboardCommand).toHaveBeenCalledTimes(1);
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Welcome to Mayros!"));
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Setup complete!"));
    expect(runTui).toHaveBeenCalledTimes(1);
  });

  it("aborts when onboard not completed (user cancels)", async () => {
    // First call: not onboarded
    readConfigFileSnapshot.mockResolvedValueOnce(makeSnapshot());
    // Second call after onboard: still not onboarded (user cancelled)
    readConfigFileSnapshot.mockResolvedValueOnce(makeSnapshot());

    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code"], { from: "user" });

    expect(onboardCommand).toHaveBeenCalledTimes(1);
    expect(runtime.log).toHaveBeenCalledWith(expect.stringContaining("Setup not completed"));
    expect(runTui).not.toHaveBeenCalled();
  });

  it("skips onboard when config exists with wizard.lastRunAt", async () => {
    readConfigFileSnapshot.mockResolvedValue(
      makeSnapshot({
        exists: true,
        config: { wizard: { lastRunAt: "2024-06-15T12:30:00Z", lastRunVersion: "0.1.0" } },
        valid: true,
        raw: '{"wizard":{}}',
        parsed: { wizard: {} },
      }),
    );

    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code"], { from: "user" });

    expect(onboardCommand).not.toHaveBeenCalled();
    expect(runTui).toHaveBeenCalledTimes(1);
  });
});

describe("code-cli new flags", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    runTui.mockResolvedValue(undefined);
    onboardCommand.mockResolvedValue(undefined);
    readConfigFileSnapshot.mockResolvedValue(onboardedSnapshot());
  });

  it("passes --continue as session __continue__", async () => {
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code", "--continue"], { from: "user" });

    expect(runTui).toHaveBeenCalledWith(expect.objectContaining({ session: "__continue__" }));
  });

  it("passes --model through to runTui", async () => {
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code", "--model", "sonnet"], { from: "user" });

    expect(runTui).toHaveBeenCalledWith(
      expect.objectContaining({ model: "anthropic/claude-sonnet" }),
    );
  });

  it("passes --system-prompt in initial message", async () => {
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code", "--system-prompt", "Be concise", "--message", "hello"], {
      from: "user",
    });

    const call = runTui.mock.calls[0]?.[0];
    expect(call?.message).toContain("[System: Be concise]");
    expect(call?.message).toContain("hello");
  });

  it("passes --append-system-prompt in initial message", async () => {
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code", "--append-system-prompt", "Use JSON", "--message", "hello"], {
      from: "user",
    });

    const call = runTui.mock.calls[0]?.[0];
    expect(call?.message).toContain("[System: Use JSON]");
    expect(call?.message).toContain("hello");
  });

  it("--fork-session derives a new session key", async () => {
    const program = new Command();
    registerCodeCli(program);
    await program.parseAsync(["code", "--session", "dev", "--fork-session"], { from: "user" });

    const call = runTui.mock.calls[0]?.[0];
    // Should start with the base session name and include a UUID fragment
    expect(call?.session).toMatch(/^dev-[0-9a-f]{8}$/);
  });
});

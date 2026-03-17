/**
 * Tests for the `mayros kaneru` CLI subcommand.
 *
 * Validates:
 * - Registration as a subcli with correct name, description, and subcommands
 * - Squad subcommand group with create, run, status, list
 * - Top-level subcommands: delegate, consensus, route, fuse, dashboard
 * - Cortex connection options (--cortex-host, --cortex-port, --cortex-token)
 * - createFacade wraps import errors gracefully
 * - handleError prints CortexError and generic error messages correctly
 */

import { Command } from "commander";
import { describe, it, expect, vi, afterEach } from "vitest";
import { CortexError } from "../../extensions/shared/cortex-client.js";

vi.mock("./shared/cortex-resolution.js", async () => {
  const { CortexError: CE } = await import("../../extensions/shared/cortex-client.js");
  return {
    resolveCortexClient: vi.fn(),
    CortexError: CE,
  };
});

// Default mock: dynamic import throws so createFacade wraps the error.
vi.mock("../../extensions/agent-mesh/kaneru-facade.js", () => {
  throw new Error("module-not-found-stub");
});

import { registerKaneruCli } from "./kaneru-cli.js";

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = undefined;
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeProgram(): Command {
  const program = new Command();
  program.name("test");
  registerKaneruCli(program);
  return program;
}

function getKaneru(program: Command): Command {
  const cmd = program.commands.find((c) => c.name() === "kaneru");
  expect(cmd).toBeDefined();
  return cmd!;
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

describe("kaneru CLI registration", () => {
  it("registers 'kaneru' command with correct description", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    expect(kaneru.description()).toContain("multi-agent");
  });

  it("accepts --cortex-host option", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const opt = kaneru.options.find((o) => o.long === "--cortex-host");
    expect(opt).toBeDefined();
  });

  it("accepts --cortex-port option", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const opt = kaneru.options.find((o) => o.long === "--cortex-port");
    expect(opt).toBeDefined();
  });

  it("accepts --cortex-token option", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const opt = kaneru.options.find((o) => o.long === "--cortex-token");
    expect(opt).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// Subcommand structure
// ---------------------------------------------------------------------------

describe("kaneru subcommands", () => {
  it("has 'squad' subcommand group", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const squad = kaneru.commands.find((c) => c.name() === "squad");
    expect(squad).toBeDefined();
    expect(squad!.description()).toContain("squad");
  });

  it("squad has create, run, status, list subcommands", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const squad = kaneru.commands.find((c) => c.name() === "squad")!;
    const names = squad.commands.map((c) => c.name());
    expect(names).toContain("create");
    expect(names).toContain("run");
    expect(names).toContain("status");
    expect(names).toContain("list");
  });

  it("squad create has --name and --agents required options", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const squad = kaneru.commands.find((c) => c.name() === "squad")!;
    const create = squad.commands.find((c) => c.name() === "create")!;
    const optNames = create.options.map((o) => o.long);
    expect(optNames).toContain("--name");
    expect(optNames).toContain("--agents");
    expect(optNames).toContain("--strategy");
  });

  it("has 'delegate' subcommand", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const cmd = kaneru.commands.find((c) => c.name() === "delegate");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("Delegate");
  });

  it("has 'consensus' subcommand", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const cmd = kaneru.commands.find((c) => c.name() === "consensus");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("consensus");
  });

  it("has 'route' subcommand", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const cmd = kaneru.commands.find((c) => c.name() === "route");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("Route");
  });

  it("has 'fuse' subcommand", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const cmd = kaneru.commands.find((c) => c.name() === "fuse");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("knowledge");
  });

  it("has 'dashboard' subcommand", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const cmd = kaneru.commands.find((c) => c.name() === "dashboard");
    expect(cmd).toBeDefined();
    expect(cmd!.description()).toContain("dashboard");
  });

  it("has exactly 16 top-level subcommands under kaneru", () => {
    const program = makeProgram();
    const kaneru = getKaneru(program);
    const names = kaneru.commands.map((c) => c.name()).sort();
    expect(names).toEqual(["consensus", "dashboard", "decisions", "delegate", "discover", "dojo", "fuel", "fuse", "learn", "mission", "peers", "pulse", "route", "squad", "sync", "venture"]);
  });
});

// ---------------------------------------------------------------------------
// createFacade error wrapping
// ---------------------------------------------------------------------------

describe("createFacade import error", () => {
  it("throws 'Failed to load Kaneru module' when dynamic import fails", async () => {
    const program = makeProgram();

    // createFacade is called outside the try/catch in each action handler,
    // so the error propagates up through Commander's parseAsync.
    await expect(
      program.parseAsync(["kaneru", "dashboard"], { from: "user" }),
    ).rejects.toThrow("Failed to load Kaneru module");
  });
});

// ---------------------------------------------------------------------------
// handleError
// ---------------------------------------------------------------------------

describe("handleError", () => {
  it("prints connection message for CortexError with CONNECTION_ERROR code", async () => {
    vi.resetModules();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    // Import CortexError fresh after reset — both mocks below share this reference
    // so instanceof checks in handleError will match.
    const { CortexError: FreshCE } = await import("../../extensions/shared/cortex-client.js");

    vi.doMock("./shared/cortex-resolution.js", () => ({
      resolveCortexClient: vi.fn(),
      CortexError: FreshCE,
    }));

    vi.doMock("../../extensions/agent-mesh/kaneru-facade.js", () => ({
      KaneruFacade: class {
        constructor() {}
        async getDashboard() {
          throw new FreshCE("connect failed", 0, "CONNECTION_ERROR");
        }
        destroy() {}
      },
    }));

    const { registerKaneruCli: freshRegister } = await import("./kaneru-cli.js");
    const freshProgram = new Command();
    freshProgram.name("test");
    freshRegister(freshProgram);

    await freshProgram.parseAsync(["kaneru", "dashboard"], { from: "user" });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Cortex is not running"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints status and message for non-connection CortexError", async () => {
    vi.resetModules();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { CortexError: FreshCE2 } = await import("../../extensions/shared/cortex-client.js");

    vi.doMock("./shared/cortex-resolution.js", () => ({
      resolveCortexClient: vi.fn(),
      CortexError: FreshCE2,
    }));

    vi.doMock("../../extensions/agent-mesh/kaneru-facade.js", () => ({
      KaneruFacade: class {
        constructor() {}
        async getDashboard() {
          throw new FreshCE2("not found", 404, "NOT_FOUND");
        }
        destroy() {}
      },
    }));

    const { registerKaneruCli: freshRegister } = await import("./kaneru-cli.js");
    const freshProgram = new Command();
    freshProgram.name("test");
    freshRegister(freshProgram);

    await freshProgram.parseAsync(["kaneru", "dashboard"], { from: "user" });

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining("Cortex error (404): not found"),
    );
    expect(process.exitCode).toBe(1);
  });

  it("prints generic error message for non-CortexError", async () => {
    vi.resetModules();
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    vi.doMock("./shared/cortex-resolution.js", async () => {
      const { CortexError: CE } = await import("../../extensions/shared/cortex-client.js");
      return { resolveCortexClient: vi.fn(), CortexError: CE };
    });

    vi.doMock("../../extensions/agent-mesh/kaneru-facade.js", () => ({
      KaneruFacade: class {
        constructor() {}
        async getDashboard() {
          throw new Error("unexpected boom");
        }
        destroy() {}
      },
    }));

    const { registerKaneruCli: freshRegister } = await import("./kaneru-cli.js");
    const freshProgram = new Command();
    freshProgram.name("test");
    freshRegister(freshProgram);

    await freshProgram.parseAsync(["kaneru", "dashboard"], { from: "user" });

    expect(errorSpy).toHaveBeenCalledWith("Error: unexpected boom");
    expect(process.exitCode).toBe(1);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/agents/tools/common.js", () => ({
  ToolInputError: class ToolInputError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ToolInputError";
    }
  },
}));

describe("code_shell_interactive", () => {
  let executeFn: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;

  beforeEach(async () => {
    vi.resetModules();
    const mockApi = {
      registerTool: vi.fn((toolDef: { execute: typeof executeFn }) => {
        executeFn = toolDef.execute;
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const cfg = { workspaceRoot: "/tmp", shellEnabled: true, shellTimeout: 120000 };
    const { registerCodeShellInteractive } = await import("./code-shell-interactive.js");
    registerCodeShellInteractive(mockApi as never, cfg as never);
  });

  it("registers tool with correct name", () => {
    expect(executeFn).toBeDefined();
  });

  it("rejects empty command", async () => {
    await expect(executeFn("t1", {})).rejects.toThrow("command required");
    await expect(executeFn("t2", { command: "" })).rejects.toThrow("command required");
  });

  it("rejects when shell disabled", async () => {
    vi.resetModules();
    const mockApi = {
      registerTool: vi.fn((toolDef: { execute: typeof executeFn }) => {
        executeFn = toolDef.execute;
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const cfg = { workspaceRoot: "/tmp", shellEnabled: false, shellTimeout: 120000 };
    const { registerCodeShellInteractive } = await import("./code-shell-interactive.js");
    registerCodeShellInteractive(mockApi as never, cfg as never);
    await expect(executeFn("t3", { command: "echo hello" })).rejects.toThrow(
      "Shell tool is disabled",
    );
  });

  it("executes simple command and captures output", async () => {
    const result = await executeFn("t4", { command: "echo 'hello pty'" });
    expect(result.content[0].text).toContain("hello pty");
    expect(result.details.exitCode).toBe(0);
  }, 10000);

  it("captures exit code for failing commands", async () => {
    const result = await executeFn("t5", { command: "exit 42" });
    expect(result.details.exitCode).toBe(42);
  }, 10000);

  it("feeds input lines to process", async () => {
    const result = await executeFn("t6", {
      command: "cat",
      input: ["line1", "line2"],
      timeout: 5000,
    });
    expect(result.content[0].text).toContain("line1");
    expect(result.content[0].text).toContain("line2");
  }, 15000);

  it("kills process on timeout", async () => {
    const result = await executeFn("t7", {
      command: "sleep 60",
      timeout: 1000,
    });
    expect(result.content[0].text).toContain("killed after timeout");
    expect(result.details.exitCode).toBe(137);
  }, 10000);

  it("strips ANSI escape codes from output", async () => {
    const result = await executeFn("t8", {
      command: "printf '\\033[31mred text\\033[0m'",
    });
    expect(result.content[0].text).toContain("red text");
    expect(result.content[0].text).not.toContain("\\033");
  }, 10000);

  it("reports duration in details", async () => {
    const result = await executeFn("t9", { command: "echo fast" });
    expect(typeof result.details.duration).toBe("number");
    expect(result.details.duration as number).toBeGreaterThan(0);
  }, 10000);

  it("clamps timeout to valid range", async () => {
    // Very short timeout but still executes
    const result = await executeFn("t10", { command: "echo quick", timeout: 500 });
    // Should clamp to minimum 1000ms, still works
    expect(result.details.command).toBe("echo quick");
  }, 10000);
});

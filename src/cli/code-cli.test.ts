import { Command } from "commander";
import { describe, expect, it, vi } from "vitest";

const { runTui } = vi.hoisted(() => ({ runTui: vi.fn() }));

vi.mock("../tui/tui.js", () => ({ runTui }));
vi.mock("../terminal/links.js", () => ({ formatDocsLink: (p: string) => p }));
vi.mock("../terminal/theme.js", () => ({ theme: { muted: (s: string) => s } }));

import { registerCodeCli } from "./code-cli.js";

describe("code cli", () => {
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

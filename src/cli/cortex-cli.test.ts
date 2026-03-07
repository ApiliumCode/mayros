/**
 * Tests for the `mayros cortex` CLI subcommand.
 *
 * Validates:
 * - Registration as a subcli with correct name and subcommands
 * - Status and reconnect subcommand definitions
 */

import { describe, it, expect, vi } from "vitest";
import { Command } from "commander";
import { registerCortexCli } from "./cortex-cli.js";

describe("cortex CLI registration", () => {
  it("registers 'cortex' command with subcommands", () => {
    const program = new Command();
    registerCortexCli(program);

    const cortex = program.commands.find((c) => c.name() === "cortex");
    expect(cortex).toBeDefined();
    expect(cortex!.description()).toBe("Cortex sidecar — status, reconnect, and diagnostics");
  });

  it("has status subcommand", () => {
    const program = new Command();
    registerCortexCli(program);

    const cortex = program.commands.find((c) => c.name() === "cortex");
    const status = cortex?.commands.find((c) => c.name() === "status");
    expect(status).toBeDefined();
    expect(status!.description()).toContain("status");
  });

  it("has reconnect subcommand", () => {
    const program = new Command();
    registerCortexCli(program);

    const cortex = program.commands.find((c) => c.name() === "cortex");
    const reconnect = cortex?.commands.find((c) => c.name() === "reconnect");
    expect(reconnect).toBeDefined();
    expect(reconnect!.description()).toContain("restart");
  });

  it("accepts cortex-host option", () => {
    const program = new Command();
    registerCortexCli(program);

    const cortex = program.commands.find((c) => c.name() === "cortex");
    const hostOption = cortex?.options.find((o) => o.long === "--cortex-host");
    expect(hostOption).toBeDefined();
  });

  it("accepts cortex-port option", () => {
    const program = new Command();
    registerCortexCli(program);

    const cortex = program.commands.find((c) => c.name() === "cortex");
    const portOption = cortex?.options.find((o) => o.long === "--cortex-port");
    expect(portOption).toBeDefined();
  });

  it("registers as subcommand with correct name in subcli entries", async () => {
    const { getSubCliEntries } = await import("./program/register.subclis.js");
    const entries = getSubCliEntries();
    const cortexEntry = entries.find((e) => e.name === "cortex");
    expect(cortexEntry).toBeDefined();
    expect(cortexEntry!.hasSubcommands).toBe(true);
    expect(cortexEntry!.description).toContain("Cortex");
  });
});

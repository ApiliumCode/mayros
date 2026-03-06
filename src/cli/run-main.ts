import process from "node:process";
import { fileURLToPath } from "node:url";
import { loadDotEnv } from "../infra/dotenv.js";
import { normalizeEnv } from "../infra/env.js";
import { formatUncaughtError } from "../infra/errors.js";
import { isMainModule } from "../infra/is-main.js";
import { ensureMayrosCliOnPath } from "../infra/path-env.js";
import { assertSupportedRuntime } from "../infra/runtime-guard.js";
import { installUnhandledRejectionHandler } from "../infra/unhandled-rejections.js";
import { enableConsoleCapture } from "../logging.js";
import {
  getCommandPath,
  getFlagValue,
  getPositiveIntFlagValue,
  getPrimaryCommand,
  hasFlag,
  hasHelpOrVersion,
} from "./argv.js";
import { tryRouteCli } from "./route.js";
import { normalizeWindowsArgv } from "./windows-argv.js";

/**
 * Determines the default command when no subcommand is provided.
 * Returns "onboard" if the user has never completed onboarding, otherwise "code".
 */
export function resolveDefaultCommand(snapshot: {
  exists: boolean;
  config?: { wizard?: { lastRunAt?: string } };
}): "onboard" | "code" {
  const isOnboarded = snapshot.exists && Boolean(snapshot.config?.wizard?.lastRunAt);
  return isOnboarded ? "code" : "onboard";
}

export function rewriteUpdateFlagArgv(argv: string[]): string[] {
  const index = argv.indexOf("--update");
  if (index === -1) {
    return argv;
  }

  const next = [...argv];
  next.splice(index, 1, "update");
  return next;
}

export function shouldRegisterPrimarySubcommand(argv: string[]): boolean {
  return !hasHelpOrVersion(argv);
}

export function shouldSkipPluginCommandRegistration(params: {
  argv: string[];
  primary: string | null;
  hasBuiltinPrimary: boolean;
}): boolean {
  if (params.hasBuiltinPrimary) {
    return true;
  }
  if (!params.primary) {
    return hasHelpOrVersion(params.argv);
  }
  return false;
}

export function shouldEnsureCliPath(argv: string[]): boolean {
  if (hasHelpOrVersion(argv)) {
    return false;
  }
  const [primary, secondary] = getCommandPath(argv, 2);
  if (!primary) {
    return true;
  }
  if (primary === "status" || primary === "health" || primary === "sessions") {
    return false;
  }
  if (primary === "config" && (secondary === "get" || secondary === "unset")) {
    return false;
  }
  if (primary === "models" && (secondary === "list" || secondary === "status")) {
    return false;
  }
  return true;
}

export async function runCli(argv: string[] = process.argv) {
  const normalizedArgv = normalizeWindowsArgv(argv);
  loadDotEnv({ quiet: true });
  normalizeEnv();
  if (shouldEnsureCliPath(normalizedArgv)) {
    ensureMayrosCliOnPath();
  }

  // Enforce the minimum supported runtime before doing any work.
  assertSupportedRuntime();

  // Headless mode: -p / --prompt bypasses TUI and Commander entirely.
  const promptFlagValue =
    getFlagValue(normalizedArgv, "-p") ?? getFlagValue(normalizedArgv, "--prompt");
  if (promptFlagValue !== undefined) {
    const { runHeadless } = await import("./headless-cli.js");

    // Resolve --output-format, with --json as backward-compat shorthand
    const outputFormatRaw = getFlagValue(normalizedArgv, "--output-format") ?? undefined;
    const outputFormat: "text" | "json" | "stream-json" =
      outputFormatRaw === "json" || outputFormatRaw === "stream-json"
        ? outputFormatRaw
        : hasFlag(normalizedArgv, "--json")
          ? "json"
          : outputFormatRaw === "text"
            ? "text"
            : "text";

    // Resolve --model with alias support
    const modelRaw = getFlagValue(normalizedArgv, "--model") ?? undefined;
    let model: string | undefined;
    if (modelRaw) {
      const { resolveModelAlias } = await import("../models/model-aliases.js");
      model = resolveModelAlias(modelRaw);
    }

    await runHeadless({
      prompt: promptFlagValue ?? "",
      json: hasFlag(normalizedArgv, "--json"),
      outputFormat,
      session: getFlagValue(normalizedArgv, "--session") ?? undefined,
      url: getFlagValue(normalizedArgv, "--url") ?? undefined,
      token: getFlagValue(normalizedArgv, "--token") ?? undefined,
      password: getFlagValue(normalizedArgv, "--password") ?? undefined,
      thinking: getFlagValue(normalizedArgv, "--thinking") ?? undefined,
      deliver: hasFlag(normalizedArgv, "--deliver"),
      model,
      maxTurns: getPositiveIntFlagValue(normalizedArgv, "--max-turns") ?? undefined,
      maxBudgetUsd: parseBudgetFlag(getFlagValue(normalizedArgv, "--max-budget-usd")),
      systemPrompt: getFlagValue(normalizedArgv, "--system-prompt") ?? undefined,
      appendSystemPrompt: getFlagValue(normalizedArgv, "--append-system-prompt") ?? undefined,
      tools: getFlagValue(normalizedArgv, "--tools") ?? undefined,
      jsonSchema: getFlagValue(normalizedArgv, "--json-schema") ?? undefined,
    });
    return;
  }

  // Continue last session: -c / --continue bypasses Commander and resumes the latest session.
  if (hasFlag(normalizedArgv, "-c") || hasFlag(normalizedArgv, "--continue")) {
    enableConsoleCapture();

    const { buildProgram } = await import("./program.js");
    const program = buildProgram(normalizedArgv);
    const { registerCodeCli } = await import("./code-cli.js");
    registerCodeCli(program);
    await program.parseAsync([
      ...normalizedArgv.slice(0, 2),
      "code",
      "--continue",
      ...normalizedArgv.slice(2).filter((a) => a !== "-c" && a !== "--continue"),
    ]);
    return;
  }

  if (await tryRouteCli(normalizedArgv)) {
    return;
  }

  // Capture all console output into structured logs while keeping stdout/stderr behavior.
  enableConsoleCapture();

  const { buildProgram } = await import("./program.js");
  const program = buildProgram(normalizedArgv);

  // Global error handlers to prevent silent crashes from unhandled rejections/exceptions.
  // These log the error and exit gracefully instead of crashing without trace.
  installUnhandledRejectionHandler();

  process.on("uncaughtException", (error) => {
    const msg = `[mayros] Uncaught exception: ${formatUncaughtError(error)}\n`;
    process.stderr.write(msg, () => {
      process.exit(1);
    });
  });

  const parseArgv = rewriteUpdateFlagArgv(normalizedArgv);
  // Register the primary command (builtin or subcli) so help and command parsing
  // are correct even with lazy command registration.
  const primary = getPrimaryCommand(parseArgv);

  // No subcommand → first-run gate: onboard if needed, otherwise interactive session
  if (!primary && !hasHelpOrVersion(parseArgv)) {
    const { readConfigFileSnapshot } = await import("../config/config.js");
    const snapshot = await readConfigFileSnapshot();
    const defaultCmd = resolveDefaultCommand(snapshot);

    if (defaultCmd === "onboard") {
      const { registerOnboardCommand } = await import("./program/register.onboard.js");
      registerOnboardCommand(program);
      await program.parseAsync([...parseArgv.slice(0, 2), "onboard", ...parseArgv.slice(2)]);
      return;
    }

    const { registerCodeCli } = await import("./code-cli.js");
    registerCodeCli(program);
    await program.parseAsync([...parseArgv.slice(0, 2), "code", ...parseArgv.slice(2)]);
    return;
  }
  if (primary && shouldRegisterPrimarySubcommand(parseArgv)) {
    const { getProgramContext } = await import("./program/program-context.js");
    const ctx = getProgramContext(program);
    if (ctx) {
      const { registerCoreCliByName } = await import("./program/command-registry.js");
      await registerCoreCliByName(program, ctx, primary, parseArgv);
    }
    const { registerSubCliByName } = await import("./program/register.subclis.js");
    await registerSubCliByName(program, primary);
  }

  const hasBuiltinPrimary =
    primary !== null && program.commands.some((command) => command.name() === primary);
  const shouldSkipPluginRegistration = shouldSkipPluginCommandRegistration({
    argv: parseArgv,
    primary,
    hasBuiltinPrimary,
  });
  if (!shouldSkipPluginRegistration) {
    // Register plugin CLI commands before parsing
    const { registerPluginCliCommands } = await import("../plugins/cli.js");
    const { loadConfig } = await import("../config/config.js");
    registerPluginCliCommands(program, loadConfig());
  }

  await program.parseAsync(parseArgv);
}

export function isCliMainModule(): boolean {
  return isMainModule({ currentFile: fileURLToPath(import.meta.url) });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function parseBudgetFlag(raw: string | null | undefined): number | undefined {
  if (raw === null || raw === undefined) return undefined;
  const parsed = Number.parseFloat(raw);
  if (Number.isNaN(parsed) || parsed <= 0) return undefined;
  return parsed;
}

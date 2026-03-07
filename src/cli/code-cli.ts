import fs from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { resolveConfigPath, resolveStateDir } from "../config/paths.js";
import { defaultRuntime } from "../runtime.js";
import { formatDocsLink } from "../terminal/links.js";
import { theme } from "../terminal/theme.js";
import { runTui } from "../tui/tui.js";
import { parseTimeoutMs } from "./parse-timeout.js";

export function registerCodeCli(program: Command) {
  program
    .command("code")
    .description("Start interactive coding session")
    .option("--url <url>", "Gateway WebSocket URL (defaults to gateway.remote.url when configured)")
    .option("--token <token>", "Gateway token (if required)")
    .option("--password <password>", "Gateway password (if required)")
    .option("--session <key>", 'Session key (default: "main", or "global" when scope is global)')
    .option("--deliver", "Deliver assistant replies", false)
    .option("--thinking <level>", "Thinking level override")
    .option("--message <text>", "Send an initial message after connecting")
    .option("--timeout-ms <ms>", "Agent timeout in ms (defaults to agents.defaults.timeoutSeconds)")
    .option("--history-limit <n>", "History entries to load", "200")
    .option("--clean", "Start with a blank chat (session history is preserved)", false)
    .option("--continue", "Continue the most recent session", false)
    .option("--model <name>", "Model identifier or alias (e.g. sonnet, opus, gpt4o)")
    .option("--system-prompt <text>", "Override the system prompt")
    .option("--append-system-prompt <text>", "Append text to the system prompt")
    .option("--fork-session", "Fork the session on resume (creates a new session branch)", false)
    .addHelpText(
      "after",
      () =>
        `\n${theme.muted("Docs:")} ${formatDocsLink("/cli/code", "apilium.com/us/doc/mayros/cli/code")}\n`,
    )
    .action(async (opts) => {
      try {
        const timeoutMs = parseTimeoutMs(opts.timeoutMs);
        if (opts.timeoutMs !== undefined && timeoutMs === undefined) {
          defaultRuntime.error(
            `warning: invalid --timeout-ms "${String(opts.timeoutMs)}"; ignoring`,
          );
        }

        // Zero-config setup redirect: run onboard wizard if never completed.
        const { readConfigFileSnapshot } = await import("../config/config.js");
        const snapshot = await readConfigFileSnapshot();
        const isOnboarded = snapshot.exists && Boolean(snapshot.config?.wizard?.lastRunAt);

        if (!isOnboarded) {
          defaultRuntime.log(
            theme.accent("Welcome to Mayros!") +
              " " +
              theme.muted("Let's set things up before your first session."),
          );
          const { onboardCommand } = await import("../commands/onboard.js");
          await onboardCommand({}, defaultRuntime);
          const postSnapshot = await readConfigFileSnapshot();
          const onboardCompleted =
            postSnapshot.exists && Boolean(postSnapshot.config?.wizard?.lastRunAt);
          if (!onboardCompleted) {
            defaultRuntime.log(
              theme.muted("Setup not completed. Run ") +
                theme.accent("`mayros onboard`") +
                theme.muted(" when ready."),
            );
            return;
          }
          // Onboarding may have already launched the TUI (hatch flow).
          // If the user passed --clean or no explicit flags, just clear and proceed.
          // Clear screen after onboarding so the TUI starts clean.
          process.stdout.write("\x1b[2J\x1b[H");
        }

        const stateDir = resolveStateDir();
        const hasIdentity = fs.existsSync(path.join(stateDir, "identity", "device.json"));
        const hasConfig = fs.existsSync(resolveConfigPath());
        if (!hasIdentity && !hasConfig) {
          defaultRuntime.log(
            `${theme.muted("Welcome to Mayros.")} Run ${theme.accent("`mayros onboard`")} to set up, or continue to connect to a running gateway.`,
          );
        } else if (!hasIdentity) {
          defaultRuntime.log(theme.muted("First connection from this device."));
        }

        // Resolve session key
        let sessionKey = opts.session as string | undefined;
        if (opts.continue && !sessionKey) {
          sessionKey = "__continue__";
        }

        // Fork session: derive a new UUID-based key from the original
        if (opts.forkSession && sessionKey) {
          const { randomUUID } = await import("node:crypto");
          const base = sessionKey === "__continue__" ? "fork" : sessionKey;
          sessionKey = `${base}-${randomUUID().slice(0, 8)}`;
        }

        // Resolve model alias
        let model: string | undefined;
        if (opts.model) {
          const { resolveModelAlias } = await import("../models/model-aliases.js");
          model = resolveModelAlias(opts.model as string);
        }

        // Build initial message with system prompt overrides
        let initialMessage = opts.message as string | undefined;
        if (opts.systemPrompt || opts.appendSystemPrompt) {
          const prefix = opts.systemPrompt ? `[System: ${opts.systemPrompt as string}]\n\n` : "";
          const suffix = opts.appendSystemPrompt
            ? `\n\n[System: ${opts.appendSystemPrompt as string}]`
            : "";
          if (initialMessage) {
            initialMessage = `${prefix}${initialMessage}${suffix}`;
          }
          // If no message, system prompt overrides will be applied when TUI sends first message.
          // We store them so TUI can access them if needed.
        }

        // Ensure gateway and Cortex are running before launching the TUI
        const { ensureServicesRunning } = await import("../infra/ensure-services.js");
        const freshSnapshot = await readConfigFileSnapshot();
        const ensureConfig = freshSnapshot.valid ? freshSnapshot.config : {};
        const services = await ensureServicesRunning({
          config: ensureConfig,
          log: (msg) => defaultRuntime.log(theme.muted(msg)),
        });

        if (!services.gateway.ok) {
          defaultRuntime.error(
            theme.warn("Gateway could not be started.") +
              (services.gateway.detail ? " " + theme.muted(services.gateway.detail) : ""),
          );
          return;
        }

        if (!services.cortex.ok && services.cortex.detail) {
          defaultRuntime.log(theme.muted("Cortex: " + services.cortex.detail));
        }

        const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);
        await runTui({
          url: opts.url as string | undefined,
          token: opts.token as string | undefined,
          password: opts.password as string | undefined,
          session: sessionKey,
          deliver: Boolean(opts.deliver),
          thinking: opts.thinking as string | undefined,
          message: initialMessage,
          timeoutMs,
          historyLimit: Number.isNaN(historyLimit) ? undefined : historyLimit,
          cleanStart: true,
          ...(model ? { model } : {}),
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}

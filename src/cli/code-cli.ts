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
        const historyLimit = Number.parseInt(String(opts.historyLimit ?? "200"), 10);
        await runTui({
          url: opts.url as string | undefined,
          token: opts.token as string | undefined,
          password: opts.password as string | undefined,
          session: opts.session as string | undefined,
          deliver: Boolean(opts.deliver),
          thinking: opts.thinking as string | undefined,
          message: opts.message as string | undefined,
          timeoutMs,
          historyLimit: Number.isNaN(historyLimit) ? undefined : historyLimit,
          cleanStart: true,
        });
      } catch (err) {
        defaultRuntime.error(String(err));
        defaultRuntime.exit(1);
      }
    });
}

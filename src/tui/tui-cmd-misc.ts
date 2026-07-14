/**
 * Miscellaneous command group.
 * Commands: help, status, undo, abort, settings, bug, init, exit, quit,
 *           onboard, batch, vim, compact, default (markdown/fallback)
 */

import { execSync } from "node:child_process";
import { expandMarkdownCommand, findMarkdownCommand } from "../commands/markdown-commands.js";
import { helpText } from "./commands.js";
import { undo, listUndoEntries } from "./undo-manager.js";
import { compactMessages } from "./compact-handler.js";
import { formatStatusSummary } from "./tui-status-summary.js";
import type { GatewayStatusSummary } from "./tui-types.js";
import type { CommandGroupHandler } from "./tui-cmd-types.js";

export const miscCommands: CommandGroupHandler = async (ctx, name, args, raw) => {
  const { client, chatLog, tui, state, loadHistory, abortActive } = ctx;

  switch (name) {
    case "help":
      chatLog.addSystem(
        helpText({
          provider: state.sessionInfo.modelProvider,
          model: state.sessionInfo.model,
        }),
      );
      return true;
    case "status":
      try {
        const status = await client.getStatus();
        if (typeof status === "string") {
          chatLog.addSystem(status);
          return true;
        }
        if (status && typeof status === "object") {
          const lines = formatStatusSummary(status as GatewayStatusSummary);
          for (const line of lines) {
            chatLog.addSystem(line);
          }
          return true;
        }
        chatLog.addSystem("status: unknown response");
      } catch (err) {
        chatLog.addSystem(`status failed: ${String(err)}`);
      }
      return true;
    case "vim":
      chatLog.addSystem("vim mode is not available in this build");
      return true;
    case "undo": {
      const cwd = process.cwd();
      if (args === "list") {
        const entries = listUndoEntries(cwd);
        if (entries.length === 0) {
          chatLog.addSystem("No undo points available.");
        } else {
          const lines = entries.map(
            (e) => `  [${e.index}] ${e.label}${e.timestamp ? ` (${e.timestamp})` : ""}`,
          );
          chatLog.addSystem(`Undo points:\n${lines.join("\n")}`);
        }
      } else {
        const result = undo(cwd);
        chatLog.addSystem(result.message);
      }
      return true;
    }
    case "abort":
      await abortActive();
      return true;
    case "settings":
      ctx.openSettings();
      return true;
    case "bug": {
      const url = "https://github.com/ApiliumCode/mayros/issues/new";
      try {
        const openCmd =
          process.platform === "darwin"
            ? "open"
            : process.platform === "win32"
              ? "start"
              : "xdg-open";
        execSync(`${openCmd} ${url}`, { stdio: "ignore" });
        chatLog.addSystem(`Opened ${url}`);
      } catch {
        chatLog.addSystem(`Report bugs at: ${url}`);
      }
      return true;
    }
    case "init": {
      try {
        const fs = await import("node:fs");
        const path = await import("node:path");
        const configPath = path.join(process.cwd(), "mayros.json");
        if (fs.existsSync(configPath)) {
          chatLog.addSystem("mayros.json already exists in this directory");
          return true;
        }
        const pkg = fs.existsSync(path.join(process.cwd(), "package.json"))
          ? JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"))
          : null;
        const projectName = pkg?.name ?? path.basename(process.cwd());
        const config = {
          $schema: "https://apilium.com/schemas/mayros/v1.json",
          meta: { lastTouchedVersion: "0.1.5" },
          ui: { theme: "dark" },
          agents: { defaults: { agentId: projectName } },
        };
        fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
        chatLog.addSystem(`Created ${configPath}`);
      } catch (err) {
        chatLog.addSystem(`init failed: ${String(err)}`);
      }
      return true;
    }
    case "exit":
    case "quit":
      client.stop();
      tui.stop();
      process.exit(0);
      return true;
    case "compact": {
      try {
        const history = (await client.loadHistory({
          sessionKey: state.currentSessionKey,
        })) as { messages?: Array<Record<string, unknown>> };
        const rawMessages = history?.messages ?? [];
        if (rawMessages.length === 0) {
          chatLog.addSystem("nothing to compact");
          return true;
        }
        const mapped = rawMessages
          .filter(
            (m) =>
              typeof m === "object" && m !== null && (m.role === "user" || m.role === "assistant"),
          )
          .map((m) => ({
            role: String(m.role ?? "user"),
            content: typeof m.content === "string" ? m.content : "",
          }));
        const compactResult = await compactMessages({
          messages: mapped,
          sessionKey: state.currentSessionKey,
        });
        // Send the summary back to the gateway: truncate the transcript and
        // inject the condensed summary as a system message so the agent
        // retains the extracted context going forward.
        await client.compactSession({
          key: state.currentSessionKey,
          summaryMessage: compactResult.summary,
        });
        chatLog.addSystem(
          `Compacted ${compactResult.originalCount} messages \u2192 summary (${compactResult.knowledgeItems} knowledge items extracted)`,
        );
        await loadHistory();
      } catch (err) {
        chatLog.addSystem(`compact failed: ${String(err)}`);
      }
      return true;
    }
    case "batch": {
      if (!args) {
        chatLog.addSystem("usage: /batch <file> [--concurrency N] [--thinking <level>]");
        return true;
      }
      // Parse optional flags from args: <file> [--concurrency N] [--thinking level]
      const batchArgParts = args.split(/\s+/);
      const batchFile = batchArgParts[0] ?? "";
      const batchExtraArgs = batchArgParts.slice(1).join(" ");

      // Verify file exists before attempting to run
      try {
        const fs = await import("node:fs");
        if (!fs.existsSync(batchFile)) {
          chatLog.addSystem(`batch: file not found: ${batchFile}`);
          return true;
        }
      } catch {
        chatLog.addSystem(`batch: cannot check file: ${batchFile}`);
        return true;
      }

      chatLog.addSystem(
        `Running batch: ${batchFile}${batchExtraArgs ? " " + batchExtraArgs : ""}...`,
      );
      tui.requestRender();

      try {
        const { parseInputFile } = await import("../cli/batch-cli.js");
        const fs = await import("node:fs");
        const content = fs.readFileSync(batchFile, "utf-8");
        const items = parseInputFile(content);
        if (items.length === 0) {
          chatLog.addSystem("batch: no valid prompts found in file");
          return true;
        }

        chatLog.addSystem(`batch: processing ${items.length} prompt(s) sequentially...`);
        tui.requestRender();

        let completed = 0;
        const errors: string[] = [];
        for (const item of items) {
          try {
            chatLog.addSystem(
              `batch [${completed + 1}/${items.length}]: ${item.prompt.slice(0, 60)}${item.prompt.length > 60 ? "…" : ""}`,
            );
            tui.requestRender();
            await ctx.sendMessage(item.context ? `${item.context}\n\n${item.prompt}` : item.prompt);
            completed++;
          } catch (err) {
            const msg = `batch [${completed + 1}/${items.length}] error: ${String(err)}`;
            chatLog.addSystem(msg);
            errors.push(msg);
            completed++;
          }
        }
        chatLog.addSystem(`batch done: ${completed - errors.length} ok, ${errors.length} errors`);
      } catch (err) {
        chatLog.addSystem(`batch failed: ${String(err)}`);
      }
      return true;
    }
    case "onboard": {
      try {
        chatLog.addSystem("Launching onboarding wizard — stopping TUI...");
        tui.requestRender();
        client.stop();
        tui.stop();
        const { onboardCommand } = await import("../commands/onboard.js");
        const { defaultRuntime } = await import("../runtime.js");
        await onboardCommand({}, defaultRuntime);
        process.exit(0);
      } catch (err) {
        chatLog.addSystem(`onboard failed: ${String(err)}`);
      }
      return true;
    }
    default: {
      // Check for user-defined markdown commands before sending raw
      const mdCmd = findMarkdownCommand(name);
      if (mdCmd) {
        const expanded = expandMarkdownCommand(mdCmd, args);
        await ctx.sendMessage(expanded);
      } else {
        await ctx.sendMessage(raw);
      }
      return true;
    }
  }
};

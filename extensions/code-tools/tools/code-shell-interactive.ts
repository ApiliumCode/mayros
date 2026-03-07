/**
 * code_shell_interactive tool — Execute interactive commands via PTY.
 *
 * Uses node-pty for commands that require a terminal (vim, git rebase -i, etc.).
 * Input lines can be fed sequentially.
 */

import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";

// ANSI escape code stripping
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .replace(/\x1b\][^\x07]*\x07/g, "") // OSC sequences
    .replace(/\x1b[()][AB012]/g, "") // Character set
    .replace(/\x1b[[()#;?]*[0-9;]*[a-zA-Z]/g, "");
}

export function registerCodeShellInteractive(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_shell_interactive",
      label: "Interactive Shell",
      description:
        "Execute an interactive command in a pseudo-terminal (PTY). Useful for commands that require terminal input like git rebase -i, python REPL, or less. Input lines are fed sequentially.",
      parameters: Type.Object({
        command: Type.String({ description: "Shell command to execute in PTY" }),
        timeout: Type.Optional(
          Type.Number({ description: "Timeout in milliseconds (default: 30000)" }),
        ),
        input: Type.Optional(
          Type.Array(Type.String(), { description: "Lines of input to feed to the process" }),
        ),
      }),
      async execute(_toolCallId, params) {
        if (!cfg.shellEnabled) {
          throw new ToolInputError("Shell tool is disabled in configuration");
        }

        const p = params as { command?: string; timeout?: number; input?: string[] };
        if (typeof p.command !== "string" || !p.command.trim()) {
          throw new ToolInputError("command required");
        }

        const command = p.command.trim();
        const timeout =
          typeof p.timeout === "number"
            ? Math.max(1000, Math.min(Math.trunc(p.timeout), cfg.shellTimeout))
            : 30000;
        const inputLines = Array.isArray(p.input)
          ? p.input.filter((l) => typeof l === "string")
          : [];

        const MAX_OUTPUT = 1024 * 1024; // 1MB

        // Dynamic import node-pty
        let pty: typeof import("@lydell/node-pty");
        try {
          pty = await import("@lydell/node-pty");
        } catch {
          throw new ToolInputError(
            "node-pty is not available. Install @lydell/node-pty for interactive shell support.",
          );
        }

        const startTime = Date.now();
        // Hard cap: the hard timeout must exceed the soft timeout so the soft
        // kill path has a chance to resolve with partial output.  Add a 5s
        // buffer (capped to cfg.shellTimeout) so a hanging PTY never leaks.
        const hardTimeout =
          typeof p.timeout === "number"
            ? Math.min(timeout + 5000, cfg.shellTimeout)
            : Math.min(60000, cfg.shellTimeout);

        return new Promise((resolve, reject) => {
          let output = "";
          let exitCode = -1;
          let exited = false;
          let settled = false;
          let feedTimer: ReturnType<typeof setTimeout> | undefined;

          function settle(fn: () => void) {
            if (settled) return;
            settled = true;
            clearTimeout(hardTimer);
            clearTimeout(timer);
            if (feedTimer) clearTimeout(feedTimer);
            fn();
          }

          // Hard timeout — rejects the promise if the PTY never exits.
          const hardTimer = setTimeout(() => {
            settle(() =>
              reject(
                new Error(
                  `PTY hard timeout after ${hardTimeout}ms: command "${command}" did not exit`,
                ),
              ),
            );
          }, hardTimeout);

          // IPty has kill() but dynamic import resolves to PtyHandle which omits it
          type PtyProc = {
            onData: (cb: (data: string) => void) => void;
            onExit: (cb: (e: { exitCode: number }) => void) => void;
            write: (data: string) => void;
            kill: (signal?: string) => void;
          };
          let proc: PtyProc;
          try {
            const shell = process.env.SHELL ?? "/bin/bash";
            proc = pty.spawn(shell, ["-c", command], {
              name: "xterm-256color",
              cols: 120,
              rows: 40,
              cwd: cfg.workspaceRoot,
              env: { ...process.env, TERM: "xterm-256color" } as Record<string, string>,
            }) as unknown as PtyProc;
          } catch (spawnErr) {
            settle(() =>
              reject(spawnErr instanceof Error ? spawnErr : new Error(String(spawnErr))),
            );
            return;
          }

          // Per-call soft timeout (kills the process, then resolves with partial output).
          const timer = setTimeout(() => {
            if (!exited) {
              try {
                proc.kill();
              } catch {
                /* ignore */
              }
              output += "\n[Process killed after timeout]";
              exitCode = 137;
              settle(finish);
            }
          }, timeout);

          proc.onData((data: string) => {
            if (output.length < MAX_OUTPUT) {
              output += data;
            }
          });

          proc.onExit(({ exitCode: code }) => {
            exited = true;
            exitCode = code;
            settle(finish);
          });

          // Feed input lines with delays
          if (inputLines.length > 0) {
            let lineIdx = 0;
            const feedNext = () => {
              if (lineIdx < inputLines.length && !exited) {
                proc.write(inputLines[lineIdx] + "\n");
                lineIdx++;
                feedTimer = setTimeout(feedNext, 100);
              } else {
                feedTimer = undefined;
              }
            };
            // Start feeding after a small delay for process startup
            feedTimer = setTimeout(feedNext, 200);
          }

          function finish() {
            const duration = Date.now() - startTime;
            const cleanOutput = stripAnsi(output).trim();
            const truncated = output.length >= MAX_OUTPUT;

            const parts: string[] = [];
            if (cleanOutput) {
              parts.push(truncated ? cleanOutput + "\n[Output truncated at 1MB]" : cleanOutput);
            }
            if (exitCode !== 0) {
              parts.push(`[exit code: ${exitCode}]`);
            }

            const text = parts.join("\n\n") || "(no output)";

            resolve({
              content: [{ type: "text" as const, text }],
              details: { command, exitCode, duration },
            });
          }
        });
      },
    },
    { name: "code_shell_interactive" },
  );
}

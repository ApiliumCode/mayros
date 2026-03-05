/**
 * `mayros -p "query"` — Headless (non-interactive) CLI mode.
 *
 * Sends a prompt to the Gateway, streams the response to stdout, and exits.
 * Supports stdin piping, JSON-lines output, and session key override.
 */

import process from "node:process";
import { randomUUID } from "node:crypto";
import {
  GatewayChatClient,
  resolveGatewayConnection,
  type GatewayEvent,
} from "../tui/gateway-chat.js";
import { TuiStreamAssembler } from "../tui/tui-stream-assembler.js";

// ============================================================================
// Types
// ============================================================================

export type HeadlessOptions = {
  prompt: string;
  session?: string;
  json?: boolean;
  url?: string;
  token?: string;
  password?: string;
  thinking?: string;
  timeoutMs?: number;
  deliver?: boolean;
};

// ============================================================================
// Stdin helper
// ============================================================================

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

// ============================================================================
// JSON-lines writer
// ============================================================================

function writeJsonLine(obj: Record<string, unknown>): void {
  process.stdout.write(JSON.stringify(obj) + "\n");
}

// ============================================================================
// Headless runner
// ============================================================================

export async function runHeadless(opts: HeadlessOptions): Promise<void> {
  // 1. Combine prompt + stdin
  const stdinText = await readStdin();
  const prompt = [opts.prompt, stdinText].filter(Boolean).join("\n\n");

  if (!prompt) {
    process.stderr.write("Error: no prompt provided (use -p <text> or pipe via stdin)\n");
    process.exitCode = 1;
    return;
  }

  // 2. Resolve connection
  const connection = resolveGatewayConnection({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  // 3. Create client
  const client = new GatewayChatClient({
    url: connection.url,
    token: connection.token,
    password: connection.password,
  });

  const sessionKey = opts.session ?? `headless-${randomUUID().slice(0, 8)}`;
  const runId = randomUUID();
  const assembler = new TuiStreamAssembler();
  const showThinking = opts.thinking === "on" || opts.thinking === "verbose";
  const timeoutMs = opts.timeoutMs ?? 120_000;

  let resolved = false;

  const result = new Promise<void>((resolve, reject) => {
    let lastOutputLength = 0;

    client.onEvent = (evt: GatewayEvent) => {
      const payload = evt.payload as Record<string, unknown> | undefined;
      if (!payload) return;

      const eventRunId = (payload.runId as string) ?? "";
      if (eventRunId && eventRunId !== runId) return;

      if (evt.event === "chat.delta") {
        const message = payload.message ?? payload;
        const displayText = assembler.ingestDelta(runId, message, showThinking);
        if (displayText !== null) {
          const incremental = displayText.slice(lastOutputLength);
          if (incremental) {
            if (opts.json) {
              writeJsonLine({ type: "delta", text: incremental });
            } else {
              process.stdout.write(incremental);
            }
            lastOutputLength = displayText.length;
          }
        }
      } else if (evt.event === "chat.final") {
        const message = payload.message ?? payload;
        const finalText = assembler.finalize(runId, message, showThinking);
        const remaining = finalText.slice(lastOutputLength);
        if (remaining) {
          if (opts.json) {
            writeJsonLine({ type: "delta", text: remaining });
          } else {
            process.stdout.write(remaining);
          }
        }
        if (opts.json) {
          writeJsonLine({ type: "final", text: finalText });
        } else {
          // Ensure trailing newline
          if (!finalText.endsWith("\n")) {
            process.stdout.write("\n");
          }
        }
        resolved = true;
        resolve();
      } else if (evt.event === "chat.error") {
        const errorText =
          typeof payload.error === "string" ? payload.error : JSON.stringify(payload);
        process.stderr.write(`Error: ${errorText}\n`);
        resolved = true;
        reject(new Error(errorText));
      } else if (evt.event === "chat.aborted") {
        process.stderr.write("Aborted by gateway.\n");
        resolved = true;
        reject(new Error("aborted"));
      }
    };

    client.onDisconnected = (reason: string) => {
      if (!resolved) {
        process.stderr.write(`Disconnected: ${reason}\n`);
        reject(new Error(`disconnected: ${reason}`));
      }
    };
  });

  // 4. Connect + send
  client.start();

  try {
    await client.waitForReady();
  } catch {
    process.stderr.write("Error: could not connect to Gateway\n");
    process.exitCode = 1;
    client.stop();
    return;
  }

  try {
    await client.sendChat({
      sessionKey,
      message: prompt,
      thinking: opts.thinking,
      deliver: opts.deliver,
      runId,
    });
  } catch (err) {
    process.stderr.write(`Error sending chat: ${String(err)}\n`);
    process.exitCode = 1;
    client.stop();
    return;
  }

  // 5. Wait for result or timeout
  const timeout = new Promise<never>((_resolve, reject) => {
    setTimeout(() => {
      reject(new Error("timeout"));
    }, timeoutMs);
  });

  try {
    await Promise.race([result, timeout]);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message === "timeout") {
      process.stderr.write(`Error: timed out after ${timeoutMs}ms\n`);
    }
    process.exitCode = 1;
  } finally {
    client.stop();
  }
}

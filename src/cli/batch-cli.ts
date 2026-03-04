/**
 * `mayros batch` — Batch prompt processing CLI.
 *
 * Process multiple prompts in parallel with configurable concurrency.
 * Input: JSONL file or text file with `---` separators.
 * Output: JSON-lines results streamed to stdout or a file.
 *
 * Subcommands:
 *   run <file> [--concurrency N] [--output file] [--json] [--session <key>] [--thinking <level>]
 */

import type { Command } from "commander";
import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline";
import process from "node:process";
import {
  GatewayChatClient,
  resolveGatewayConnection,
  type GatewayEvent,
} from "../tui/gateway-chat.js";
import { TuiStreamAssembler } from "../tui/tui-stream-assembler.js";

// ============================================================================
// Types
// ============================================================================

export type BatchItem = {
  id: string;
  prompt: string;
  context?: string;
};

export type BatchResult = {
  id: string;
  status: "ok" | "error";
  response?: string;
  error?: string;
  durationMs?: number;
};

type BatchRunOptions = {
  items: BatchItem[];
  concurrency: number;
  sessionKey?: string;
  thinking?: string;
  timeoutMs: number;
  url?: string;
  token?: string;
  password?: string;
  onResult: (result: BatchResult) => void;
};

// ============================================================================
// Input parsing
// ============================================================================

/**
 * Parse a JSONL file into batch items. Each line must be a JSON object
 * with at least a `prompt` field. Missing `id` will be auto-generated.
 */
export function parseJsonlItems(content: string): BatchItem[] {
  const items: BatchItem[] = [];
  const lines = content.split("\n").filter((l) => l.trim());

  for (const line of lines) {
    try {
      const obj = JSON.parse(line) as Record<string, unknown>;
      if (typeof obj.prompt !== "string" || !obj.prompt.trim()) continue;
      items.push({
        id: typeof obj.id === "string" ? obj.id : String(items.length + 1),
        prompt: obj.prompt,
        context: typeof obj.context === "string" ? obj.context : undefined,
      });
    } catch {
      // Skip malformed lines
    }
  }

  return items;
}

/**
 * Parse a plain text file where prompts are separated by `---` lines.
 */
export function parseSeparatedItems(content: string): BatchItem[] {
  const blocks = content
    .split(/^---$/m)
    .map((b) => b.trim())
    .filter(Boolean);

  return blocks.map((block, i) => ({
    id: String(i + 1),
    prompt: block,
  }));
}

/**
 * Read input file and detect format automatically.
 * JSONL if first non-empty line starts with `{`, otherwise `---` separated.
 */
export function parseInputFile(content: string): BatchItem[] {
  const firstLine = content.split("\n").find((l) => l.trim());
  if (firstLine && firstLine.trim().startsWith("{")) {
    return parseJsonlItems(content);
  }
  return parseSeparatedItems(content);
}

/**
 * Read from stdin (pipe mode).
 */
async function readStdinContent(): Promise<string> {
  if (process.stdin.isTTY) return "";
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString("utf8");
}

// ============================================================================
// Batch runner
// ============================================================================

/**
 * Run a single prompt through the gateway and return the result.
 */
async function runSinglePrompt(
  item: BatchItem,
  opts: {
    url: string;
    token?: string;
    password?: string;
    sessionKey: string;
    thinking?: string;
    timeoutMs: number;
  },
): Promise<BatchResult> {
  const start = Date.now();
  const connection = resolveGatewayConnection({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  const client = new GatewayChatClient({
    url: connection.url,
    token: connection.token,
    password: connection.password,
  });

  const runId = randomUUID();
  const assembler = new TuiStreamAssembler();
  const prompt = item.context ? `${item.context}\n\n${item.prompt}` : item.prompt;

  return new Promise<BatchResult>((resolve) => {
    let resolved = false;

    const finish = (result: BatchResult) => {
      if (resolved) return;
      resolved = true;
      client.stop();
      resolve(result);
    };

    client.onEvent = (evt: GatewayEvent) => {
      const payload = evt.payload as Record<string, unknown> | undefined;
      if (!payload) return;

      const eventRunId = (payload.runId as string) ?? "";
      if (eventRunId && eventRunId !== runId) return;

      if (evt.event === "chat.final") {
        const message = payload.message ?? payload;
        const finalText = assembler.finalize(runId, message, false);
        finish({
          id: item.id,
          status: "ok",
          response: finalText,
          durationMs: Date.now() - start,
        });
      } else if (evt.event === "chat.delta") {
        const message = payload.message ?? payload;
        assembler.ingestDelta(runId, message, false);
      } else if (evt.event === "chat.error") {
        const errorText =
          typeof payload.error === "string" ? payload.error : JSON.stringify(payload);
        finish({
          id: item.id,
          status: "error",
          error: errorText,
          durationMs: Date.now() - start,
        });
      } else if (evt.event === "chat.aborted") {
        finish({
          id: item.id,
          status: "error",
          error: "aborted",
          durationMs: Date.now() - start,
        });
      }
    };

    client.onDisconnected = (reason: string) => {
      finish({
        id: item.id,
        status: "error",
        error: `disconnected: ${reason}`,
        durationMs: Date.now() - start,
      });
    };

    // Timeout
    setTimeout(() => {
      finish({
        id: item.id,
        status: "error",
        error: `timeout after ${opts.timeoutMs}ms`,
        durationMs: Date.now() - start,
      });
    }, opts.timeoutMs);

    // Connect and send
    client.start();
    client
      .waitForReady()
      .then(() => {
        client
          .sendChat({
            sessionKey: opts.sessionKey,
            message: prompt,
            thinking: opts.thinking,
            runId,
          })
          .catch((err) => {
            finish({
              id: item.id,
              status: "error",
              error: `send failed: ${String(err)}`,
              durationMs: Date.now() - start,
            });
          });
      })
      .catch((err) => {
        finish({
          id: item.id,
          status: "error",
          error: `connect failed: ${String(err)}`,
          durationMs: Date.now() - start,
        });
      });
  });
}

/**
 * Run a batch of prompts with concurrency control.
 */
export async function runBatch(opts: BatchRunOptions): Promise<BatchResult[]> {
  const results: BatchResult[] = [];
  const { items, concurrency, onResult } = opts;

  const connection = resolveGatewayConnection({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  // Process items with a concurrency pool
  let cursor = 0;

  async function processNext(): Promise<void> {
    while (cursor < items.length) {
      const item = items[cursor++];
      const sessionKey = opts.sessionKey ?? `batch-${item.id}-${randomUUID().slice(0, 8)}`;

      const result = await runSinglePrompt(item, {
        url: connection.url,
        token: connection.token,
        password: connection.password,
        sessionKey,
        thinking: opts.thinking,
        timeoutMs: opts.timeoutMs,
      });

      results.push(result);
      onResult(result);
    }
  }

  // Launch `concurrency` parallel workers
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, () => processNext());
  await Promise.allSettled(workers);

  return results;
}

// ============================================================================
// JSON-lines writer
// ============================================================================

function writeJsonLine(
  obj: Record<string, unknown>,
  stream: NodeJS.WritableStream = process.stdout,
): void {
  stream.write(JSON.stringify(obj) + "\n");
}

// ============================================================================
// CLI Registration
// ============================================================================

export function registerBatchCli(program: Command) {
  const batch = program
    .command("batch")
    .description("Batch prompt processing — run multiple prompts in parallel");

  // ---- run ----

  batch
    .command("run")
    .description("Process a file of prompts in parallel")
    .argument("[file]", "Input file (JSONL or text with --- separators). Use - for stdin.")
    .option("-c, --concurrency <n>", "Max concurrent prompts", "4")
    .option("-o, --output <file>", "Write results to file instead of stdout")
    .option("--json", "Output results as JSON-lines", false)
    .option("--session <key>", "Session key prefix (each item gets unique suffix)")
    .option("--thinking <level>", "Thinking level for all prompts")
    .option("--timeout <ms>", "Per-prompt timeout in milliseconds", "120000")
    .option("--url <url>", "Gateway WebSocket URL")
    .option("--token <token>", "Gateway auth token")
    .option("--password <password>", "Gateway password")
    .action(async (file, opts) => {
      // Read input
      let content: string;

      if (!file || file === "-") {
        content = await readStdinContent();
        if (!content.trim()) {
          console.error("Error: no input provided. Pipe data or specify a file.");
          process.exitCode = 1;
          return;
        }
      } else {
        if (!existsSync(file)) {
          console.error(`Error: file not found: ${file}`);
          process.exitCode = 1;
          return;
        }
        const { readFileSync } = await import("node:fs");
        content = readFileSync(file, "utf-8");
      }

      const items = parseInputFile(content);
      if (items.length === 0) {
        console.error("Error: no valid prompts found in input.");
        process.exitCode = 1;
        return;
      }

      const concurrency = Math.max(1, Math.min(16, Number.parseInt(opts.concurrency, 10) || 4));
      const timeoutMs = Math.max(1000, Number.parseInt(opts.timeout, 10) || 120000);
      const isJson = opts.json || !!opts.output;

      console.error(`Processing ${items.length} prompt(s) with concurrency ${concurrency}...`);

      let completed = 0;
      const total = items.length;

      const results = await runBatch({
        items,
        concurrency,
        sessionKey: opts.session,
        thinking: opts.thinking,
        timeoutMs,
        url: opts.url,
        token: opts.token,
        password: opts.password,
        onResult: (result) => {
          completed++;
          if (isJson && !opts.output) {
            writeJsonLine(result as unknown as Record<string, unknown>);
          }
          const statusIcon = result.status === "ok" ? "✓" : "✗";
          console.error(
            `  [${completed}/${total}] ${statusIcon} ${result.id} (${result.durationMs}ms)`,
          );
        },
      });

      // Write output file if specified
      if (opts.output) {
        const lines = results.map((r) => JSON.stringify(r)).join("\n") + "\n";
        writeFileSync(opts.output, lines, "utf-8");
        console.error(`Results written to ${opts.output}`);
      }

      // Summary
      const okCount = results.filter((r) => r.status === "ok").length;
      const errCount = results.filter((r) => r.status === "error").length;
      console.error(`\nDone: ${okCount} ok, ${errCount} errors`);

      if (errCount > 0) {
        process.exitCode = 1;
      }
    });

  // ---- from (alias for convenience) ----

  batch
    .command("status")
    .description("Show batch processing capabilities")
    .action(() => {
      console.log("Batch processing status:");
      console.log("  Supported input formats: JSONL, text (--- separated)");
      console.log("  Max concurrency: 16");
      console.log("  Default timeout: 120s per prompt");
      console.log("");
      console.log("Usage:");
      console.log("  mayros batch run prompts.jsonl --concurrency 4");
      console.log("  mayros batch run prompts.txt --output results.jsonl");
      console.log('  echo \'{"prompt":"hello"}\' | mayros batch run -');
    });
}

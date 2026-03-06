/**
 * `mayros -p "query"` — Headless (non-interactive) CLI mode.
 *
 * Sends a prompt to the Gateway, streams the response to stdout, and exits.
 * Supports stdin piping, JSON-lines output, session key override, model
 * selection, output format, max turns, budget cap, system prompt overrides,
 * tool restrictions, and JSON schema validation.
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

export type HeadlessOutputFormat = "text" | "json" | "stream-json";

export type HeadlessOptions = {
  prompt: string;
  session?: string;
  /** @deprecated Use `outputFormat` instead. Kept for backward compatibility. */
  json?: boolean;
  outputFormat?: HeadlessOutputFormat;
  url?: string;
  token?: string;
  password?: string;
  thinking?: string;
  timeoutMs?: number;
  deliver?: boolean;
  model?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  tools?: string;
  jsonSchema?: string;
};

// ============================================================================
// Helpers
// ============================================================================

/**
 * Resolve the effective output format. `--json` flag maps to "json" for
 * backward compatibility; explicit `outputFormat` takes precedence.
 */
export function resolveOutputFormat(
  opts: Pick<HeadlessOptions, "json" | "outputFormat">,
): HeadlessOutputFormat {
  if (opts.outputFormat) return opts.outputFormat;
  if (opts.json) return "json";
  return "text";
}

/**
 * Build the final prompt string, prepending or appending system prompt text.
 */
export function buildPromptWithSystemOverrides(
  prompt: string,
  systemPrompt: string | undefined,
  appendSystemPrompt: string | undefined,
): string {
  const parts: string[] = [];
  if (systemPrompt) {
    parts.push(`[System: ${systemPrompt}]`);
  }
  parts.push(prompt);
  if (appendSystemPrompt) {
    parts.push(`[System: ${appendSystemPrompt}]`);
  }
  return parts.join("\n\n");
}

/**
 * Parse a comma-separated tool list into an array of trimmed tool names.
 */
export function parseToolsList(raw: string): string[] {
  return raw
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean);
}

/**
 * Validate a JSON string against a JSON Schema object.
 * Returns `{ valid: true }` or `{ valid: false, error: string }`.
 */
export function validateJsonSchema(
  text: string,
  schemaStr: string,
): { valid: true; parsed: unknown } | { valid: false; error: string } {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { valid: false, error: "Output is not valid JSON" };
  }

  let schema: Record<string, unknown>;
  try {
    schema = JSON.parse(schemaStr) as Record<string, unknown>;
  } catch {
    return { valid: false, error: "Provided JSON schema is not valid JSON" };
  }

  // Basic structural validation: check "type" constraint if present.
  // Full JSON Schema validation would require a library; we do best-effort.
  const schemaType = schema.type as string | undefined;
  if (schemaType) {
    const actualType = Array.isArray(parsed) ? "array" : typeof parsed;
    if (actualType === "number" && schemaType === "integer") {
      if (!Number.isInteger(parsed as number)) {
        return { valid: false, error: `Expected integer but got float` };
      }
    } else if (schemaType !== actualType) {
      return { valid: false, error: `Expected type "${schemaType}" but got "${actualType}"` };
    }
  }

  // Check required properties for object type
  if (
    schemaType === "object" &&
    Array.isArray(schema.required) &&
    typeof parsed === "object" &&
    parsed !== null
  ) {
    const obj = parsed as Record<string, unknown>;
    for (const key of schema.required as string[]) {
      if (!(key in obj)) {
        return { valid: false, error: `Missing required property "${key}"` };
      }
    }
  }

  return { valid: true, parsed };
}

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
  const outputFormat = resolveOutputFormat(opts);

  // 1. Combine prompt + stdin + system prompt overrides
  const stdinText = await readStdin();
  const rawPrompt = [opts.prompt, stdinText].filter(Boolean).join("\n\n");

  if (!rawPrompt) {
    process.stderr.write("Error: no prompt provided (use -p <text> or pipe via stdin)\n");
    process.exitCode = 1;
    return;
  }

  const prompt = buildPromptWithSystemOverrides(
    rawPrompt,
    opts.systemPrompt,
    opts.appendSystemPrompt,
  );

  // 2. Tool restriction warning
  if (opts.tools) {
    const toolList = parseToolsList(opts.tools);
    if (toolList.length > 0) {
      process.stderr.write(
        `Note: tool restriction requested (${toolList.join(", ")}). ` +
          "This requires gateway support; tools may not be restricted if unsupported.\n",
      );
    }
  }

  // 3. Resolve connection
  const connection = resolveGatewayConnection({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  // 4. Create client
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

  // Budget + turn tracking
  let turnCount = 0;
  let cumulativeCostUsd = 0;
  let resolved = false;
  let budgetExceeded = false;
  let turnsExceeded = false;

  const result = new Promise<void>((resolve, reject) => {
    let lastOutputLength = 0;
    const isJsonOutput = outputFormat === "json" || outputFormat === "stream-json";

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
            if (outputFormat === "stream-json") {
              writeJsonLine({ type: "delta", text: incremental });
            } else if (outputFormat !== "json") {
              // text mode: stream directly
              process.stdout.write(incremental);
            }
            // json mode: accumulate silently until final
            lastOutputLength = displayText.length;
          }
        }
      } else if (evt.event === "chat.final") {
        turnCount += 1;

        // Track cost if usage info is present
        const usage = payload.usage as Record<string, unknown> | undefined;
        if (usage && typeof usage.costUsd === "number") {
          cumulativeCostUsd += usage.costUsd as number;
        }

        const message = payload.message ?? payload;
        const finalText = assembler.finalize(runId, message, showThinking);
        const remaining = finalText.slice(lastOutputLength);

        if (remaining) {
          if (outputFormat === "stream-json") {
            writeJsonLine({ type: "delta", text: remaining });
          } else if (outputFormat !== "json") {
            process.stdout.write(remaining);
          }
        }

        if (isJsonOutput) {
          writeJsonLine({ type: "final", text: finalText });
        } else {
          // Ensure trailing newline
          if (!finalText.endsWith("\n")) {
            process.stdout.write("\n");
          }
        }

        // Check max turns
        if (opts.maxTurns && turnCount >= opts.maxTurns) {
          turnsExceeded = true;
          process.stderr.write(`Max turns (${opts.maxTurns}) reached. Stopping.\n`);
          resolved = true;
          resolve();
          return;
        }

        // Check budget
        if (opts.maxBudgetUsd && cumulativeCostUsd >= opts.maxBudgetUsd) {
          budgetExceeded = true;
          process.stderr.write(
            `Budget cap ($${opts.maxBudgetUsd.toFixed(2)}) exceeded ` +
              `(spent: $${cumulativeCostUsd.toFixed(4)}). Stopping.\n`,
          );
          resolved = true;
          resolve();
          return;
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

  // 5. Connect + send
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

  // 6. Wait for result or timeout
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

  // 7. Post-processing: JSON schema validation
  if (opts.jsonSchema && !budgetExceeded && !turnsExceeded && process.exitCode !== 1) {
    // Collect all "final" lines from stdout to validate
    // The final text was already written; we re-parse from assembler state
    // For simplicity, we capture the final assembled text from the last finalize call
    const allText = assembler.finalize(runId, {}, showThinking);
    const validation = validateJsonSchema(allText, opts.jsonSchema);
    if (!validation.valid) {
      process.stderr.write(`JSON schema validation failed: ${validation.error}\n`);
      process.exitCode = 1;
    }
  }
}

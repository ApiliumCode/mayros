/**
 * MCP Stdio Server Transport.
 *
 * Reads JSON-RPC messages from stdin (newline-delimited) and writes
 * responses to stdout. Used for local IDE integrations (VSCode, Cursor,
 * JetBrains, Claude Desktop).
 *
 * Protocol: one JSON-RPC message per line (ndjson).
 */

import type { McpProtocolDispatcher } from "./protocol.js";

// ============================================================================
// Types
// ============================================================================

export type StdioTransportOptions = {
  dispatcher: McpProtocolDispatcher;
  stdin?: NodeJS.ReadableStream;
  stdout?: NodeJS.WritableStream;
  onError?: (err: Error) => void;
  onClose?: () => void;
};

// ============================================================================
// Transport
// ============================================================================

export class McpStdioTransport {
  private readonly dispatcher: McpProtocolDispatcher;
  private readonly stdin: NodeJS.ReadableStream;
  private readonly stdout: NodeJS.WritableStream;
  private readonly onError?: (err: Error) => void;
  private readonly onClose?: () => void;
  private running = false;
  private buffer = "";

  constructor(options: StdioTransportOptions) {
    this.dispatcher = options.dispatcher;
    this.stdin = options.stdin ?? process.stdin;
    this.stdout = options.stdout ?? process.stdout;
    this.onError = options.onError;
    this.onClose = options.onClose;
  }

  /** Start listening for messages on stdin. */
  start(): void {
    if (this.running) return;
    this.running = true;

    this.stdin.on("data", (chunk: Buffer | string) => {
      this.buffer += chunk.toString();
      void this.processBuffer();
    });

    this.stdin.on("end", () => {
      this.running = false;
      this.onClose?.();
    });

    this.stdin.on("error", (err: Error) => {
      this.onError?.(err);
    });
  }

  /** Stop listening. */
  stop(): void {
    this.running = false;
    // Remove all listeners to prevent memory leaks
    this.stdin.removeAllListeners("data");
    this.stdin.removeAllListeners("end");
    this.stdin.removeAllListeners("error");
  }

  /** Check if transport is running. */
  isRunning(): boolean {
    return this.running;
  }

  // ── Internal ────────────────────────────────────────────────────────

  private async processBuffer(): Promise<void> {
    while (this.buffer.includes("\n")) {
      const newlineIndex = this.buffer.indexOf("\n");
      const line = this.buffer.slice(0, newlineIndex).trim();
      this.buffer = this.buffer.slice(newlineIndex + 1);

      if (!line) continue;

      try {
        const response = await this.dispatcher.handleMessage(line);
        if (response !== null) {
          this.send(response);
        }
      } catch (err) {
        this.onError?.(err instanceof Error ? err : new Error(String(err)));
      }
    }
  }

  private send(data: string): void {
    if (!this.running) return;
    this.stdout.write(data + "\n");
  }
}

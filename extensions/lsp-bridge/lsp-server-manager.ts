/**
 * LSP Server Manager.
 *
 * Manages LSP server processes: spawn, initialize handshake, shutdown.
 * Uses Content-Length header framing over stdio (JSON-RPC 2.0).
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { LspServerConfig } from "./config.js";
import {
  createJsonRpcRequest,
  createJsonRpcNotification,
  encodeMessage,
  type JsonRpcResponse,
} from "./lsp-protocol.js";

// ============================================================================
// Types
// ============================================================================

type LspServerHandle = {
  config: LspServerConfig;
  process: ChildProcess;
  initialized: boolean;
  pendingRequests: Map<
    number,
    { resolve: (value: unknown) => void; reject: (reason: Error) => void }
  >;
  buffer: Buffer;
};

// ============================================================================
// LspServerManager
// ============================================================================

export class LspServerManager {
  private readonly servers = new Map<string, LspServerHandle>();
  private readonly requestTimeoutMs: number;

  constructor(opts?: { requestTimeoutMs?: number }) {
    this.requestTimeoutMs = opts?.requestTimeoutMs ?? 10_000;
  }

  /**
   * Start an LSP server process and perform the initialize handshake.
   */
  async start(config: LspServerConfig): Promise<void> {
    const { language } = config;

    // Idempotent — if already running, skip
    if (this.servers.has(language) && this.isRunning(language)) {
      return;
    }

    // Clean up any dead handle
    this.servers.delete(language);

    const child = spawn(config.command, config.args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    const handle: LspServerHandle = {
      config,
      process: child,
      initialized: false,
      pendingRequests: new Map(),
      buffer: Buffer.alloc(0),
    };

    this.servers.set(language, handle);

    // Wire up stdout for JSON-RPC responses
    child.stdout?.on("data", (chunk: Buffer) => {
      this.processBuffer(handle, chunk);
    });

    // Handle process exit
    child.on("exit", () => {
      handle.initialized = false;
      // Reject all pending requests
      for (const [, pending] of handle.pendingRequests) {
        pending.reject(new Error(`LSP server ${language} exited`));
      }
      handle.pendingRequests.clear();
    });

    child.on("error", () => {
      handle.initialized = false;
    });

    // Send initialize request
    const rootUri = config.rootUri ?? `file://${process.cwd()}`;
    const initResult = await this.sendRequest(language, "initialize", {
      processId: process.pid,
      rootUri,
      capabilities: {},
    });

    if (initResult !== null) {
      handle.initialized = true;
      // Send initialized notification
      this.sendNotification(language, "initialized", {});
    }
  }

  /**
   * Stop a specific LSP server.
   */
  async stop(language: string): Promise<void> {
    const handle = this.servers.get(language);
    if (!handle) return;

    try {
      // Send shutdown request
      await this.sendRequest(language, "shutdown", null);
      // Send exit notification
      this.sendNotification(language, "exit", undefined);
    } catch {
      // Server may already be dead
    }

    // Force kill after a short delay if still running
    setTimeout(() => {
      if (handle.process.exitCode === null) {
        handle.process.kill("SIGKILL");
      }
    }, 2000);

    this.servers.delete(language);
  }

  /**
   * Stop all running LSP servers.
   */
  async stopAll(): Promise<void> {
    const languages = [...this.servers.keys()];
    for (const lang of languages) {
      await this.stop(lang);
    }
  }

  /**
   * Check if a server is running and initialized.
   */
  isRunning(language: string): boolean {
    const handle = this.servers.get(language);
    if (!handle) return false;
    return handle.process.exitCode === null && handle.initialized;
  }

  /**
   * Get configured languages and their running status.
   */
  getStatus(): Array<{ language: string; running: boolean }> {
    const result: Array<{ language: string; running: boolean }> = [];
    for (const [language] of this.servers) {
      result.push({ language, running: this.isRunning(language) });
    }
    return result;
  }

  /**
   * Send a JSON-RPC request and wait for the response.
   */
  async sendRequest(language: string, method: string, params: unknown): Promise<unknown> {
    const handle = this.servers.get(language);
    if (!handle || handle.process.exitCode !== null) {
      throw new Error(`LSP server ${language} is not running`);
    }

    const request = createJsonRpcRequest(method, params);
    const encoded = encodeMessage(request);

    return new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        handle.pendingRequests.delete(request.id);
        reject(new Error(`LSP request ${method} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      handle.pendingRequests.set(request.id, {
        resolve: (value) => {
          clearTimeout(timer);
          resolve(value);
        },
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });

      handle.process.stdin?.write(encoded);
    });
  }

  /**
   * Send a JSON-RPC notification (no response expected).
   */
  sendNotification(language: string, method: string, params: unknown): void {
    const handle = this.servers.get(language);
    if (!handle || handle.process.exitCode !== null) return;

    const notification = createJsonRpcNotification(method, params);
    const encoded = encodeMessage(notification);
    handle.process.stdin?.write(encoded);
  }

  // ---------- Buffer processing ----------

  private processBuffer(handle: LspServerHandle, chunk: Buffer): void {
    handle.buffer = Buffer.concat([handle.buffer, chunk]);

    while (true) {
      const headerEnd = handle.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) break;

      // Parse Content-Length header
      const headerStr = handle.buffer.subarray(0, headerEnd).toString("utf8");
      const match = headerStr.match(/Content-Length:\s*(\d+)/i);
      if (!match) {
        // Skip malformed header
        handle.buffer = handle.buffer.subarray(headerEnd + 4);
        continue;
      }

      const contentLength = Number.parseInt(match[1], 10);
      const bodyStart = headerEnd + 4;
      const totalNeeded = bodyStart + contentLength;

      if (handle.buffer.length < totalNeeded) break; // Wait for more data

      const body = handle.buffer.subarray(bodyStart, totalNeeded).toString("utf8");
      handle.buffer = handle.buffer.subarray(totalNeeded);

      try {
        const message = JSON.parse(body) as Record<string, unknown>;

        // Check if it's a response (has id)
        if ("id" in message && typeof message.id === "number") {
          const pending = handle.pendingRequests.get(message.id);
          if (pending) {
            handle.pendingRequests.delete(message.id);
            const response = message as unknown as JsonRpcResponse;
            if (response.error) {
              pending.reject(
                new Error(`LSP error ${response.error.code}: ${response.error.message}`),
              );
            } else {
              pending.resolve(response.result);
            }
          }
        }
        // Notifications are ignored for now (diagnostics handled by polling)
      } catch {
        // Malformed JSON — skip
      }
    }
  }
}

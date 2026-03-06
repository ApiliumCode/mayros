/**
 * MCP Streamable HTTP Server Transport.
 *
 * Implements the MCP Streamable HTTP transport specification:
 *   POST /mcp  — JSON-RPC request/response
 *   GET  /mcp  — SSE stream for server-initiated notifications (future)
 *
 * Uses Node's built-in http module. No external dependencies.
 */

import { createServer, type Server, type IncomingMessage, type ServerResponse } from "node:http";
import type { McpProtocolDispatcher } from "./protocol.js";

// ============================================================================
// Types
// ============================================================================

export type HttpTransportOptions = {
  dispatcher: McpProtocolDispatcher;
  port: number;
  host: string;
  authToken?: string;
  allowedOrigins: string[];
  onError?: (err: Error) => void;
  onRequest?: (method: string, path: string) => void;
};

// ============================================================================
// Transport
// ============================================================================

export class McpHttpTransport {
  private readonly dispatcher: McpProtocolDispatcher;
  private readonly port: number;
  private readonly host: string;
  private readonly authToken?: string;
  private readonly allowedOrigins: string[];
  private readonly onError?: (err: Error) => void;
  private readonly onRequest?: (method: string, path: string) => void;
  private server: Server | null = null;

  constructor(options: HttpTransportOptions) {
    this.dispatcher = options.dispatcher;
    this.port = options.port;
    this.host = options.host;
    this.authToken = options.authToken;
    this.allowedOrigins = options.allowedOrigins;
    this.onError = options.onError;
    this.onRequest = options.onRequest;
  }

  /** Start the HTTP server. */
  async start(): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.server = createServer((req, res) => {
        void this.handleRequest(req, res);
      });

      this.server.on("error", (err) => {
        this.onError?.(err);
        reject(err);
      });

      this.server.listen(this.port, this.host, () => {
        resolve();
      });
    });
  }

  /** Stop the HTTP server. */
  async stop(): Promise<void> {
    return new Promise<void>((resolve) => {
      if (!this.server) {
        resolve();
        return;
      }
      this.server.close(() => {
        this.server = null;
        resolve();
      });
    });
  }

  /** Check if server is running. */
  isRunning(): boolean {
    return this.server !== null && this.server.listening;
  }

  /** Get the server address. */
  getAddress(): string {
    return `http://${this.host}:${this.port}`;
  }

  // ── Request handling ────────────────────────────────────────────────

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const method = req.method ?? "GET";
    const url = req.url ?? "/";

    this.onRequest?.(method, url);

    // CORS preflight
    if (method === "OPTIONS") {
      this.setCorsHeaders(req, res);
      res.writeHead(204);
      res.end();
      return;
    }

    // Auth check
    if (this.authToken) {
      const auth = req.headers.authorization;
      if (!auth || auth !== `Bearer ${this.authToken}`) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Unauthorized" }));
        return;
      }
    }

    this.setCorsHeaders(req, res);

    // Health check
    if (url === "/health" && method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", transport: "streamable-http" }));
      return;
    }

    // MCP endpoint
    if (url === "/mcp" && method === "POST") {
      await this.handleMcpPost(req, res);
      return;
    }

    // SSE endpoint (for future server-initiated notifications)
    if (url === "/mcp" && method === "GET") {
      this.handleMcpSse(res);
      return;
    }

    // Not found
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  }

  private async handleMcpPost(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const body = await readBody(req);
      const response = await this.dispatcher.handleMessage(body);

      if (response === null) {
        // Notification — no response needed
        res.writeHead(204);
        res.end();
        return;
      }

      res.writeHead(200, {
        "Content-Type": "application/json",
        "Cache-Control": "no-cache",
      });
      res.end(response);
    } catch (err) {
      this.onError?.(err instanceof Error ? err : new Error(String(err)));
      res.writeHead(500, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: "Internal server error" },
        }),
      );
    }
  }

  private handleMcpSse(res: ServerResponse): void {
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    });

    // Send initial ping
    res.write("event: ping\ndata: {}\n\n");

    // Keep connection alive
    const keepAlive = setInterval(() => {
      if (res.destroyed) {
        clearInterval(keepAlive);
        return;
      }
      res.write("event: ping\ndata: {}\n\n");
    }, 30_000);

    res.on("close", () => {
      clearInterval(keepAlive);
    });
  }

  private setCorsHeaders(req: IncomingMessage, res: ServerResponse): void {
    const origin = req.headers.origin ?? "*";
    const allowed =
      this.allowedOrigins.length === 0 ||
      this.allowedOrigins.includes("*") ||
      this.allowedOrigins.includes(origin);

    if (allowed) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
      res.setHeader("Access-Control-Max-Age", "86400");
    }
  }
}

// ============================================================================
// Helpers
// ============================================================================

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const MAX_BODY = 10 * 1024 * 1024; // 10 MB

    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error("Request body too large"));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });

    req.on("end", () => {
      resolve(Buffer.concat(chunks).toString("utf-8"));
    });

    req.on("error", reject);
  });
}

/**
 * MCP Transport Abstraction.
 *
 * Each transport type (stdio, sse, http, websocket) implements the McpTransport
 * interface with connect/disconnect/listTools/callTool. Communication uses
 * JSON-RPC 2.0 over the appropriate channel.
 *
 * Since we abstract away @modelcontextprotocol/sdk, this provides a simple
 * JSON-RPC protocol layer with initialize handshake, tools/list, and tools/call.
 */

import type { McpTransportType } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type McpToolDescriptor = {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
};

export type McpCallResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

export type McpTransport = {
  type: McpTransportType;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  listTools(): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult>;
  isConnected(): boolean;
};

// ============================================================================
// JSON-RPC helpers
// ============================================================================

type JsonRpcRequest = {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: Record<string, unknown>;
};

type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
};

let nextRequestId = 1;

function createRequest(method: string, params?: Record<string, unknown>): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: nextRequestId++,
    method,
    params,
  };
}

function parseResponse(data: string): JsonRpcResponse {
  const parsed = JSON.parse(data) as JsonRpcResponse;
  if (parsed.jsonrpc !== "2.0") {
    throw new Error("Invalid JSON-RPC response: missing jsonrpc 2.0");
  }
  return parsed;
}

function assertNoError(response: JsonRpcResponse): void {
  if (response.error) {
    throw new Error(`JSON-RPC error ${response.error.code}: ${response.error.message}`);
  }
}

// ============================================================================
// StdioTransport
// ============================================================================

class StdioTransport implements McpTransport {
  readonly type: McpTransportType = "stdio";
  private connected = false;
  private process: {
    stdin: { write(data: string): boolean; end(): void };
    stdout: { on(event: string, cb: (data: Buffer) => void): void };
    on(event: string, cb: (...args: unknown[]) => void): void;
    kill(): boolean;
  } | null = null;
  private pending = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason: Error) => void;
    }
  >();
  private buffer = "";

  constructor(
    private readonly command: string,
    private readonly args: string[] = [],
  ) {}

  async connect(): Promise<void> {
    const { spawn } = await import("node:child_process");
    const proc = spawn(this.command, this.args, {
      stdio: ["pipe", "pipe", "pipe"],
    });

    proc.on("error", (err: Error) => {
      this.connected = false;
      for (const [, handler] of this.pending) {
        handler.reject(err);
      }
      this.pending.clear();
    });

    proc.on("exit", () => {
      this.connected = false;
    });

    proc.stdout.on("data", (chunk: Buffer) => {
      this.buffer += chunk.toString();
      this.processBuffer();
    });

    this.process = proc as unknown as typeof this.process;

    // Send initialize handshake
    const initReq = createRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mayros-mcp-client", version: "0.1.3" },
    });

    const response = await this.sendRequest(initReq);
    assertNoError(response);

    // Send initialized notification
    const notif = JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
    this.process!.stdin.write(notif + "\n");

    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.process) {
      this.process.stdin.end();
      this.process.kill();
      this.process = null;
    }
    this.connected = false;
    this.pending.clear();
    this.buffer = "";
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    this.ensureConnected();
    const req = createRequest("tools/list");
    const response = await this.sendRequest(req);
    assertNoError(response);
    const result = response.result as { tools?: McpToolDescriptor[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    this.ensureConnected();
    const req = createRequest("tools/call", { name, arguments: args });
    const response = await this.sendRequest(req);
    assertNoError(response);
    return (response.result ?? { content: [] }) as McpCallResult;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensureConnected(): void {
    if (!this.connected || !this.process) {
      throw new Error("StdioTransport is not connected");
    }
  }

  private sendRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      const data = JSON.stringify(req) + "\n";
      try {
        this.process!.stdin.write(data);
      } catch (err) {
        this.pending.delete(req.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private processBuffer(): void {
    const lines = this.buffer.split("\n");
    // Keep the last (possibly incomplete) line in the buffer
    this.buffer = lines.pop() ?? "";

    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const response = parseResponse(trimmed);
        const handler = this.pending.get(response.id);
        if (handler) {
          this.pending.delete(response.id);
          handler.resolve(response);
        }
      } catch {
        // Ignore non-JSON or notification lines
      }
    }
  }
}

// ============================================================================
// HttpTransport
// ============================================================================

class HttpTransport implements McpTransport {
  readonly type: McpTransportType = "http";
  private connected = false;
  private sessionId: string | undefined;

  constructor(
    private readonly url: string,
    private readonly authToken?: string,
  ) {}

  async connect(): Promise<void> {
    const headers = this.buildHeaders();
    const req = createRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mayros-mcp-client", version: "0.1.3" },
    });

    const res = await fetch(this.url, {
      method: "POST",
      headers,
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      throw new Error(`HTTP initialize failed with status ${res.status}`);
    }

    // Extract session ID from response header if present
    const sessionHeader = res.headers.get("mcp-session-id");
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }

    const response = (await res.json()) as JsonRpcResponse;
    assertNoError(response);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    this.connected = false;
    this.sessionId = undefined;
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    this.ensureConnected();
    const result = await this.rpcCall("tools/list");
    return (result as { tools?: McpToolDescriptor[] })?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    this.ensureConnected();
    const result = await this.rpcCall("tools/call", { name, arguments: args });
    return (result ?? { content: [] }) as McpCallResult;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensureConnected(): void {
    if (!this.connected) {
      throw new Error("HttpTransport is not connected");
    }
  }

  private buildHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) {
      headers["Authorization"] = this.authToken;
    }
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }
    return headers;
  }

  private async rpcCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const req = createRequest(method, params);
    const res = await fetch(this.url, {
      method: "POST",
      headers: this.buildHeaders(),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${method} failed with status ${res.status}`);
    }

    const response = (await res.json()) as JsonRpcResponse;
    assertNoError(response);
    return response.result;
  }
}

// ============================================================================
// SseTransport
// ============================================================================

class SseTransport implements McpTransport {
  readonly type: McpTransportType = "sse";
  private connected = false;
  private sessionId: string | undefined;
  private messagesUrl: string | undefined;
  private abortController: AbortController | null = null;
  private pending = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason: Error) => void;
    }
  >();

  constructor(
    private readonly url: string,
    private readonly authToken?: string,
  ) {}

  async connect(): Promise<void> {
    this.abortController = new AbortController();
    const headers: Record<string, string> = { Accept: "text/event-stream" };
    if (this.authToken) {
      headers["Authorization"] = this.authToken;
    }

    // Open SSE connection to get the messages endpoint
    const res = await fetch(this.url, {
      method: "GET",
      headers,
      signal: this.abortController.signal,
    });

    if (!res.ok) {
      throw new Error(`SSE connect failed with status ${res.status}`);
    }

    const sessionHeader = res.headers.get("mcp-session-id");
    if (sessionHeader) {
      this.sessionId = sessionHeader;
    }

    // For SSE, the response body is a stream. In a real implementation we would
    // parse the SSE stream. For now, extract the messages URL from the response.
    const body = await res.text();
    const endpointMatch = /event:\s*endpoint\ndata:\s*(.+)/m.exec(body);
    if (endpointMatch) {
      const endpoint = endpointMatch[1].trim();
      // Resolve relative URL
      const base = new URL(this.url);
      this.messagesUrl = new URL(endpoint, base).toString();
    } else {
      // Fallback: use same URL for POST messages
      this.messagesUrl = this.url;
    }

    // Send initialize via POST
    const initReq = createRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mayros-mcp-client", version: "0.1.3" },
    });

    const initRes = await fetch(this.messagesUrl, {
      method: "POST",
      headers: this.buildPostHeaders(),
      body: JSON.stringify(initReq),
    });

    if (!initRes.ok) {
      throw new Error(`SSE initialize failed with status ${initRes.status}`);
    }

    const response = (await initRes.json()) as JsonRpcResponse;
    assertNoError(response);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.abortController) {
      this.abortController.abort();
      this.abortController = null;
    }
    this.connected = false;
    this.sessionId = undefined;
    this.messagesUrl = undefined;
    for (const [, handler] of this.pending) {
      handler.reject(new Error("Transport disconnected"));
    }
    this.pending.clear();
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    this.ensureConnected();
    const result = await this.rpcCall("tools/list");
    return (result as { tools?: McpToolDescriptor[] })?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    this.ensureConnected();
    const result = await this.rpcCall("tools/call", { name, arguments: args });
    return (result ?? { content: [] }) as McpCallResult;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensureConnected(): void {
    if (!this.connected || !this.messagesUrl) {
      throw new Error("SseTransport is not connected");
    }
  }

  private buildPostHeaders(): Record<string, string> {
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (this.authToken) {
      headers["Authorization"] = this.authToken;
    }
    if (this.sessionId) {
      headers["mcp-session-id"] = this.sessionId;
    }
    return headers;
  }

  private async rpcCall(method: string, params?: Record<string, unknown>): Promise<unknown> {
    const req = createRequest(method, params);
    const res = await fetch(this.messagesUrl!, {
      method: "POST",
      headers: this.buildPostHeaders(),
      body: JSON.stringify(req),
    });

    if (!res.ok) {
      throw new Error(`SSE ${method} failed with status ${res.status}`);
    }

    const response = (await res.json()) as JsonRpcResponse;
    assertNoError(response);
    return response.result;
  }
}

// ============================================================================
// WebSocketTransport
// ============================================================================

class WebSocketTransport implements McpTransport {
  readonly type: McpTransportType = "websocket";
  private connected = false;
  private ws: {
    send(data: string): void;
    close(): void;
    addEventListener(event: string, handler: (ev: { data: string }) => void): void;
    removeEventListener(event: string, handler: (ev: { data: string }) => void): void;
    readyState: number;
  } | null = null;
  private pending = new Map<
    number,
    {
      resolve: (value: JsonRpcResponse) => void;
      reject: (reason: Error) => void;
    }
  >();

  constructor(
    private readonly url: string,
    private readonly authToken?: string,
  ) {}

  async connect(): Promise<void> {
    // Dynamic import to support environments without native WebSocket
    const wsUrl = this.authToken
      ? `${this.url}${this.url.includes("?") ? "&" : "?"}token=${encodeURIComponent(this.authToken)}`
      : this.url;

    const ws = new WebSocket(wsUrl);

    await new Promise<void>((resolve, reject) => {
      const target = ws as unknown as {
        addEventListener(event: string, handler: (...args: unknown[]) => void): void;
        removeEventListener(event: string, handler: (...args: unknown[]) => void): void;
      };
      const onOpen = () => {
        target.removeEventListener("open", onOpen);
        target.removeEventListener("error", onError);
        resolve();
      };
      const onError = (...args: unknown[]) => {
        target.removeEventListener("open", onOpen);
        target.removeEventListener("error", onError);
        reject(new Error(`WebSocket connection failed: ${String(args[0])}`));
      };
      target.addEventListener("open", onOpen);
      target.addEventListener("error", onError);
    });

    ws.addEventListener("message", (event: { data: string }) => {
      try {
        const response = parseResponse(String(event.data));
        const handler = this.pending.get(response.id);
        if (handler) {
          this.pending.delete(response.id);
          handler.resolve(response);
        }
      } catch {
        // Ignore non-JSON or notification messages
      }
    });

    this.ws = ws as unknown as typeof this.ws;

    // Send initialize handshake
    const initReq = createRequest("initialize", {
      protocolVersion: "2024-11-05",
      capabilities: {},
      clientInfo: { name: "mayros-mcp-client", version: "0.1.3" },
    });

    const response = await this.sendRequest(initReq);
    assertNoError(response);
    this.connected = true;
  }

  async disconnect(): Promise<void> {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connected = false;
    for (const [, handler] of this.pending) {
      handler.reject(new Error("Transport disconnected"));
    }
    this.pending.clear();
  }

  async listTools(): Promise<McpToolDescriptor[]> {
    this.ensureConnected();
    const req = createRequest("tools/list");
    const response = await this.sendRequest(req);
    assertNoError(response);
    const result = response.result as { tools?: McpToolDescriptor[] } | undefined;
    return result?.tools ?? [];
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<McpCallResult> {
    this.ensureConnected();
    const req = createRequest("tools/call", { name, arguments: args });
    const response = await this.sendRequest(req);
    assertNoError(response);
    return (response.result ?? { content: [] }) as McpCallResult;
  }

  isConnected(): boolean {
    return this.connected;
  }

  private ensureConnected(): void {
    if (!this.connected || !this.ws) {
      throw new Error("WebSocketTransport is not connected");
    }
  }

  private sendRequest(req: JsonRpcRequest): Promise<JsonRpcResponse> {
    return new Promise((resolve, reject) => {
      this.pending.set(req.id, { resolve, reject });
      try {
        this.ws!.send(JSON.stringify(req));
      } catch (err) {
        this.pending.delete(req.id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createTransport(config: {
  type: McpTransportType;
  command?: string;
  args?: string[];
  url?: string;
  authToken?: string;
}): McpTransport {
  switch (config.type) {
    case "stdio":
      if (!config.command) {
        throw new Error("stdio transport requires a command");
      }
      return new StdioTransport(config.command, config.args);

    case "http":
      if (!config.url) {
        throw new Error("http transport requires a url");
      }
      return new HttpTransport(config.url, config.authToken);

    case "sse":
      if (!config.url) {
        throw new Error("sse transport requires a url");
      }
      return new SseTransport(config.url, config.authToken);

    case "websocket":
      if (!config.url) {
        throw new Error("websocket transport requires a url");
      }
      return new WebSocketTransport(config.url, config.authToken);

    default:
      throw new Error(`Unsupported transport type: ${String(config.type)}`);
  }
}

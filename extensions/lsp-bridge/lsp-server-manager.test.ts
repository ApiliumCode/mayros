import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { LspServerManager } from "./lsp-server-manager.js";
import { EventEmitter } from "node:events";
import type { ChildProcess } from "node:child_process";

// ============================================================================
// Mock child_process
// ============================================================================

let mockSpawnResult: MockChildProcess;
let allMocks: MockChildProcess[] = [];

class MockStdin extends EventEmitter {
  written: Buffer[] = [];
  write(data: Buffer | string): boolean {
    this.written.push(Buffer.isBuffer(data) ? data : Buffer.from(data));
    return true;
  }
}

class MockStdout extends EventEmitter {}

class MockChildProcess extends EventEmitter {
  stdin = new MockStdin();
  stdout = new MockStdout();
  stderr = new EventEmitter();
  exitCode: number | null = null;
  pid = 12345;

  kill(): boolean {
    this.exitCode = 9;
    this.emit("exit", 9, "SIGKILL");
    return true;
  }

  /** Parse the last JSON-RPC request id from stdin writes. */
  lastRequestId(): number {
    for (let i = this.stdin.written.length - 1; i >= 0; i--) {
      const raw = this.stdin.written[i].toString();
      const bodyStart = raw.indexOf("\r\n\r\n");
      if (bodyStart < 0) continue;
      try {
        const body = JSON.parse(raw.slice(bodyStart + 4)) as { id?: number };
        if (typeof body.id === "number") return body.id;
      } catch {
        // skip
      }
    }
    return -1;
  }

  /** Simulate a JSON-RPC response using the last request id. */
  respondOk(result: unknown): void {
    const id = this.lastRequestId();
    this.sendResponse(id, result);
  }

  /** Simulate a JSON-RPC response with explicit id. */
  sendResponse(id: number, result: unknown): void {
    const body = JSON.stringify({ jsonrpc: "2.0", id, result });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    this.stdout.emit("data", Buffer.from(message));
  }

  /** Simulate a JSON-RPC error response using the last request id. */
  respondError(code: number, message: string): void {
    const id = this.lastRequestId();
    const body = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    this.stdout.emit("data", Buffer.from(msg));
  }

  /** Simulate a JSON-RPC error response with explicit id. */
  sendError(id: number, code: number, message: string): void {
    const body = JSON.stringify({ jsonrpc: "2.0", id, error: { code, message } });
    const msg = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    this.stdout.emit("data", Buffer.from(msg));
  }
}

vi.mock("node:child_process", () => ({
  spawn: vi.fn(() => {
    mockSpawnResult = new MockChildProcess();
    allMocks.push(mockSpawnResult);
    return mockSpawnResult as unknown as ChildProcess;
  }),
}));

// ============================================================================
// Tests
// ============================================================================

describe("LspServerManager", () => {
  let manager: LspServerManager;

  const tsConfig = {
    language: "typescript",
    command: "typescript-language-server",
    args: ["--stdio"],
    rootUri: "file:///workspace",
  };

  beforeEach(() => {
    manager = new LspServerManager({ requestTimeoutMs: 1000 });
  });

  afterEach(async () => {
    // Kill all mock processes so stopAll doesn't wait for shutdown timeout
    for (const m of allMocks) {
      if (m.exitCode === null) m.kill();
    }
    allMocks = [];
    await manager.stopAll();
  });

  it("start spawns process with correct command/args", async () => {
    const spawnFn = (await import("node:child_process")).spawn;
    const startPromise = manager.start(tsConfig);

    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });

    await startPromise;

    expect(spawnFn).toHaveBeenCalledWith(
      "typescript-language-server",
      ["--stdio"],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] }),
    );
  });

  it("initialize handshake sends correct JSON-RPC", async () => {
    const startPromise = manager.start(tsConfig);

    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });

    await startPromise;

    expect(mockSpawnResult.stdin.written.length).toBeGreaterThan(0);
    const firstWrite = mockSpawnResult.stdin.written[0].toString();
    expect(firstWrite).toContain("initialize");
    expect(firstWrite).toContain("Content-Length:");
  });

  it("isRunning returns true after successful start", async () => {
    const startPromise = manager.start(tsConfig);

    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });

    await startPromise;
    expect(manager.isRunning("typescript")).toBe(true);
  });

  it("isRunning returns false for unknown language", () => {
    expect(manager.isRunning("unknown")).toBe(false);
  });

  it("stop sends shutdown + exit", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise;

    const proc = mockSpawnResult;
    const stopPromise = manager.stop("typescript");

    await new Promise((resolve) => setTimeout(resolve, 10));
    proc.respondOk(null);

    await stopPromise;
    expect(manager.isRunning("typescript")).toBe(false);
  });

  it("sendRequest with timeout", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise;

    // Send a request that never gets a response
    const requestPromise = manager.sendRequest("typescript", "textDocument/hover", {});

    await expect(requestPromise).rejects.toThrow("timed out");
  });

  it("sendRequest handles JSON-RPC error response", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise;

    const proc = mockSpawnResult;
    const requestPromise = manager.sendRequest("typescript", "textDocument/hover", {});

    await new Promise((resolve) => setTimeout(resolve, 10));
    const reqId = proc.lastRequestId();
    proc.sendError(reqId, -32600, "Invalid request");

    await expect(requestPromise).rejects.toThrow("LSP error -32600: Invalid request");
  });

  it("Content-Length framing handles split data", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Get the actual request id
    const reqId = mockSpawnResult.lastRequestId();

    // Send response in two chunks
    const body = JSON.stringify({ jsonrpc: "2.0", id: reqId, result: { capabilities: {} } });
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`;
    const midpoint = Math.floor(message.length / 2);

    mockSpawnResult.stdout.emit("data", Buffer.from(message.slice(0, midpoint)));
    mockSpawnResult.stdout.emit("data", Buffer.from(message.slice(midpoint)));

    await startPromise;
    expect(manager.isRunning("typescript")).toBe(true);
  });

  it("double start is idempotent", async () => {
    const startPromise1 = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise1;

    // Second start should be idempotent
    await manager.start(tsConfig);
    expect(manager.isRunning("typescript")).toBe(true);
  });

  it("process crash sets isRunning to false", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise;

    // Simulate crash
    mockSpawnResult.exitCode = 1;
    mockSpawnResult.emit("exit", 1, null);

    expect(manager.isRunning("typescript")).toBe(false);
  });

  it("getStatus returns all servers", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise;

    const status = manager.getStatus();
    expect(status).toHaveLength(1);
    expect(status[0]).toEqual({ language: "typescript", running: true });
  });

  it("sendNotification does not expect response", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise;

    // Should not throw
    manager.sendNotification("typescript", "textDocument/didOpen", {
      textDocument: { uri: "file:///test.ts" },
    });

    expect(mockSpawnResult.stdin.written.length).toBeGreaterThan(1);
  });

  it("sendRequest throws for non-running server", async () => {
    await expect(manager.sendRequest("unknown", "textDocument/hover", {})).rejects.toThrow(
      "not running",
    );
  });

  it("multiple servers with different languages", async () => {
    const start1 = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await start1;

    const pyConfig = {
      language: "python",
      command: "pylsp",
      args: [],
    };
    const start2 = manager.start(pyConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await start2;

    const status = manager.getStatus();
    expect(status).toHaveLength(2);
  });

  it("stopAll stops all servers", async () => {
    const startPromise = manager.start(tsConfig);
    await new Promise((resolve) => setTimeout(resolve, 10));
    mockSpawnResult.respondOk({ capabilities: {} });
    await startPromise;

    const proc = mockSpawnResult;

    const stopPromise = manager.stopAll();
    await new Promise((resolve) => setTimeout(resolve, 10));
    proc.respondOk(null);
    await stopPromise;

    expect(manager.getStatus()).toHaveLength(0);
  });
});

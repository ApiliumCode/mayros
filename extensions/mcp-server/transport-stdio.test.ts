import { describe, it, expect, vi, beforeEach } from "vitest";
import { McpStdioTransport, type StdioTransportOptions } from "./transport-stdio.js";
import { McpProtocolDispatcher, type McpHandlers } from "./protocol.js";
import { EventEmitter } from "node:events";

// ── Mock streams ──────────────────────────────────────────────────────

class MockReadable extends EventEmitter {
  feed(data: string): void {
    this.emit("data", Buffer.from(data));
  }
  end(): void {
    this.emit("end");
  }
}

class MockWritable {
  written: string[] = [];
  write(data: string): boolean {
    this.written.push(data);
    return true;
  }
}

function createTestDispatcher(): McpProtocolDispatcher {
  const handlers: McpHandlers = {
    listTools: async () => [],
    callTool: async () => ({ content: [{ type: "text", text: "ok" }] }),
    listResources: async () => [],
    readResource: async (uri) => ({ uri, text: "content" }),
    listPrompts: async () => [],
    getPrompt: async () => [
      { role: "assistant" as const, content: { type: "text" as const, text: "ok" } },
    ],
  };

  return new McpProtocolDispatcher({
    serverInfo: { name: "test", version: "1.0" },
    capabilities: { tools: {} },
    handlers,
  });
}

describe("McpStdioTransport", () => {
  let stdin: MockReadable;
  let stdout: MockWritable;
  let dispatcher: McpProtocolDispatcher;
  let transport: McpStdioTransport;

  beforeEach(() => {
    stdin = new MockReadable();
    stdout = new MockWritable();
    dispatcher = createTestDispatcher();
    transport = new McpStdioTransport({
      dispatcher,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      stdout: stdout as unknown as NodeJS.WritableStream,
    });
  });

  // 1
  it("starts and becomes running", () => {
    transport.start();
    expect(transport.isRunning()).toBe(true);
  });

  // 2
  it("stops and becomes not running", () => {
    transport.start();
    transport.stop();
    expect(transport.isRunning()).toBe(false);
  });

  // 3
  it("processes a JSON-RPC message from stdin", async () => {
    transport.start();
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    stdin.feed(msg + "\n");
    // Wait for async processing
    await new Promise((r) => setTimeout(r, 50));
    expect(stdout.written.length).toBeGreaterThanOrEqual(1);
    const response = JSON.parse(stdout.written[0]!.trim());
    expect(response.result).toEqual({});
  });

  // 4
  it("handles initialize handshake via stdio", async () => {
    transport.start();
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" });
    stdin.feed(msg + "\n");
    await new Promise((r) => setTimeout(r, 50));
    const response = JSON.parse(stdout.written[0]!.trim());
    expect(response.result.serverInfo.name).toBe("test");
  });

  // 5
  it("handles multiple messages in one chunk", async () => {
    transport.start();
    const msg1 = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    const msg2 = JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" });
    stdin.feed(msg1 + "\n" + msg2 + "\n");
    await new Promise((r) => setTimeout(r, 50));
    expect(stdout.written.length).toBeGreaterThanOrEqual(2);
  });

  // 6
  it("skips empty lines", async () => {
    transport.start();
    const msg = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" });
    stdin.feed("\n\n" + msg + "\n\n");
    await new Promise((r) => setTimeout(r, 50));
    expect(stdout.written).toHaveLength(1);
  });

  // 7
  it("calls onClose when stdin ends", () => {
    const onClose = vi.fn();
    transport = new McpStdioTransport({
      dispatcher,
      stdin: stdin as unknown as NodeJS.ReadableStream,
      stdout: stdout as unknown as NodeJS.WritableStream,
      onClose,
    });
    transport.start();
    stdin.end();
    expect(onClose).toHaveBeenCalledOnce();
  });

  // 8
  it("does not start twice", () => {
    transport.start();
    transport.start(); // Should be a no-op
    expect(transport.isRunning()).toBe(true);
  });
});

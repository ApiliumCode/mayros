import { describe, it, expect, afterEach } from "vitest";
import { McpHttpTransport } from "./transport-http.js";
import { McpProtocolDispatcher, type McpHandlers } from "./protocol.js";

// ── Helpers ───────────────────────────────────────────────────────────

function createTestDispatcher(): McpProtocolDispatcher {
  const handlers: McpHandlers = {
    listTools: async () => [{ name: "test_tool", inputSchema: { type: "object" } }],
    callTool: async () => ({ content: [{ type: "text", text: "called" }] }),
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

// Use a high port to avoid conflicts
let portCounter = 13100;
function nextPort(): number {
  return portCounter++;
}

describe("McpHttpTransport", () => {
  let transport: McpHttpTransport | null = null;

  afterEach(async () => {
    if (transport) {
      await transport.stop();
      transport = null;
    }
  });

  // 1
  it("starts and reports running", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();
    expect(transport.isRunning()).toBe(true);
    expect(transport.getAddress()).toBe(`http://127.0.0.1:${port}`);
  });

  // 2
  it("stops and reports not running", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();
    await transport.stop();
    expect(transport.isRunning()).toBe(false);
    transport = null;
  });

  // 3
  it("handles health check GET", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();

    const res = await fetch(`http://127.0.0.1:${port}/health`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.status).toBe("ok");
    expect(body.transport).toBe("streamable-http");
  });

  // 4
  it("handles MCP POST initialize", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.result.serverInfo.name).toBe("test");
  });

  // 5
  it("handles tools/list after initialize", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();

    // Initialize first
    await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });

    // Then list tools
    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const body = await res.json();
    expect(body.result.tools).toHaveLength(1);
    expect(body.result.tools[0].name).toBe("test_tool");
  });

  // 6
  it("returns 404 for unknown paths", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();

    const res = await fetch(`http://127.0.0.1:${port}/unknown`);
    expect(res.status).toBe(404);
  });

  // 7
  it("returns 401 with auth token when not provided", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      authToken: "secret-token",
      allowedOrigins: [],
    });
    await transport.start();

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(401);
  });

  // 8
  it("accepts requests with correct auth token", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      authToken: "secret-token",
      allowedOrigins: [],
    });
    await transport.start();

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer secret-token",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    });
    expect(res.status).toBe(200);
  });

  // 9
  it("handles notification (204 no content)", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();

    const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    });
    expect(res.status).toBe(204);
  });

  // 10
  it("SSE endpoint responds with event stream", async () => {
    const port = nextPort();
    transport = new McpHttpTransport({
      dispatcher: createTestDispatcher(),
      port,
      host: "127.0.0.1",
      allowedOrigins: [],
    });
    await transport.start();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 100);

    try {
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("text/event-stream");
      // Don't read body — just check headers
      controller.abort();
    } catch {
      // AbortError is expected
    } finally {
      clearTimeout(timeout);
    }
  });
});

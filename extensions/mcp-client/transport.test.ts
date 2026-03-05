/**
 * Transport Tests
 *
 * Tests cover: createTransport factory, connect/disconnect lifecycle (mocked),
 * listTools, callTool, error handling, isConnected state.
 */

import { describe, it, expect, vi } from "vitest";
import { createTransport, type McpTransport } from "./transport.js";

// ============================================================================
// Factory Tests
// ============================================================================

describe("createTransport", () => {
  it("creates stdio transport with command", () => {
    const t = createTransport({
      type: "stdio",
      command: "node",
      args: ["server.js"],
    });
    expect(t.type).toBe("stdio");
    expect(t.isConnected()).toBe(false);
  });

  it("creates http transport with url", () => {
    const t = createTransport({
      type: "http",
      url: "http://localhost:3000/mcp",
    });
    expect(t.type).toBe("http");
    expect(t.isConnected()).toBe(false);
  });

  it("creates sse transport with url", () => {
    const t = createTransport({
      type: "sse",
      url: "http://localhost:3000/sse",
    });
    expect(t.type).toBe("sse");
    expect(t.isConnected()).toBe(false);
  });

  it("creates websocket transport with url", () => {
    const t = createTransport({
      type: "websocket",
      url: "ws://localhost:3000/ws",
    });
    expect(t.type).toBe("websocket");
    expect(t.isConnected()).toBe(false);
  });

  it("throws for stdio without command", () => {
    expect(() => createTransport({ type: "stdio" })).toThrow(/requires a command/);
  });

  it("throws for http without url", () => {
    expect(() => createTransport({ type: "http" })).toThrow(/requires a url/);
  });

  it("throws for sse without url", () => {
    expect(() => createTransport({ type: "sse" })).toThrow(/requires a url/);
  });

  it("throws for websocket without url", () => {
    expect(() => createTransport({ type: "websocket" })).toThrow(/requires a url/);
  });

  it("throws for unsupported transport type", () => {
    expect(() => createTransport({ type: "unknown" as "stdio" })).toThrow(
      /Unsupported transport type/,
    );
  });
});

// ============================================================================
// Stdio Transport Lifecycle Tests (mocked child_process)
// ============================================================================

describe("StdioTransport", () => {
  it("is not connected initially", () => {
    const t = createTransport({ type: "stdio", command: "echo" });
    expect(t.isConnected()).toBe(false);
  });

  it("listTools throws when not connected", async () => {
    const t = createTransport({ type: "stdio", command: "echo" });
    await expect(t.listTools()).rejects.toThrow(/not connected/);
  });

  it("callTool throws when not connected", async () => {
    const t = createTransport({ type: "stdio", command: "echo" });
    await expect(t.callTool("test", {})).rejects.toThrow(/not connected/);
  });

  it("disconnect is safe when not connected", async () => {
    const t = createTransport({ type: "stdio", command: "echo" });
    // Should not throw
    await t.disconnect();
    expect(t.isConnected()).toBe(false);
  });
});

// ============================================================================
// HTTP Transport Tests (mocked fetch)
// ============================================================================

describe("HttpTransport", () => {
  it("is not connected initially", () => {
    const t = createTransport({ type: "http", url: "http://localhost:3000" });
    expect(t.isConnected()).toBe(false);
  });

  it("listTools throws when not connected", async () => {
    const t = createTransport({ type: "http", url: "http://localhost:3000" });
    await expect(t.listTools()).rejects.toThrow(/not connected/);
  });

  it("callTool throws when not connected", async () => {
    const t = createTransport({ type: "http", url: "http://localhost:3000" });
    await expect(t.callTool("test", {})).rejects.toThrow(/not connected/);
  });

  it("disconnect is safe when not connected", async () => {
    const t = createTransport({ type: "http", url: "http://localhost:3000" });
    await t.disconnect();
    expect(t.isConnected()).toBe(false);
  });

  it("connect fails on HTTP error", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
    });

    const t = createTransport({ type: "http", url: "http://localhost:3000" });

    await expect(t.connect()).rejects.toThrow(/failed with status 500/);
    expect(t.isConnected()).toBe(false);

    globalThis.fetch = originalFetch;
  });

  it("connect succeeds with valid initialize response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers(),
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          protocolVersion: "2024-11-05",
          capabilities: {},
          serverInfo: { name: "test-server", version: "1.0" },
        },
      }),
    });

    const t = createTransport({ type: "http", url: "http://localhost:3000" });
    await t.connect();
    expect(t.isConnected()).toBe(true);

    await t.disconnect();
    expect(t.isConnected()).toBe(false);

    globalThis.fetch = originalFetch;
  });
});

// ============================================================================
// SSE Transport Tests
// ============================================================================

describe("SseTransport", () => {
  it("is not connected initially", () => {
    const t = createTransport({ type: "sse", url: "http://localhost:3000/sse" });
    expect(t.isConnected()).toBe(false);
  });

  it("listTools throws when not connected", async () => {
    const t = createTransport({ type: "sse", url: "http://localhost:3000/sse" });
    await expect(t.listTools()).rejects.toThrow(/not connected/);
  });

  it("disconnect clears state", async () => {
    const t = createTransport({ type: "sse", url: "http://localhost:3000/sse" });
    await t.disconnect();
    expect(t.isConnected()).toBe(false);
  });
});

// ============================================================================
// WebSocket Transport Tests
// ============================================================================

describe("WebSocketTransport", () => {
  it("is not connected initially", () => {
    const t = createTransport({ type: "websocket", url: "ws://localhost:3000/ws" });
    expect(t.isConnected()).toBe(false);
  });

  it("listTools throws when not connected", async () => {
    const t = createTransport({ type: "websocket", url: "ws://localhost:3000/ws" });
    await expect(t.listTools()).rejects.toThrow(/not connected/);
  });

  it("callTool throws when not connected", async () => {
    const t = createTransport({ type: "websocket", url: "ws://localhost:3000/ws" });
    await expect(t.callTool("test", {})).rejects.toThrow(/not connected/);
  });

  it("disconnect is safe when not connected", async () => {
    const t = createTransport({ type: "websocket", url: "ws://localhost:3000/ws" });
    await t.disconnect();
    expect(t.isConnected()).toBe(false);
  });
});

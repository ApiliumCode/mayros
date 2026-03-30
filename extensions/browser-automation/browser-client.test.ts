/**
 * BrowserClient Tests
 *
 * Tests cover:
 * - connect() fetches CDP endpoint and opens WebSocket
 * - listPages() parses JSON response
 * - navigate() sends correct CDP command
 * - screenshot() returns base64 data
 * - click() evaluates querySelector
 * - type() dispatches key events
 * - evaluate() sends Runtime.evaluate
 * - getContent() returns HTML
 * - disconnect() closes WebSocket
 * - Throws clear error when ws not available
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { BrowserClient } from "./browser-client.js";

// ============================================================================
// Mock WebSocket
// ============================================================================

class MockWebSocket {
  private listeners = new Map<string, Array<(...args: unknown[]) => void>>();
  public readyState = 1; // OPEN
  public closed = false;
  public sentMessages: string[] = [];

  on(event: string, handler: (...args: unknown[]) => void) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, []);
    }
    this.listeners.get(event)!.push(handler);
    // Auto-fire "open" event
    if (event === "open") {
      setTimeout(() => handler(), 0);
    }
  }

  send(data: string) {
    this.sentMessages.push(data);
    // Auto-respond to CDP commands
    const msg = JSON.parse(data) as { id: number; method: string };
    setTimeout(() => {
      this.emit("message", JSON.stringify(buildCdpResponse(msg.id, msg.method)));
    }, 0);
  }

  close() {
    this.closed = true;
  }

  private emit(event: string, ...args: unknown[]) {
    const handlers = this.listeners.get(event) ?? [];
    for (const handler of handlers) {
      handler(...args);
    }
  }
}

/** Build a mock CDP response for a given method. */
function buildCdpResponse(
  id: number,
  method: string,
): { id: number; result: Record<string, unknown> } {
  switch (method) {
    case "Page.navigate":
      return { id, result: { frameId: "frame-1", loaderId: "loader-1" } };
    case "Page.captureScreenshot":
      return { id, result: { data: "iVBORw0KGgoAAAANS==" } };
    case "Page.getLayoutMetrics":
      return {
        id,
        result: {
          cssVisualViewport: { clientWidth: 1920, clientHeight: 1080 },
        },
      };
    case "Runtime.evaluate":
      return {
        id,
        result: {
          result: {
            value: JSON.stringify({ title: "Example", url: "https://example.com" }),
          },
        },
      };
    case "Input.dispatchKeyEvent":
      return { id, result: {} };
    default:
      return { id, result: {} };
  }
}

// ============================================================================
// Mock fetch and ws module
// ============================================================================

let mockWsInstance: MockWebSocket;

beforeEach(() => {
  mockWsInstance = new MockWebSocket();

  // Mock global fetch
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string) => {
      if (url.includes("/json/version")) {
        return {
          ok: true,
          json: async () => ({
            webSocketDebuggerUrl: "ws://localhost:9222/devtools/browser/abc",
          }),
        };
      }
      if (url.includes("/json/list")) {
        return {
          ok: true,
          json: async () => [
            { id: "page-1", url: "https://example.com", title: "Example", type: "page" },
            { id: "page-2", url: "about:blank", title: "New Tab", type: "page" },
            {
              id: "ext-1",
              url: "chrome-extension://abc",
              title: "Extension",
              type: "background_page",
            },
          ],
        };
      }
      return { ok: false, status: 404 };
    }),
  );

  // Mock ws module via vi.mock
  vi.mock("ws", () => {
    return {
      default: class {
        constructor() {
          // Return mock instance
          return mockWsInstance as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      },
      WebSocket: class {
        constructor() {
          return mockWsInstance as any; // eslint-disable-line @typescript-eslint/no-explicit-any
        }
      },
    };
  });
});

// ============================================================================
// Tests
// ============================================================================

describe("BrowserClient", () => {
  it("connect() fetches CDP endpoint and opens WebSocket", async () => {
    const client = new BrowserClient({ cdpUrl: "http://localhost:9222" });
    await client.connect();

    expect(fetch).toHaveBeenCalledWith("http://localhost:9222/json/version");
    await client.disconnect();
  });

  it("listPages() parses JSON response and filters pages", async () => {
    const client = new BrowserClient();
    const pages = await client.listPages();

    expect(fetch).toHaveBeenCalledWith("http://localhost:9222/json/list");
    expect(pages).toHaveLength(2);
    expect(pages[0]).toEqual({
      id: "page-1",
      url: "https://example.com",
      title: "Example",
    });
    expect(pages[1]).toEqual({
      id: "page-2",
      url: "about:blank",
      title: "New Tab",
    });
  });

  it("navigate() sends Page.navigate CDP command", async () => {
    const client = new BrowserClient();
    await client.connect();

    const result = await client.navigate("https://example.com");

    const sent = mockWsInstance.sentMessages.map((m) => JSON.parse(m) as { method: string });
    const navigateCmd = sent.find((m) => m.method === "Page.navigate");
    expect(navigateCmd).toBeDefined();
    expect(result.url).toBeDefined();

    await client.disconnect();
  });

  it("screenshot() returns base64 data with dimensions", async () => {
    const client = new BrowserClient();
    await client.connect();

    const result = await client.screenshot();

    expect(result.data).toBe("iVBORw0KGgoAAAANS==");
    expect(result.format).toBe("png");
    expect(result.width).toBe(1920);
    expect(result.height).toBe(1080);

    await client.disconnect();
  });

  it("click() evaluates querySelector on the page", async () => {
    const client = new BrowserClient();
    await client.connect();

    await client.click("#submit-btn");

    const sent = mockWsInstance.sentMessages.map(
      (m) => JSON.parse(m) as { method: string; params: Record<string, unknown> },
    );
    const evalCmd = sent.find(
      (m) =>
        m.method === "Runtime.evaluate" && String(m.params.expression).includes("querySelector"),
    );
    expect(evalCmd).toBeDefined();
    expect(String(evalCmd!.params.expression)).toContain("#submit-btn");

    await client.disconnect();
  });

  it("type() dispatches key events for each character", async () => {
    const client = new BrowserClient();
    await client.connect();

    await client.type("ab");

    const sent = mockWsInstance.sentMessages.map(
      (m) => JSON.parse(m) as { method: string; params: Record<string, unknown> },
    );
    const keyEvents = sent.filter((m) => m.method === "Input.dispatchKeyEvent");
    // 2 chars x 2 events (keyDown + keyUp) = 4
    expect(keyEvents).toHaveLength(4);
    expect(keyEvents[0].params.text).toBe("a");
    expect(keyEvents[0].params.type).toBe("keyDown");
    expect(keyEvents[1].params.type).toBe("keyUp");
    expect(keyEvents[2].params.text).toBe("b");

    await client.disconnect();
  });

  it("evaluate() sends Runtime.evaluate and returns value", async () => {
    const client = new BrowserClient();
    await client.connect();

    const result = await client.evaluate("document.title");

    const sent = mockWsInstance.sentMessages.map(
      (m) => JSON.parse(m) as { method: string; params: Record<string, unknown> },
    );
    const evalCmd = sent.find(
      (m) => m.method === "Runtime.evaluate" && m.params.expression === "document.title",
    );
    expect(evalCmd).toBeDefined();
    expect(result).toBeDefined();

    await client.disconnect();
  });

  it("getContent() returns HTML content", async () => {
    const client = new BrowserClient();
    await client.connect();

    const content = await client.getContent();

    const sent = mockWsInstance.sentMessages.map(
      (m) => JSON.parse(m) as { method: string; params: Record<string, unknown> },
    );
    const evalCmd = sent.find(
      (m) => m.method === "Runtime.evaluate" && String(m.params.expression).includes("outerHTML"),
    );
    expect(evalCmd).toBeDefined();
    expect(typeof content).toBe("string");

    await client.disconnect();
  });

  it("disconnect() closes WebSocket connection", async () => {
    const client = new BrowserClient();
    await client.connect();
    expect(mockWsInstance.closed).toBe(false);

    await client.disconnect();
    expect(mockWsInstance.closed).toBe(true);
  });

  it("sendCommand throws when not connected", async () => {
    const client = new BrowserClient();

    // navigate() calls sendCommand internally, which should throw
    await expect(client.navigate("https://example.com")).rejects.toThrow("Not connected");
  });
});

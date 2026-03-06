import { describe, it, expect, vi, beforeEach } from "vitest";
import { MayrosClient } from "./index.js";
import type { SdkEvent } from "./types.js";

// Mock gateway-chat module with a class-based mock
const mockClient = {
  start: vi.fn(),
  stop: vi.fn(),
  waitForReady: vi.fn().mockResolvedValue(undefined),
  sendChat: vi.fn().mockResolvedValue({ runId: "test-run" }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [] }),
  onEvent: null as ((event: { event: string; payload?: unknown }) => void) | null,
  onDisconnected: null as ((reason?: string) => void) | null,
};

vi.mock("../tui/gateway-chat.js", () => {
  // Use a real constructor function so `new` works
  function MockGatewayChatClient() {
    return mockClient;
  }
  return {
    GatewayChatClient: MockGatewayChatClient,
    resolveGatewayConnection: vi.fn((opts: Record<string, unknown>) => ({
      url: opts?.url ?? "ws://localhost:3000",
      token: opts?.token ?? "test",
    })),
  };
});

describe("MayrosClient", () => {
  let client: MayrosClient;

  beforeEach(() => {
    vi.clearAllMocks();
    mockClient.onEvent = null;
    mockClient.onDisconnected = null;
    client = new MayrosClient({ url: "ws://test:3000", token: "tok" });
  });

  describe("constructor", () => {
    it("creates client with default options", () => {
      const c = new MayrosClient();
      expect(c).toBeInstanceOf(MayrosClient);
    });

    it("accepts custom options", () => {
      const c = new MayrosClient({
        url: "ws://custom:4000",
        token: "my-token",
        session: "my-session",
        thinking: "extended",
        timeoutMs: 5000,
      });
      expect(c).toBeInstanceOf(MayrosClient);
    });
  });

  describe("connect / disconnect", () => {
    it("connects to gateway", async () => {
      await client.connect();
      expect(mockClient.start).toHaveBeenCalled();
      expect(mockClient.waitForReady).toHaveBeenCalled();
    });

    it("connect is idempotent", async () => {
      await client.connect();
      await client.connect();
      expect(mockClient.start).toHaveBeenCalledTimes(1);
    });

    it("disconnects cleanly", async () => {
      await client.connect();
      await client.disconnect();
      expect(mockClient.stop).toHaveBeenCalled();
    });

    it("disconnect is safe when not connected", async () => {
      await expect(client.disconnect()).resolves.toBeUndefined();
    });
  });

  describe("sendMessage", () => {
    it("throws if not connected", async () => {
      const gen = client.sendMessage("hello");
      await expect(gen.next()).rejects.toThrow("Not connected");
    });

    it("yields text events from gateway", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.delta",
            payload: { text: "Hello" },
          });
          mockClient.onEvent?.({
            event: "chat.delta",
            payload: { text: " world" },
          });
          mockClient.onEvent?.({
            event: "chat.final",
            payload: {
              usage: { inputTokens: 10, outputTokens: 5 },
            },
          });
        }, 10);
        return { runId: "run-1" };
      });

      const events: SdkEvent[] = [];
      for await (const evt of client.sendMessage("hi")) {
        events.push(evt);
      }

      expect(events).toHaveLength(3);
      expect(events[0]).toEqual({ type: "text", text: "Hello" });
      expect(events[1]).toEqual({ type: "text", text: " world" });
      expect(events[2]).toEqual({
        type: "done",
        usage: { inputTokens: 10, outputTokens: 5 },
      });
    });

    it("yields tool_use events", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.tool_use",
            payload: { name: "search", args: { query: "test" } },
          });
          mockClient.onEvent?.({
            event: "chat.final",
            payload: {},
          });
        }, 10);
        return { runId: "run-tool" };
      });

      const events: SdkEvent[] = [];
      for await (const evt of client.sendMessage("search for something")) {
        events.push(evt);
      }

      expect(events[0]).toEqual({
        type: "tool_use",
        name: "search",
        args: { query: "test" },
      });
    });

    it("yields tool_result events", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.tool_result",
            payload: { name: "search", result: { items: [] } },
          });
          mockClient.onEvent?.({
            event: "chat.final",
            payload: {},
          });
        }, 10);
        return { runId: "run-result" };
      });

      const events: SdkEvent[] = [];
      for await (const evt of client.sendMessage("hi")) {
        events.push(evt);
      }

      expect(events[0]).toEqual({
        type: "tool_result",
        name: "search",
        result: { items: [] },
      });
    });

    it("yields thinking events", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.thinking",
            payload: { text: "Let me think..." },
          });
          mockClient.onEvent?.({
            event: "chat.final",
            payload: {},
          });
        }, 10);
        return { runId: "run-think" };
      });

      const events: SdkEvent[] = [];
      for await (const evt of client.sendMessage("hi")) {
        events.push(evt);
      }

      expect(events[0]).toEqual({
        type: "thinking",
        text: "Let me think...",
      });
    });

    it("yields error event on chat error", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.error",
            payload: { message: "Rate limited" },
          });
        }, 10);
        return { runId: "run-2" };
      });

      const events: SdkEvent[] = [];
      for await (const evt of client.sendMessage("hi")) {
        events.push(evt);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "error", message: "Rate limited" });
    });

    it("yields error event on chat.aborted", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.aborted",
            payload: {},
          });
        }, 10);
        return { runId: "run-abort" };
      });

      const events: SdkEvent[] = [];
      for await (const evt of client.sendMessage("hi")) {
        events.push(evt);
      }

      expect(events).toHaveLength(1);
      expect(events[0]).toEqual({ type: "error", message: "Aborted" });
    });

    it("throws on unexpected disconnect", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onDisconnected?.("connection lost");
        }, 10);
        return { runId: "run-dc" };
      });

      const events: SdkEvent[] = [];
      await expect(async () => {
        for await (const evt of client.sendMessage("hi")) {
          events.push(evt);
        }
      }).rejects.toThrow("Gateway disconnected unexpectedly");
    });

    it("skips empty text deltas", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.delta",
            payload: { text: "" },
          });
          mockClient.onEvent?.({
            event: "chat.delta",
            payload: { text: "content" },
          });
          mockClient.onEvent?.({
            event: "chat.final",
            payload: {},
          });
        }, 10);
        return { runId: "run-empty" };
      });

      const events: SdkEvent[] = [];
      for await (const evt of client.sendMessage("hi")) {
        events.push(evt);
      }

      expect(events).toHaveLength(2);
      expect(events[0]).toEqual({ type: "text", text: "content" });
    });
  });

  describe("sendMessageFull", () => {
    it("collects all text into a string", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.delta",
            payload: { text: "Hello" },
          });
          mockClient.onEvent?.({
            event: "chat.delta",
            payload: { text: " world" },
          });
          mockClient.onEvent?.({
            event: "chat.final",
            payload: {},
          });
        }, 10);
        return { runId: "run-3" };
      });

      const result = await client.sendMessageFull("hi");
      expect(result).toBe("Hello world");
    });

    it("throws on error event", async () => {
      await client.connect();

      mockClient.sendChat.mockImplementation(async () => {
        setTimeout(() => {
          mockClient.onEvent?.({
            event: "chat.error",
            payload: { message: "Failed" },
          });
        }, 10);
        return { runId: "run-4" };
      });

      await expect(client.sendMessageFull("hi")).rejects.toThrow("Failed");
    });
  });

  describe("abort", () => {
    it("disconnects on abort", async () => {
      await client.connect();
      await client.abort();
      expect(mockClient.stop).toHaveBeenCalled();
    });

    it("abort is safe when not connected", async () => {
      await expect(client.abort()).resolves.toBeUndefined();
    });
  });

  describe("listSessions", () => {
    it("throws if not connected", async () => {
      await expect(client.listSessions()).rejects.toThrow("Not connected");
    });

    it("returns sessions from gateway", async () => {
      await client.connect();
      const result = await client.listSessions();
      expect(result).toEqual({ sessions: [] });
    });
  });
});

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mock node:crypto, node:fs, node:os for device identity             */
/* ------------------------------------------------------------------ */

vi.mock("node:crypto", () => ({
  default: {
    createPublicKey: vi.fn(() => ({
      export: vi.fn(() => Buffer.alloc(44)), // dummy SPKI
    })),
    createPrivateKey: vi.fn(() => ({})),
    sign: vi.fn(() => Buffer.from("mock-signature")),
  },
}));

vi.mock("node:fs", () => ({
  default: {
    existsSync: vi.fn(() => false),
    readFileSync: vi.fn(() => "{}"),
    mkdirSync: vi.fn(),
    writeFileSync: vi.fn(),
  },
}));

vi.mock("node:path", () => ({
  default: {
    join: vi.fn((...parts: string[]) => parts.join("/")),
    dirname: vi.fn((p: string) => p.split("/").slice(0, -1).join("/")),
  },
}));

vi.mock("node:os", () => ({
  default: {
    homedir: vi.fn(() => "/mock-home"),
  },
}));

import { MayrosClient, type IWebSocket, type WebSocketFactory } from "../src/mayros-client.js";

/* ------------------------------------------------------------------ */
/*  Mock WebSocket                                                     */
/* ------------------------------------------------------------------ */

type CloseHandler = (ev: { code: number; reason: string }) => void;
type MessageHandler = (ev: { data: string }) => void;

class MockWebSocket implements IWebSocket {
  readyState = 0; // CONNECTING
  onopen: ((ev: unknown) => void) | null = null;
  onclose: CloseHandler | null = null;
  onmessage: MessageHandler | null = null;
  onerror: ((ev: unknown) => void) | null = null;

  sent: string[] = [];

  send(data: string): void {
    this.sent.push(data);
  }

  close(_code?: number, _reason?: string): void {
    this.readyState = 3; // CLOSED
  }

  // Test helpers
  simulateOpen(): void {
    this.readyState = 1; // OPEN
    this.onopen?.(new Event("open"));
  }

  simulateClose(code = 1000, reason = "normal"): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }

  simulateMessage(data: string): void {
    this.onmessage?.({ data });
  }

  simulateError(error: Error): void {
    this.onerror?.(error);
  }

  /** Simulate the gateway challenge-response handshake. */
  simulateHandshake(): void {
    // 1. Send connect.challenge event
    this.simulateMessage(
      JSON.stringify({
        type: "event",
        event: "connect.challenge",
        payload: { nonce: "test-nonce-123", ts: Date.now() },
      }),
    );

    // 2. The client should have sent a connect request — find its id
    const connectMsg = this.sent.find((s) => {
      try {
        const m = JSON.parse(s);
        return m.method === "connect";
      } catch {
        return false;
      }
    });
    if (!connectMsg) return;

    const parsed = JSON.parse(connectMsg);

    // 3. Respond with hello-ok
    this.simulateMessage(
      JSON.stringify({
        type: "res",
        id: parsed.id,
        ok: true,
        payload: { type: "hello-ok", protocol: 3, server: { version: "test" } },
      }),
    );
  }

  /** simulateOpen + simulateHandshake in one step */
  simulateFullConnect(): void {
    this.simulateOpen();
    this.simulateHandshake();
  }

  /** Get sent messages after the handshake connect request (domain RPCs only). */
  getSentAfterHandshake(): string[] {
    const handshakeIdx = this.sent.findIndex((s) => {
      try {
        return JSON.parse(s).method === "connect";
      } catch {
        return false;
      }
    });
    return handshakeIdx >= 0 ? this.sent.slice(handshakeIdx + 1) : this.sent;
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function createFactory(): { factory: WebSocketFactory; lastWs: () => MockWebSocket } {
  let last: MockWebSocket;
  const factory: WebSocketFactory = (_url: string) => {
    last = new MockWebSocket();
    return last;
  };
  return { factory, lastWs: () => last! };
}

function createClient(
  factory: WebSocketFactory,
  overrides?: Partial<{ maxReconnectAttempts: number; reconnectDelayMs: number }>,
): MayrosClient {
  return new MayrosClient(
    "ws://127.0.0.1:18789",
    {
      maxReconnectAttempts: overrides?.maxReconnectAttempts ?? 3,
      reconnectDelayMs: overrides?.reconnectDelayMs ?? 10,
      requestTimeoutMs: 500,
    },
    factory,
  );
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("MayrosClient", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /* -- Constructor & state -- */

  it("initializes in disconnected state", () => {
    const { factory } = createFactory();
    const client = createClient(factory);
    expect(client.connected).toBe(false);
  });

  /* -- Connect -- */

  it("connects successfully after handshake", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    expect(client.connected).toBe(true);
  });

  it("emits 'connected' event on successful connect", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);
    const handler = vi.fn();
    client.on("connected", handler);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    expect(handler).toHaveBeenCalledOnce();
  });

  it("rejects connect when WS fires onerror before open", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateError(new Error("ECONNREFUSED"));

    await expect(p).rejects.toThrow("ECONNREFUSED");
    expect(client.connected).toBe(false);
  });

  it("does nothing if already connected", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p1 = client.connect();
    lastWs().simulateFullConnect();
    await p1;

    // Second connect should resolve immediately
    await client.connect();
    expect(client.connected).toBe(true);
  });

  it("throws if client is disposed", async () => {
    const { factory } = createFactory();
    const client = createClient(factory);
    client.dispose();

    await expect(client.connect()).rejects.toThrow("Client is disposed");
  });

  it("sends connect request with protocol version after challenge", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const connectMsg = lastWs().sent.find((s) => {
      try {
        return JSON.parse(s).method === "connect";
      } catch {
        return false;
      }
    });
    expect(connectMsg).toBeDefined();
    const parsed = JSON.parse(connectMsg!);
    expect(parsed.params.minProtocol).toBe(3);
    expect(parsed.params.maxProtocol).toBe(3);
    expect(parsed.params.client.id).toBe("gateway-client");
    expect(parsed.params.role).toBe("operator");
    expect(parsed.params.scopes).toEqual(["operator.read", "operator.write"]);
  });

  /* -- Disconnect -- */

  it("disconnects and emits 'disconnected' event", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);
    const handler = vi.fn();
    client.on("disconnected", handler);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    await client.disconnect();
    expect(client.connected).toBe(false);
    expect(handler).toHaveBeenCalledWith("Client disconnect");
  });

  it("disconnect is safe to call when not connected", async () => {
    const { factory } = createFactory();
    const client = createClient(factory);
    await client.disconnect(); // should not throw
    expect(client.connected).toBe(false);
  });

  /* -- RPC call -- */

  it("sends JSON-RPC request and resolves with result", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.listSessions();

    // Parse the sent request (after handshake)
    const domainSent = lastWs().getSentAfterHandshake();
    const sent = JSON.parse(domainSent[0]);
    expect(sent.method).toBe("sessions.list");
    expect(sent.id).toBeDefined();

    // Simulate response
    lastWs().simulateMessage(
      JSON.stringify({
        type: "res",
        id: sent.id,
        ok: true,
        payload: {
          sessions: [
            {
              key: "s1",
              kind: "direct",
              displayName: "test",
              updatedAt: Date.now(),
              totalTokens: 5,
            },
          ],
        },
      }),
    );

    const sessions = await resultP;
    expect(sessions).toHaveLength(1);
    expect(sessions[0].id).toBe("s1");
  });

  it("rejects RPC call when not connected", async () => {
    const { factory } = createFactory();
    const client = createClient(factory);

    await expect(client.listSessions()).rejects.toThrow("Not connected");
  });

  it("rejects RPC call when gateway returns error", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.getHealth();
    const domainSent = lastWs().getSentAfterHandshake();
    const sent = JSON.parse(domainSent[0]);

    lastWs().simulateMessage(
      JSON.stringify({
        type: "res",
        id: sent.id,
        ok: false,
        error: { code: -32600, message: "Invalid request" },
      }),
    );

    await expect(resultP).rejects.toThrow("Gateway error -32600: Invalid request");
  });

  it("times out pending requests", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.getHealth();

    // Advance past the request timeout (500ms)
    vi.advanceTimersByTime(600);

    await expect(resultP).rejects.toThrow("timed out");
  });

  /* -- Event handling -- */

  it("dispatches server-push events to subscribers", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const handler = vi.fn();
    client.on("event:chat.message", handler);

    lastWs().simulateMessage(
      JSON.stringify({
        event: "chat.message",
        data: { sessionId: "s1", content: "hello" },
      }),
    );

    expect(handler).toHaveBeenCalledWith({ sessionId: "s1", content: "hello" });
  });

  it("dispatches generic event listener", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const handler = vi.fn();
    client.on("event", handler);

    const evt = { event: "trace.event", data: { id: "t1" } };
    lastWs().simulateMessage(JSON.stringify(evt));

    expect(handler).toHaveBeenCalledWith(evt);
  });

  it("unsubscribes event handler with off()", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const handler = vi.fn();
    client.on("event:test", handler);
    client.off("event:test", handler);

    lastWs().simulateMessage(JSON.stringify({ event: "test", data: {} }));
    expect(handler).not.toHaveBeenCalled();
  });

  it("ignores malformed messages", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    // Should not throw
    lastWs().simulateMessage("not json at all {{{");
    expect(client.connected).toBe(true);
  });

  /* -- Reconnection -- */

  it("schedules reconnection after unexpected close", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    const ws1 = lastWs();
    ws1.simulateFullConnect();
    await p;

    const disconnectHandler = vi.fn();
    client.on("disconnected", disconnectHandler);

    // Simulate unexpected close
    ws1.simulateClose(1006, "abnormal");

    expect(client.connected).toBe(false);
    expect(disconnectHandler).toHaveBeenCalledWith("abnormal");

    // A reconnect attempt should be scheduled
    // Advance timer to trigger first reconnect (delay = 10 * 2^0 = 10ms)
    vi.advanceTimersByTime(15);

    // A new WebSocket should have been created
    expect(lastWs()).not.toBe(ws1);
  });

  it("emits error and stops after exceeding max reconnect attempts", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory, { maxReconnectAttempts: 0, reconnectDelayMs: 10 });

    const errorHandler = vi.fn();
    client.on("error", errorHandler);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    // Now close — since maxReconnectAttempts is 0, scheduleReconnect should
    // immediately emit error without scheduling any timer
    lastWs().simulateClose(1006, "lost");

    expect(errorHandler).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("Reconnection failed after 0 attempts"),
      }),
    );
  });

  it("rejects all pending requests on connection close", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.listAgents();

    // Close the connection
    lastWs().simulateClose(1006, "lost");

    await expect(resultP).rejects.toThrow("Connection closed");
  });

  /* -- Domain methods -- */

  it("sendMessage calls chat.send with correct params", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.sendMessage("s1", "hello world");
    const domainSent = lastWs().getSentAfterHandshake();
    const sent = JSON.parse(domainSent[0]);
    expect(sent.method).toBe("chat.send");
    expect(sent.params.sessionKey).toBe("s1");
    expect(sent.params.message).toBe("hello world");

    lastWs().simulateMessage(
      JSON.stringify({ type: "res", id: sent.id, ok: true, payload: undefined }),
    );
    await resultP;
  });

  it("getChatHistory calls chat.history", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.getChatHistory("s1");
    const domainSent = lastWs().getSentAfterHandshake();
    const sent = JSON.parse(domainSent[0]);
    expect(sent.method).toBe("chat.history");
    expect(sent.params).toEqual({ sessionKey: "s1" });

    lastWs().simulateMessage(
      JSON.stringify({ type: "res", id: sent.id, ok: true, payload: { messages: [] } }),
    );
    const result = await resultP;
    expect(result).toEqual([]);
  });

  it("queryKg passes query and optional limit", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.queryKg("project:*", 25);
    const domainSent = lastWs().getSentAfterHandshake();
    const sent = JSON.parse(domainSent[0]);
    expect(sent.method).toBe("kg.query");
    expect(sent.params).toEqual({ query: "project:*", limit: 25 });

    lastWs().simulateMessage(
      JSON.stringify({
        type: "res",
        id: sent.id,
        ok: true,
        payload: [{ subject: "s", predicate: "p", object: "o", id: "1" }],
      }),
    );
    const entries = await resultP;
    expect(entries).toHaveLength(1);
  });

  it("getTraceEvents passes options correctly", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.getTraceEvents({ agentId: "agent-1", limit: 50 });
    const domainSent = lastWs().getSentAfterHandshake();
    const sent = JSON.parse(domainSent[0]);
    expect(sent.method).toBe("trace.events");
    expect(sent.params).toEqual({ agentId: "agent-1", limit: 50 });

    lastWs().simulateMessage(JSON.stringify({ type: "res", id: sent.id, ok: true, payload: [] }));
    await resultP;
  });

  it("getPlan calls plan.get with sessionId", async () => {
    const { factory, lastWs } = createFactory();
    const client = createClient(factory);

    const p = client.connect();
    lastWs().simulateFullConnect();
    await p;

    const resultP = client.getPlan("s1");
    const domainSent = lastWs().getSentAfterHandshake();
    const sent = JSON.parse(domainSent[0]);
    expect(sent.method).toBe("plan.get");
    expect(sent.params).toEqual({ sessionId: "s1" });

    lastWs().simulateMessage(JSON.stringify({ type: "res", id: sent.id, ok: true, payload: null }));
    const plan = await resultP;
    expect(plan).toBeUndefined();
  });
});

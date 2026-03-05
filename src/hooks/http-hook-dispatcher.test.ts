import { describe, expect, it, vi, beforeEach } from "vitest";
import { HttpHookDispatcher, createHttpHookDispatcher } from "./http-hook-dispatcher.js";
import type { HttpHookTarget, HttpHookDispatcherOptions } from "./http-hook-dispatcher.js";

type TestLogger = NonNullable<HttpHookDispatcherOptions["logger"]>;

function mockFetch(status = 200) {
  return vi.fn().mockResolvedValue({ ok: status >= 200 && status < 300, status });
}

describe("HttpHookDispatcher", () => {
  let fetchFn: ReturnType<typeof mockFetch>;
  let logger: TestLogger;

  beforeEach(() => {
    fetchFn = mockFetch();
    logger = {
      debug: vi.fn<(msg: string) => void>(),
      warn: vi.fn<(msg: string) => void>(),
      error: vi.fn<(msg: string) => void>(),
    };
  });

  it("dispatches POST to matching targets", async () => {
    const target: HttpHookTarget = { url: "https://example.com/webhook" };
    const dispatcher = new HttpHookDispatcher({ targets: [target], fetchFn, logger });

    dispatcher.dispatch("agent_end", { success: true });
    await dispatcher.drain();

    expect(fetchFn).toHaveBeenCalledOnce();
    const [url, opts] = fetchFn.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://example.com/webhook");
    expect(opts.method).toBe("POST");
    const body = JSON.parse(opts.body as string);
    expect(body.event).toBe("agent_end");
    expect(body.data).toEqual({ success: true });
    expect(body.timestamp).toBeDefined();
  });

  it("filters targets by event list", async () => {
    const targets: HttpHookTarget[] = [
      { url: "https://a.com/hook", events: ["agent_end"] },
      { url: "https://b.com/hook", events: ["session_start"] },
    ];
    const dispatcher = new HttpHookDispatcher({ targets, fetchFn, logger });

    dispatcher.dispatch("agent_end", {});
    await dispatcher.drain();

    expect(fetchFn).toHaveBeenCalledOnce();
    expect((fetchFn.mock.calls[0] as [string])[0]).toBe("https://a.com/hook");
  });

  it("sends to all targets when events is empty", async () => {
    const targets: HttpHookTarget[] = [
      { url: "https://a.com/hook", events: [] },
      { url: "https://b.com/hook" },
    ];
    const dispatcher = new HttpHookDispatcher({ targets, fetchFn, logger });

    dispatcher.dispatch("anything", {});
    await dispatcher.drain();

    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("includes HMAC signature when secret is configured", async () => {
    const target: HttpHookTarget = { url: "https://example.com/hook", secret: "my-secret" };
    const dispatcher = new HttpHookDispatcher({ targets: [target], fetchFn, logger });

    dispatcher.dispatch("test_event", { key: "value" });
    await dispatcher.drain();

    const [, opts] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Mayros-Signature"]).toMatch(/^sha256=[0-9a-f]{64}$/);
  });

  it("includes X-Mayros-Event header", async () => {
    const target: HttpHookTarget = { url: "https://example.com/hook" };
    const dispatcher = new HttpHookDispatcher({ targets: [target], fetchFn, logger });

    dispatcher.dispatch("session_end", {});
    await dispatcher.drain();

    const [, opts] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["X-Mayros-Event"]).toBe("session_end");
  });

  it("includes custom headers from target config", async () => {
    const target: HttpHookTarget = {
      url: "https://example.com/hook",
      headers: { Authorization: "Bearer token123" },
    };
    const dispatcher = new HttpHookDispatcher({ targets: [target], fetchFn, logger });

    dispatcher.dispatch("test", {});
    await dispatcher.drain();

    const [, opts] = fetchFn.mock.calls[0] as [string, RequestInit];
    const headers = opts.headers as Record<string, string>;
    expect(headers["Authorization"]).toBe("Bearer token123");
  });

  it("does not retry on 4xx errors", async () => {
    fetchFn = mockFetch(400);
    const target: HttpHookTarget = { url: "https://example.com/hook", retries: 3 };
    const dispatcher = new HttpHookDispatcher({ targets: [target], fetchFn, logger });

    dispatcher.dispatch("test", {});
    await dispatcher.drain();

    expect(fetchFn).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalled();
  });

  it("retries on 5xx errors up to max retries", async () => {
    fetchFn = mockFetch(503);
    const target: HttpHookTarget = { url: "https://example.com/hook", retries: 1, timeoutMs: 100 };
    const dispatcher = new HttpHookDispatcher({ targets: [target], fetchFn, logger });

    dispatcher.dispatch("test", {});
    await dispatcher.drain();

    // 1 initial + 1 retry = 2
    expect(fetchFn).toHaveBeenCalledTimes(2);
  });

  it("retries on network errors", async () => {
    fetchFn = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    const target: HttpHookTarget = { url: "https://example.com/hook", retries: 1, timeoutMs: 100 };
    const dispatcher = new HttpHookDispatcher({ targets: [target], fetchFn, logger });

    dispatcher.dispatch("test", {});
    await dispatcher.drain();

    expect(fetchFn).toHaveBeenCalledTimes(2);
    expect(logger.error).toHaveBeenCalled();
  });

  it("skips targets with empty URL", () => {
    const dispatcher = new HttpHookDispatcher({
      targets: [{ url: "" }, { url: "https://valid.com/hook" }],
      fetchFn,
      logger,
    });
    expect(dispatcher.targetCount).toBe(1);
  });

  it("hasTargetsFor returns correct results", () => {
    const targets: HttpHookTarget[] = [
      { url: "https://a.com/hook", events: ["agent_end", "session_start"] },
    ];
    const dispatcher = new HttpHookDispatcher({ targets, fetchFn, logger });

    expect(dispatcher.hasTargetsFor("agent_end")).toBe(true);
    expect(dispatcher.hasTargetsFor("unknown_event")).toBe(false);
  });

  it("dispatch is a no-op with no targets", async () => {
    const dispatcher = new HttpHookDispatcher({ targets: [], fetchFn, logger });
    dispatcher.dispatch("test", {});
    await dispatcher.drain();
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it("createHttpHookDispatcher factory works", () => {
    const dispatcher = createHttpHookDispatcher({
      targets: [{ url: "https://example.com" }],
      fetchFn,
    });
    expect(dispatcher).toBeInstanceOf(HttpHookDispatcher);
    expect(dispatcher.targetCount).toBe(1);
  });
});

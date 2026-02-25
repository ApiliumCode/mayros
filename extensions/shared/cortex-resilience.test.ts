import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { CircuitBreaker, resilientFetch } from "./cortex-resilience.js";

// ============================================================================
// CircuitBreaker tests
// ============================================================================

describe("CircuitBreaker", () => {
  it("starts in closed state", () => {
    const cb = new CircuitBreaker();
    expect(cb.getState()).toBe("closed");
    expect(cb.isCallPermitted()).toBe(true);
    expect(cb.getFailures()).toBe(0);
  });

  it("stays closed under threshold", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    expect(cb.isCallPermitted()).toBe(true);
  });

  it("opens after reaching threshold", () => {
    const cb = new CircuitBreaker({ threshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    expect(cb.isCallPermitted()).toBe(false);
  });

  it("calls onOpen callback when circuit opens", () => {
    const onOpen = vi.fn();
    const cb = new CircuitBreaker({ threshold: 2, onOpen });
    cb.recordFailure();
    expect(onOpen).not.toHaveBeenCalled();
    cb.recordFailure();
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("transitions to half-open after resetMs", () => {
    const cb = new CircuitBreaker({ threshold: 1, resetMs: 100 });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    // Simulate time passing
    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    expect(cb.getState()).toBe("half-open");
    expect(cb.isCallPermitted()).toBe(true);
    vi.useRealTimers();
  });

  it("resets to closed after halfOpenSuccessThreshold successes in half-open", () => {
    const cb = new CircuitBreaker({ threshold: 2, halfOpenSuccessThreshold: 2 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    // Simulate half-open after time
    vi.useFakeTimers();
    vi.advanceTimersByTime(35_000);
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess(); // 1st success — still half-open
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess(); // 2nd success — threshold met, closes
    expect(cb.getState()).toBe("closed");
    expect(cb.getFailures()).toBe(0);
    vi.useRealTimers();
  });

  it("single success in half-open stays half-open (default threshold=2)", () => {
    const cb = new CircuitBreaker({ threshold: 1, resetMs: 100 });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("half-open");
    vi.useRealTimers();
  });

  it("closes immediately in half-open when halfOpenSuccessThreshold=1", () => {
    const cb = new CircuitBreaker({ threshold: 1, resetMs: 100, halfOpenSuccessThreshold: 1 });
    cb.recordFailure();

    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    vi.useRealTimers();
  });

  it("failure in half-open resets halfOpenSuccesses counter", () => {
    const cb = new CircuitBreaker({ threshold: 2, resetMs: 100, halfOpenSuccessThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe("open");

    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess(); // 1
    cb.recordSuccess(); // 2
    cb.recordFailure(); // resets counter, re-opens
    expect(cb.getState()).toBe("open");

    vi.advanceTimersByTime(35_000);
    expect(cb.getState()).toBe("half-open");

    // Need full 3 successes again
    cb.recordSuccess();
    cb.recordSuccess();
    expect(cb.getState()).toBe("half-open");
    cb.recordSuccess();
    expect(cb.getState()).toBe("closed");
    vi.useRealTimers();
  });

  it("calls onClose callback when transitioning half-open → closed", () => {
    const onClose = vi.fn();
    const cb = new CircuitBreaker({
      threshold: 1,
      resetMs: 100,
      halfOpenSuccessThreshold: 2,
      onClose,
    });
    cb.recordFailure();

    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    expect(cb.getState()).toBe("half-open");

    cb.recordSuccess();
    expect(onClose).not.toHaveBeenCalled();

    cb.recordSuccess();
    expect(onClose).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("onOpen and onClose fire correctly in sequence", () => {
    const log: string[] = [];
    const cb = new CircuitBreaker({
      threshold: 1,
      resetMs: 100,
      halfOpenSuccessThreshold: 1,
      onOpen: () => log.push("open"),
      onClose: () => log.push("close"),
    });

    cb.recordFailure(); // triggers open
    expect(log).toEqual(["open"]);

    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    cb.getState(); // triggers half-open

    cb.recordSuccess(); // triggers close
    expect(log).toEqual(["open", "close"]);
    vi.useRealTimers();
  });

  it("recordSuccess in closed state does not fire onClose", () => {
    const onClose = vi.fn();
    const cb = new CircuitBreaker({ threshold: 5, onClose });
    cb.recordSuccess();
    expect(onClose).not.toHaveBeenCalled();
    expect(cb.getState()).toBe("closed");
  });

  it("resets via reset()", () => {
    const cb = new CircuitBreaker({ threshold: 1 });
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
    cb.reset();
    expect(cb.getState()).toBe("closed");
    expect(cb.getFailures()).toBe(0);
  });

  it("uses default threshold of 5", () => {
    const cb = new CircuitBreaker();
    for (let i = 0; i < 4; i++) cb.recordFailure();
    expect(cb.getState()).toBe("closed");
    cb.recordFailure();
    expect(cb.getState()).toBe("open");
  });
});

// ============================================================================
// resilientFetch tests
// ============================================================================

describe("resilientFetch", () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("returns response on success", async () => {
    const mockResponse = new Response(JSON.stringify({ ok: true }), { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(mockResponse);

    const res = await resilientFetch("http://localhost/test", { method: "GET" });
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it("retries on 5xx errors", async () => {
    const err500 = new Response("error", { status: 500 });
    const ok200 = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValueOnce(err500).mockResolvedValueOnce(ok200);

    const res = await resilientFetch(
      "http://localhost/test",
      { method: "GET" },
      { maxRetries: 2, retryDelayMs: 1 },
    );
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("retries on network errors", async () => {
    const ok200 = new Response("ok", { status: 200 });
    globalThis.fetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("ECONNREFUSED"))
      .mockResolvedValueOnce(ok200);

    const res = await resilientFetch(
      "http://localhost/test",
      { method: "GET" },
      { maxRetries: 2, retryDelayMs: 1 },
    );
    expect(res.status).toBe(200);
    expect(globalThis.fetch).toHaveBeenCalledTimes(2);
  });

  it("throws after exhausting retries", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      resilientFetch(
        "http://localhost/test",
        { method: "GET" },
        { maxRetries: 1, retryDelayMs: 1 },
      ),
    ).rejects.toThrow("ECONNREFUSED");
    expect(globalThis.fetch).toHaveBeenCalledTimes(2); // initial + 1 retry
  });

  it("rejects immediately when circuit is open", async () => {
    const breaker = new CircuitBreaker({ threshold: 1 });
    breaker.recordFailure();
    expect(breaker.getState()).toBe("open");

    await expect(
      resilientFetch("http://localhost/test", { method: "GET" }, {}, breaker),
    ).rejects.toThrow("Circuit breaker is open");
  });

  it("records success on circuit breaker", async () => {
    const breaker = new CircuitBreaker({ threshold: 3 });
    breaker.recordFailure();

    const ok200 = new Response("ok", { status: 200 });
    globalThis.fetch = vi.fn().mockResolvedValue(ok200);

    await resilientFetch("http://localhost/test", { method: "GET" }, {}, breaker);
    expect(breaker.getFailures()).toBe(0);
    expect(breaker.getState()).toBe("closed");
  });

  it("does not retry on 4xx errors", async () => {
    const err400 = new Response("bad request", { status: 400 });
    globalThis.fetch = vi.fn().mockResolvedValue(err400);

    const res = await resilientFetch(
      "http://localhost/test",
      { method: "GET" },
      { maxRetries: 2, retryDelayMs: 1 },
    );
    expect(res.status).toBe(400);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });
});

import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { HealthMonitor, type HealthStatus } from "./health-monitor.js";

function createMockClient(healthy: boolean) {
  return { isHealthy: vi.fn().mockResolvedValue(healthy) };
}

describe("HealthMonitor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("starts with unknown status", () => {
    const client = createMockClient(true);
    const monitor = new HealthMonitor(client);
    expect(monitor.getStatus()).toBe("unknown");
    expect(monitor.isHealthy()).toBe(false);
  });

  it("probes immediately on start", async () => {
    const client = createMockClient(true);
    const monitor = new HealthMonitor(client);
    monitor.start();

    // Let the immediate probe resolve
    await vi.advanceTimersByTimeAsync(0);

    expect(client.isHealthy).toHaveBeenCalledTimes(1);
    expect(monitor.getStatus()).toBe("healthy");
    expect(monitor.isHealthy()).toBe(true);

    monitor.stop();
  });

  it("transitions healthy → unhealthy on failure", async () => {
    const client = createMockClient(true);
    const onUnhealthy = vi.fn();
    const monitor = new HealthMonitor(client, { onUnhealthy, intervalMs: 1000 });
    monitor.start();

    await vi.advanceTimersByTimeAsync(0); // first probe → healthy
    expect(monitor.getStatus()).toBe("healthy");

    // Next probe fails
    client.isHealthy.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(1000);

    expect(monitor.getStatus()).toBe("unhealthy");
    expect(onUnhealthy).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it("transitions unhealthy → healthy on recovery", async () => {
    const client = createMockClient(false);
    const onHealthy = vi.fn();
    const monitor = new HealthMonitor(client, {
      onHealthy,
      intervalMs: 1000,
      unhealthyIntervalMs: 500,
    });
    monitor.start();

    await vi.advanceTimersByTimeAsync(0); // first probe → unhealthy
    expect(monitor.getStatus()).toBe("unhealthy");

    // Recovery
    client.isHealthy.mockResolvedValue(true);
    await vi.advanceTimersByTimeAsync(500);

    expect(monitor.getStatus()).toBe("healthy");
    expect(onHealthy).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it("uses faster interval when unhealthy", async () => {
    const client = createMockClient(false);
    const monitor = new HealthMonitor(client, {
      intervalMs: 15_000,
      unhealthyIntervalMs: 5_000,
    });
    monitor.start();

    await vi.advanceTimersByTimeAsync(0); // first probe → unhealthy

    // Should probe again after 5s (unhealthy interval), not 15s
    client.isHealthy.mockClear();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.isHealthy).toHaveBeenCalled();

    monitor.stop();
  });

  it("uses slower interval when healthy", async () => {
    const client = createMockClient(true);
    const monitor = new HealthMonitor(client, {
      intervalMs: 15_000,
      unhealthyIntervalMs: 5_000,
    });
    monitor.start();

    await vi.advanceTimersByTimeAsync(0); // first probe → healthy

    client.isHealthy.mockClear();

    // Should NOT have probed at 5s
    await vi.advanceTimersByTimeAsync(5_000);
    expect(client.isHealthy).not.toHaveBeenCalled();

    // Should probe at 15s
    await vi.advanceTimersByTimeAsync(10_000);
    expect(client.isHealthy).toHaveBeenCalled();

    monitor.stop();
  });

  it("subscribers notified on transitions", async () => {
    const client = createMockClient(true);
    const listener = vi.fn();
    const monitor = new HealthMonitor(client, { intervalMs: 1000, unhealthyIntervalMs: 500 });

    monitor.subscribe(listener);
    monitor.start();

    await vi.advanceTimersByTimeAsync(0); // unknown → healthy
    expect(listener).toHaveBeenCalledWith("healthy");

    client.isHealthy.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(1000); // healthy → unhealthy
    expect(listener).toHaveBeenCalledWith("unhealthy");

    expect(listener).toHaveBeenCalledTimes(2);

    monitor.stop();
  });

  it("subscribers NOT notified when status unchanged", async () => {
    const client = createMockClient(true);
    const listener = vi.fn();
    const monitor = new HealthMonitor(client, { intervalMs: 1000 });

    monitor.subscribe(listener);
    monitor.start();

    await vi.advanceTimersByTimeAsync(0); // unknown → healthy (notified)
    listener.mockClear();

    // Next probe still healthy — no notification
    await vi.advanceTimersByTimeAsync(1000);
    expect(listener).not.toHaveBeenCalled();

    monitor.stop();
  });

  it("unsubscribe works", async () => {
    const client = createMockClient(true);
    const listener = vi.fn();
    const monitor = new HealthMonitor(client, { intervalMs: 1000, unhealthyIntervalMs: 500 });

    const unsub = monitor.subscribe(listener);
    monitor.start();

    await vi.advanceTimersByTimeAsync(0); // unknown → healthy
    expect(listener).toHaveBeenCalledTimes(1);

    unsub();

    client.isHealthy.mockResolvedValue(false);
    await vi.advanceTimersByTimeAsync(1000);

    // Should not have been called again after unsubscribe
    expect(listener).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it("stop() clears timer and subscribers", async () => {
    const client = createMockClient(true);
    const listener = vi.fn();
    const monitor = new HealthMonitor(client, { intervalMs: 1000 });

    monitor.subscribe(listener);
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);

    monitor.stop();

    expect(monitor.getStatus()).toBe("unknown");

    // Advance time — no more probes
    client.isHealthy.mockClear();
    await vi.advanceTimersByTimeAsync(5000);
    expect(client.isHealthy).not.toHaveBeenCalled();
  });

  it("handles isHealthy() throwing", async () => {
    const client = { isHealthy: vi.fn().mockRejectedValue(new Error("boom")) };
    const monitor = new HealthMonitor(client, { intervalMs: 1000 });
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);
    expect(monitor.getStatus()).toBe("unhealthy");

    monitor.stop();
  });

  it("handles listener errors without breaking", async () => {
    const client = createMockClient(true);
    const badListener = vi.fn().mockImplementation(() => {
      throw new Error("listener error");
    });
    const goodListener = vi.fn();
    const monitor = new HealthMonitor(client, { intervalMs: 1000 });

    monitor.subscribe(badListener);
    monitor.subscribe(goodListener);
    monitor.start();

    await vi.advanceTimersByTimeAsync(0);

    expect(badListener).toHaveBeenCalled();
    expect(goodListener).toHaveBeenCalled();

    monitor.stop();
  });

  it("start() is idempotent", async () => {
    const client = createMockClient(true);
    const monitor = new HealthMonitor(client, { intervalMs: 1000 });

    monitor.start();
    monitor.start(); // second call is no-op

    await vi.advanceTimersByTimeAsync(0);
    expect(client.isHealthy).toHaveBeenCalledTimes(1);

    monitor.stop();
  });

  it("stop() is idempotent", () => {
    const client = createMockClient(true);
    const monitor = new HealthMonitor(client);
    monitor.start();
    monitor.stop();
    monitor.stop(); // should not throw
    expect(monitor.getStatus()).toBe("unknown");
  });
});

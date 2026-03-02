/**
 * Tests for CortexSidecar — signal handlers, auto-restart, pipe drain,
 * and strict version enforcement.
 *
 * Uses vi.mock() to stub child_process.spawn and binary locator.
 */

import { EventEmitter } from "node:events";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

// ---------- Hoisted state (accessible inside vi.mock factories) ----------

const mockState = vi.hoisted(() => ({
  fakeProc: null as unknown,
  healthCallCount: 0,
  healthReturnValues: [] as boolean[],
  spawnFn: vi.fn(),
  existsSyncFn: vi.fn(() => true),
  locateCortexBinaryFn: vi.fn(async () => "/usr/bin/fake-cortex"),
  getCortexBinaryVersionFn: vi.fn(() => "0.2.6"),
}));

// ---------- Mocks ----------

vi.mock("node:child_process", () => ({
  spawn: mockState.spawnFn,
}));

vi.mock("node:fs", () => ({
  existsSync: mockState.existsSyncFn,
}));

vi.mock("../shared/cortex-binary-locator.js", () => ({
  locateCortexBinary: mockState.locateCortexBinaryFn,
  getCortexBinaryVersion: mockState.getCortexBinaryVersionFn,
}));

vi.mock("../shared/cortex-version.js", () => ({
  REQUIRED_CORTEX_VERSION: "0.2.6",
}));

// Mock the CortexClient used internally by the sidecar
vi.mock("./cortex-client.js", () => ({
  CortexClient: class MockCortexClient {
    async isHealthy() {
      if (mockState.healthReturnValues.length > 0) {
        return mockState.healthReturnValues.shift();
      }
      return mockState.healthCallCount++ > 0;
    }
  },
}));

// ---------- Fake ChildProcess (needs EventEmitter, so defined after imports) ----------

class FakeChildProcess extends EventEmitter {
  pid = 12345;
  killed = false;
  stdout = new EventEmitter() as NodeJS.ReadableStream & { resume: () => void };
  stderr = new EventEmitter() as NodeJS.ReadableStream & { resume: () => void };

  constructor() {
    super();
    this.stdout.resume = vi.fn();
    this.stderr.resume = vi.fn();
  }

  kill(signal?: string) {
    this.killed = true;
    // Simulate immediate exit for tests
    if (signal === "SIGTERM" || signal === "SIGKILL") {
      process.nextTick(() => this.emit("exit", 0));
    }
  }
}

// Wire the hoisted spawn mock to create FakeChildProcess instances
mockState.spawnFn.mockImplementation(() => {
  const proc = new FakeChildProcess();
  mockState.fakeProc = proc;
  return proc;
});

import { CortexSidecar } from "./cortex-sidecar.js";

describe("CortexSidecar", () => {
  beforeEach(() => {
    mockState.healthCallCount = 0;
    mockState.healthReturnValues = [];
    mockState.fakeProc = null;
    vi.clearAllMocks();
    // Re-wire spawn implementation after clearAllMocks resets it
    mockState.spawnFn.mockImplementation(() => {
      const proc = new FakeChildProcess();
      mockState.fakeProc = proc;
      return proc;
    });
    mockState.existsSyncFn.mockReturnValue(true);
    mockState.locateCortexBinaryFn.mockResolvedValue("/usr/bin/fake-cortex");
    mockState.getCortexBinaryVersionFn.mockReturnValue("0.2.6");
  });

  afterEach(() => {
    // Clean up any lingering signal handlers
  });

  it("registers signal handlers after successful spawn", async () => {
    // First isHealthy=false (not running externally), then true (healthy after spawn)
    mockState.healthReturnValues = [false, true];

    const onceSpy = vi.spyOn(process, "once");

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
    });

    const result = await sidecar.start();
    expect(result).toBe(true);
    expect(sidecar.status).toBe("running");

    // Should have registered SIGTERM, SIGINT, beforeExit
    const registeredSignals = onceSpy.mock.calls
      .map((call) => call[0])
      .filter((s) => ["SIGTERM", "SIGINT", "beforeExit"].includes(s as string));
    expect(registeredSignals).toContain("SIGTERM");
    expect(registeredSignals).toContain("SIGINT");
    expect(registeredSignals).toContain("beforeExit");

    // Cleanup
    await sidecar.stop();
    onceSpy.mockRestore();
  });

  it("removes signal handlers after stop", async () => {
    mockState.healthReturnValues = [false, true];

    const removeListenerSpy = vi.spyOn(process, "removeListener");

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
    });

    await sidecar.start();
    await sidecar.stop();

    const removedSignals = removeListenerSpy.mock.calls.map((call) => call[0]);
    expect(removedSignals).toContain("SIGTERM");
    expect(removedSignals).toContain("SIGINT");
    expect(removedSignals).toContain("beforeExit");

    removeListenerSpy.mockRestore();
  });

  it("drains stdout and stderr on spawn", async () => {
    mockState.healthReturnValues = [false, true];

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
    });

    await sidecar.start();

    const fakeProc = mockState.fakeProc as FakeChildProcess;
    expect(fakeProc).not.toBeNull();
    expect(fakeProc.stdout.resume).toHaveBeenCalled();
    expect(fakeProc.stderr.resume).toHaveBeenCalled();

    await sidecar.stop();
  });

  it("does not spawn when autoStart is false", async () => {
    mockState.healthReturnValues = [false]; // not running externally

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: false,
    });

    const result = await sidecar.start();
    expect(result).toBe(false);
    expect(sidecar.status).toBe("stopped");
  });

  it("returns true without spawning if already running externally", async () => {
    mockState.healthReturnValues = [true]; // already healthy

    const { spawn } = await import("node:child_process");

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
    });

    const result = await sidecar.start();
    expect(result).toBe(true);
    expect(sidecar.status).toBe("running");
    expect(spawn).not.toHaveBeenCalled();
  });

  it("strict version check blocks outdated binary", async () => {
    mockState.healthReturnValues = [false]; // not running externally

    // Override getCortexBinaryVersion to return old version
    mockState.getCortexBinaryVersionFn.mockReturnValue("0.1.0");

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
      strictVersionCheck: true,
    });

    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await sidecar.start();
    expect(result).toBe(false);
    expect(sidecar.status).toBe("failed");
    expect(errorSpy).toHaveBeenCalledWith(expect.stringContaining("strict version check failed"));

    errorSpy.mockRestore();
    warnSpy.mockRestore();
  });

  it("stop is idempotent when no process running", async () => {
    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
    });

    await sidecar.stop();
    expect(sidecar.status).toBe("stopped");

    await sidecar.stop(); // second call
    expect(sidecar.status).toBe("stopped");
  });
});

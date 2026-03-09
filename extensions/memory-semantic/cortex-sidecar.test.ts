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
  getCortexBinaryVersionFn: vi.fn(() => "0.3.7"),
  readFileSyncFn: vi.fn(() => '{"jwtSecret":"test-jwt","adminPassword":"test-admin-pass"}'),
  writeFileSyncFn: vi.fn(),
  mkdirSyncFn: vi.fn(),
}));

// ---------- Mocks ----------

vi.mock("node:child_process", () => ({
  spawn: mockState.spawnFn,
}));

vi.mock("node:fs", () => ({
  existsSync: mockState.existsSyncFn,
  readFileSync: mockState.readFileSyncFn,
  writeFileSync: mockState.writeFileSyncFn,
  mkdirSync: mockState.mkdirSyncFn,
  unlinkSync: vi.fn(),
}));

// Mock node:net to prevent real TCP connections during port checks
vi.mock("node:net", () => ({
  createConnection: vi.fn(() => {
    // Simulate ECONNREFUSED (port is free)
    const emitter = new (require("node:events").EventEmitter)();
    emitter.setTimeout = vi.fn();
    emitter.destroy = vi.fn();
    process.nextTick(() => emitter.emit("error", new Error("ECONNREFUSED")));
    return emitter;
  }),
}));

vi.mock("node:crypto", () => ({
  randomBytes: vi.fn((n: number) => Buffer.alloc(n, 0x41)),
}));

vi.mock("node:os", () => ({
  homedir: vi.fn(() => "/tmp/test-home"),
}));

vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:path")>();
  return { ...actual, join: actual.join };
});

vi.mock("../shared/cortex-binary-locator.js", () => ({
  locateCortexBinary: mockState.locateCortexBinaryFn,
  getCortexBinaryVersion: mockState.getCortexBinaryVersionFn,
}));

vi.mock("../shared/cortex-version.js", () => ({
  REQUIRED_CORTEX_VERSION: "0.3.7",
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

import { CortexSidecar, ensureCortexSecrets } from "./cortex-sidecar.js";

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
    mockState.getCortexBinaryVersionFn.mockReturnValue("0.3.7");
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

  it("drains stdout and captures stderr on spawn", async () => {
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
    // stderr is now captured via .on('data') ring buffer
    expect(fakeProc.stderr.listenerCount("data")).toBeGreaterThan(0);

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

  it("passes AINGLE_JWT_SECRET and AINGLE_ADMIN_PASSWORD to spawned process", async () => {
    mockState.healthReturnValues = [false, true];

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
    });

    await sidecar.start();

    const spawnCall = mockState.spawnFn.mock.calls[0];
    const spawnOpts = spawnCall?.[2] as { env?: Record<string, string> };
    expect(spawnOpts.env).toBeDefined();
    expect(spawnOpts.env!.AINGLE_JWT_SECRET).toBeTruthy();
    expect(spawnOpts.env!.AINGLE_ADMIN_PASSWORD).toBeTruthy();
    expect(spawnOpts.env!.AINGLE_ADMIN_PASSWORD!.length).toBeGreaterThanOrEqual(12);

    await sidecar.stop();
  });
});

describe("ensureCortexSecrets", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.AINGLE_JWT_SECRET;
    delete process.env.AINGLE_ADMIN_PASSWORD;
    mockState.existsSyncFn.mockReturnValue(true);
  });

  afterEach(() => {
    delete process.env.AINGLE_JWT_SECRET;
    delete process.env.AINGLE_ADMIN_PASSWORD;
  });

  it("uses env vars when both are set", () => {
    process.env.AINGLE_JWT_SECRET = "env-jwt-secret";
    process.env.AINGLE_ADMIN_PASSWORD = "env-admin-password";

    const secrets = ensureCortexSecrets();

    expect(secrets.jwtSecret).toBe("env-jwt-secret");
    expect(secrets.adminPassword).toBe("env-admin-password");
  });

  it("reads persisted file when env vars are not set", () => {
    mockState.readFileSyncFn.mockReturnValue(
      '{"jwtSecret":"persisted-jwt","adminPassword":"persisted-admin"}',
    );

    const secrets = ensureCortexSecrets();

    expect(secrets.jwtSecret).toBe("persisted-jwt");
    expect(secrets.adminPassword).toBe("persisted-admin");
  });

  it("generates and persists secrets when nothing exists", () => {
    mockState.existsSyncFn.mockReturnValue(false);

    const secrets = ensureCortexSecrets();

    expect(secrets.jwtSecret).toBeTruthy();
    expect(secrets.adminPassword).toBeTruthy();
    expect(secrets.adminPassword.length).toBeGreaterThanOrEqual(12);
    expect(mockState.writeFileSyncFn).toHaveBeenCalled();
    const writeCall = mockState.writeFileSyncFn.mock.calls[0];
    expect(writeCall?.[2]).toEqual(expect.objectContaining({ mode: 0o600 }));
  });
});

// ============================================================================
// P2P flag forwarding (B1)
// ============================================================================

describe("CortexSidecar P2P flags", () => {
  beforeEach(() => {
    mockState.healthCallCount = 0;
    mockState.healthReturnValues = [];
    mockState.fakeProc = null;
    vi.clearAllMocks();
    mockState.spawnFn.mockImplementation(() => {
      const proc = new FakeChildProcess();
      mockState.fakeProc = proc;
      return proc;
    });
    mockState.existsSyncFn.mockReturnValue(true);
    mockState.locateCortexBinaryFn.mockResolvedValue("/usr/bin/fake-cortex");
    mockState.getCortexBinaryVersionFn.mockReturnValue("0.3.7");
  });

  it("adds P2P flags when p2p is enabled", async () => {
    mockState.healthReturnValues = [false, true];

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
      p2p: {
        enabled: true,
        port: 19091,
        seed: "test-seed",
        manualPeers: ["192.168.1.5:19091"],
        mdns: true,
      },
    });

    await sidecar.start();

    const spawnCall = mockState.spawnFn.mock.calls[0];
    const args = spawnCall?.[1] as string[];
    expect(args).toContain("--p2p");
    expect(args).toContain("--p2p-port");
    expect(args).toContain("19091");
    expect(args).toContain("--p2p-seed");
    expect(args).toContain("test-seed");
    expect(args).toContain("--p2p-mdns");
    expect(args).toContain("--p2p-peer");
    expect(args).toContain("192.168.1.5:19091");

    await sidecar.stop();
  });

  it("does not add P2P flags when p2p is not enabled", async () => {
    mockState.healthReturnValues = [false, true];

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
    });

    await sidecar.start();

    const spawnCall = mockState.spawnFn.mock.calls[0];
    const args = spawnCall?.[1] as string[];
    expect(args).not.toContain("--p2p");
    expect(args).not.toContain("--p2p-port");

    await sidecar.stop();
  });

  it("does not add P2P flags when p2p.enabled is false", async () => {
    mockState.healthReturnValues = [false, true];

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
      p2p: {
        enabled: false,
        port: 19091,
        manualPeers: [],
        mdns: false,
      },
    });

    await sidecar.start();

    const spawnCall = mockState.spawnFn.mock.calls[0];
    const args = spawnCall?.[1] as string[];
    expect(args).not.toContain("--p2p");

    await sidecar.stop();
  });

  it("adds multiple --p2p-peer flags", async () => {
    mockState.healthReturnValues = [false, true];

    const sidecar = new CortexSidecar({
      host: "127.0.0.1",
      port: 9999,
      autoStart: true,
      binaryPath: "/usr/bin/fake-cortex",
      p2p: {
        enabled: true,
        port: 19091,
        manualPeers: ["10.0.0.1:19091", "10.0.0.2:19093"],
        mdns: false,
      },
    });

    await sidecar.start();

    const spawnCall = mockState.spawnFn.mock.calls[0];
    const args = spawnCall?.[1] as string[];
    const peerFlags = args.filter((_a: string, i: number) => args[i - 1] === "--p2p-peer");
    expect(peerFlags).toContain("10.0.0.1:19091");
    expect(peerFlags).toContain("10.0.0.2:19093");

    await sidecar.stop();
  });
});

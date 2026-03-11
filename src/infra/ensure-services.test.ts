import { beforeEach, describe, expect, it, vi } from "vitest";

const probeGatewayReachable = vi.hoisted(() => vi.fn());
const waitForGatewayReachable = vi.hoisted(() => vi.fn());
const resolveGatewayService = vi.hoisted(() => vi.fn());
const buildGatewayInstallPlan = vi.hoisted(() => vi.fn());
const parseCortexConfig = vi.hoisted(() => vi.fn());

let cortexHealthy = true;
let sidecarStartResult = true;

const CortexClient = vi.hoisted(() =>
  vi.fn().mockImplementation(function () {
    return { isHealthy: vi.fn().mockImplementation(() => Promise.resolve(cortexHealthy)) };
  }),
);
const CortexSidecar = vi.hoisted(() =>
  vi.fn().mockImplementation(function () {
    return { start: vi.fn().mockImplementation(() => Promise.resolve(sidecarStartResult)) };
  }),
);

vi.mock("../commands/onboard-helpers.js", () => ({
  probeGatewayReachable,
  waitForGatewayReachable,
}));
vi.mock("../daemon/service.js", () => ({ resolveGatewayService }));
vi.mock("../commands/daemon-install-helpers.js", () => ({ buildGatewayInstallPlan }));
vi.mock("../../extensions/shared/cortex-config.js", () => ({ parseCortexConfig }));
vi.mock("../../extensions/shared/cortex-client.js", () => ({ CortexClient }));
vi.mock("../../extensions/memory-semantic/cortex-sidecar.js", () => ({ CortexSidecar }));
vi.mock("../config/config.js", () => ({
  resolveGatewayPort: (cfg: Record<string, unknown>) =>
    (cfg?.gateway as Record<string, unknown>)?.port ?? 18789,
}));

import { ensureServicesRunning } from "./ensure-services.js";

function makeConfig(overrides: Record<string, unknown> = {}) {
  return { gateway: { port: 18789 }, ...overrides } as Parameters<
    typeof ensureServicesRunning
  >[0]["config"];
}

describe("ensureServicesRunning", () => {
  const log = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    cortexHealthy = true;
    sidecarStartResult = true;
    parseCortexConfig.mockReturnValue({ host: "127.0.0.1", port: 19090, autoStart: true });
  });

  describe("gateway", () => {
    it("returns ok when gateway is already reachable", async () => {
      probeGatewayReachable.mockResolvedValue({ ok: true });

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.gateway.ok).toBe(true);
      expect(resolveGatewayService).not.toHaveBeenCalled();
    });

    it("restarts service when gateway is not reachable", async () => {
      probeGatewayReachable.mockResolvedValue({ ok: false, detail: "ECONNREFUSED" });
      const restart = vi.fn();
      const isLoaded = vi.fn().mockResolvedValue(true);
      resolveGatewayService.mockReturnValue({ restart, isLoaded });
      waitForGatewayReachable.mockResolvedValue({ ok: true });

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.gateway.ok).toBe(true);
      expect(restart).toHaveBeenCalled();
      expect(log).toHaveBeenCalledWith(expect.stringContaining("starting service"));
    });

    it("fails when service is not installed and auto-install fails", async () => {
      probeGatewayReachable.mockResolvedValue({ ok: false });
      const isLoaded = vi.fn().mockResolvedValue(false);
      const install = vi.fn().mockRejectedValue(new Error("not installed"));
      resolveGatewayService.mockReturnValue({ isLoaded, restart: vi.fn(), install });
      buildGatewayInstallPlan.mockResolvedValue({
        programArguments: [],
        workingDirectory: "/tmp",
        environment: {},
      });

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.gateway.ok).toBe(false);
      expect(result.gateway.detail).toContain("auto-install failed");
    });

    it("fails when restart throws", async () => {
      probeGatewayReachable.mockResolvedValue({ ok: false });
      const isLoaded = vi.fn().mockResolvedValue(true);
      const restart = vi.fn().mockRejectedValue(new Error("permission denied"));
      resolveGatewayService.mockReturnValue({ isLoaded, restart });

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.gateway.ok).toBe(false);
      expect(result.gateway.detail).toContain("permission denied");
    });

    it("fails when gateway does not become healthy after restart", async () => {
      probeGatewayReachable.mockResolvedValue({ ok: false });
      const isLoaded = vi.fn().mockResolvedValue(true);
      resolveGatewayService.mockReturnValue({ isLoaded, restart: vi.fn() });
      waitForGatewayReachable.mockResolvedValue({ ok: false, detail: "timeout" });

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.gateway.ok).toBe(false);
      expect(result.gateway.detail).toBe("timeout");
    });

    it("uses configured auth token for probe", async () => {
      probeGatewayReachable.mockResolvedValue({ ok: true });

      await ensureServicesRunning({
        config: makeConfig({
          gateway: { port: 18789, auth: { token: "my-token" } },
        }),
        log,
      });

      expect(probeGatewayReachable).toHaveBeenCalledWith(
        expect.objectContaining({ token: "my-token" }),
      );
    });
  });

  describe("cortex", () => {
    beforeEach(() => {
      // Gateway always reachable for cortex tests
      probeGatewayReachable.mockResolvedValue({ ok: true });
    });

    it("returns ok when cortex is already healthy", async () => {
      cortexHealthy = true;

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.cortex.ok).toBe(true);
    });

    it("starts sidecar when cortex is not healthy", async () => {
      cortexHealthy = false;
      sidecarStartResult = true;

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.cortex.ok).toBe(true);
      expect(log).toHaveBeenCalledWith(expect.stringContaining("starting sidecar"));
    });

    it("fails when sidecar fails to start", async () => {
      cortexHealthy = false;
      sidecarStartResult = false;

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.cortex.ok).toBe(false);
      expect(result.cortex.detail).toContain("failed to start");
    });

    it("returns not ok when autoStart is disabled", async () => {
      cortexHealthy = false;
      parseCortexConfig.mockReturnValue({ host: "127.0.0.1", port: 19090, autoStart: false });

      const result = await ensureServicesRunning({ config: makeConfig(), log });

      expect(result.cortex.ok).toBe(false);
      expect(result.cortex.detail).toContain("autoStart is disabled");
    });
  });
});

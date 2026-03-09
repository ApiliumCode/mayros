/**
 * Ensures the Gateway and Cortex sidecar are running before starting the TUI.
 *
 * 1. Probe gateway health — if reachable, done.
 * 2. If not, try to (re)start the daemon service.
 * 3. Wait for gateway to become healthy.
 * 4. Probe Cortex health — if reachable, done.
 * 5. If not, spawn the Cortex sidecar.
 */

import type { MayrosConfig } from "../config/config.js";
import { resolveGatewayPort } from "../config/config.js";
import { probeGatewayReachable, waitForGatewayReachable } from "../commands/onboard-helpers.js";
import { buildGatewayInstallPlan } from "../commands/daemon-install-helpers.js";
import { resolveGatewayService } from "../daemon/service.js";
import { parseCortexConfig } from "../../extensions/shared/cortex-config.js";
import { CortexClient } from "../../extensions/shared/cortex-client.js";
import { CortexSidecar } from "../../extensions/memory-semantic/cortex-sidecar.js";

export type EnsureServicesResult = {
  gateway: { ok: boolean; detail?: string };
  cortex: { ok: boolean; detail?: string };
};

export async function ensureServicesRunning(params: {
  config: MayrosConfig;
  log: (msg: string) => void;
}): Promise<EnsureServicesResult> {
  const { config, log } = params;

  const gatewayResult = await ensureGatewayRunning({ config, log });
  const cortexResult = await ensureCortexRunning({ config, log });

  return { gateway: gatewayResult, cortex: cortexResult };
}

// ---------------------------------------------------------------------------
// Gateway
// ---------------------------------------------------------------------------

async function ensureGatewayRunning(params: {
  config: MayrosConfig;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; detail?: string }> {
  const { config, log } = params;
  const port = resolveGatewayPort(config);
  const wsUrl = `ws://127.0.0.1:${port}`;

  // 1. Quick probe — maybe it's already running
  const probe = await probeGatewayReachable({
    url: wsUrl,
    token: config.gateway?.auth?.token ?? process.env.MAYROS_GATEWAY_TOKEN,
    password: config.gateway?.auth?.password ?? process.env.MAYROS_GATEWAY_PASSWORD,
    timeoutMs: 2000,
  });

  if (probe.ok) {
    return { ok: true };
  }

  // 2. Try to start/restart the daemon service
  log("Gateway not running — starting service...");

  try {
    const service = resolveGatewayService();
    const loaded = await service.isLoaded({ env: process.env }).catch(() => false);

    if (!loaded) {
      // Auto-install the daemon service instead of requiring manual onboard
      log("Gateway service not installed — auto-installing...");
      try {
        const port = resolveGatewayPort(config);
        const plan = await buildGatewayInstallPlan({
          env: process.env as Record<string, string | undefined>,
          port,
          runtime: "node",
          config,
        });
        await service.install({
          env: process.env as Record<string, string | undefined>,
          stdout: process.stdout,
          programArguments: plan.programArguments,
          workingDirectory: plan.workingDirectory,
          environment: plan.environment,
        });
        log("Gateway service installed.");
      } catch (err) {
        return {
          ok: false,
          detail: `Gateway auto-install failed: ${err instanceof Error ? err.message : String(err)}. Run \`mayros onboard\` manually.`,
        };
      }
    }

    await service.restart({ env: process.env, stdout: process.stdout });
  } catch (err) {
    return {
      ok: false,
      detail: `Failed to start gateway: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  // 3. Wait for it to become healthy
  const result = await waitForGatewayReachable({
    url: wsUrl,
    token: config.gateway?.auth?.token ?? process.env.MAYROS_GATEWAY_TOKEN,
    password: config.gateway?.auth?.password ?? process.env.MAYROS_GATEWAY_PASSWORD,
    deadlineMs: 15_000,
    pollMs: 400,
    probeTimeoutMs: 2000,
  });

  if (result.ok) {
    log("Gateway started.");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cortex
// ---------------------------------------------------------------------------

async function ensureCortexRunning(params: {
  config: MayrosConfig;
  log: (msg: string) => void;
}): Promise<{ ok: boolean; detail?: string }> {
  const { config, log } = params;

  const cortexRaw = (
    config.plugins?.entries?.["memory-semantic"]?.config as Record<string, unknown>
  )?.cortex;
  const cortexConfig = parseCortexConfig(cortexRaw ?? {});

  // 1. Quick health check
  const client = new CortexClient(cortexConfig);
  if (await client.isHealthy()) {
    return { ok: true };
  }

  if (!cortexConfig.autoStart) {
    return { ok: false, detail: "Cortex not running and autoStart is disabled." };
  }

  // 2. Spawn the sidecar
  log("Cortex not running — starting sidecar...");
  const sidecar = new CortexSidecar(cortexConfig);
  const healthy = await sidecar.start();

  if (healthy) {
    log("Cortex started.");
    return { ok: true };
  }

  return {
    ok: false,
    detail: "Cortex sidecar failed to start. Run `mayros doctor` for diagnostics.",
  };
}

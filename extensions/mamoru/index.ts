/**
 * Mamoru — Security & Protection Layer Plugin
 *
 * Kernel-level sandboxing, inference routing, network egress control,
 * and local model management for Mayros agents.
 *
 * Components:
 *   - MamoruSandbox: Landlock + seccomp sandbox orchestration (Linux)
 *   - EruberuProxy:  Inference routing with policy, logging, profiles
 *   - MamoruGate:    Network egress deny-by-default with allowlist
 *   - LocalModelSetup: GPU detection, model suggestion, Ollama integration
 *
 * Gateway methods:
 *   mamoru.status         — sandbox + egress + proxy status
 *   mamoru.egress.pending — list pending approvals
 *   mamoru.egress.approve — approve a request
 *   mamoru.egress.deny    — deny a request
 *   mamoru.proxy.logs     — inference logs
 *   mamoru.proxy.profiles — list profiles
 *
 * CLI (lazy-loaded):
 *   mayros mamoru status
 *   mayros mamoru egress list|approve|deny|preset
 *   mayros mamoru proxy logs|profiles|set
 *   mayros mamoru model detect|suggest|install|test
 */

export { MamoruSandbox } from "./sandbox.js";
export type { SandboxPolicy, SandboxStatus, SandboxAvailability, SandboxApplyResult } from "./sandbox.js";

export { EruberuProxy } from "./eruberu-proxy.js";
export type { InferenceProfile, InferenceLog, InferencePolicy, UsageSummary } from "./eruberu-proxy.js";

export { MamoruGate } from "./egress-gate.js";
export type { EgressRule, EgressPolicy, EgressRequest } from "./egress-gate.js";

export { LocalModelSetup } from "./local-model.js";
export type { GPUInfo, LocalModelConfig, ModelSuggestion } from "./local-model.js";

// ── Plugin registration (gateway + CLI) ──────────────────────────────────

import type { MamoruSandbox as MamoruSandboxType } from "./sandbox.js";
import type { EruberuProxy as EruberuProxyType } from "./eruberu-proxy.js";
import type { MamoruGate as MamoruGateType } from "./egress-gate.js";
import type { LocalModelSetup as LocalModelSetupType } from "./local-model.js";

export type MamoruInstances = {
  sandbox: MamoruSandboxType;
  proxy: EruberuProxyType;
  gate: MamoruGateType;
  localModel: LocalModelSetupType;
};

/**
 * Create all Mamoru instances for a given namespace.
 */
export async function createMamoruStack(ns: string): Promise<MamoruInstances> {
  const { MamoruSandbox: Sandbox } = await import("./sandbox.js");
  const { EruberuProxy: Proxy } = await import("./eruberu-proxy.js");
  const { MamoruGate: Gate } = await import("./egress-gate.js");
  const { LocalModelSetup: Model } = await import("./local-model.js");

  return {
    sandbox: new Sandbox(ns),
    proxy: new Proxy(ns),
    gate: new Gate(ns),
    localModel: new Model(),
  };
}

/**
 * Gateway method definitions for Mamoru.
 * Can be registered with the Mayros gateway.
 */
export function getMamoruGatewayMethods(instances: MamoruInstances) {
  const { sandbox, proxy, gate } = instances;

  return {
    "mamoru.status": async () => ({
      sandbox: {
        status: sandbox.getStatus(),
        availability: await sandbox.checkAvailability(),
      },
      proxy: {
        activeProfile: proxy.getActiveProfile(),
        logCount: proxy.getLogCount(),
        policy: proxy.getPolicy(),
      },
      egress: {
        policy: gate.getPolicy(),
        pendingRequests: gate.getPendingRequests().length,
      },
    }),

    "mamoru.egress.pending": async () => ({
      requests: gate.getPendingRequests(),
    }),

    "mamoru.egress.approve": async (params: { requestId: string; sessionScoped?: boolean }) => {
      gate.approve(params.requestId, { sessionScoped: params.sessionScoped });
      return { ok: true };
    },

    "mamoru.egress.deny": async (params: { requestId: string }) => {
      gate.deny(params.requestId);
      return { ok: true };
    },

    "mamoru.proxy.logs": async (params?: { limit?: number }) => ({
      logs: proxy.getRecentLogs(params?.limit),
      summary: proxy.getUsageSummary(),
    }),

    "mamoru.proxy.profiles": async () => ({
      profiles: proxy.listProfiles(),
      active: proxy.getActiveProfile(),
    }),
  };
}

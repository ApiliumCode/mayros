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

export { MamoruApiKeys } from "./api-keys.js";
export type { ApiKey, ApiKeyCreateResult } from "./api-keys.js";

export { MamoruVault } from "./secrets-vault.js";
export type { Secret, SecretMetadata } from "./secrets-vault.js";

// ── Plugin registration (gateway + CLI) ──────────────────────────────────

import type { MamoruSandbox as MamoruSandboxType } from "./sandbox.js";
import type { EruberuProxy as EruberuProxyType } from "./eruberu-proxy.js";
import type { MamoruGate as MamoruGateType } from "./egress-gate.js";
import type { LocalModelSetup as LocalModelSetupType } from "./local-model.js";
import type { MamoruApiKeys as MamoruApiKeysType } from "./api-keys.js";
import type { MamoruVault as MamoruVaultType } from "./secrets-vault.js";
import type { CortexClientLike } from "../shared/cortex-client.js";

export type MamoruInstances = {
  sandbox: MamoruSandboxType;
  proxy: EruberuProxyType;
  gate: MamoruGateType;
  localModel: LocalModelSetupType;
  apiKeys: MamoruApiKeysType | undefined;
  vault: MamoruVaultType | undefined;
};

/**
 * Create all Mamoru instances for a given namespace.
 */
export async function createMamoruStack(
  ns: string,
  opts?: { client?: CortexClientLike; vaultKey?: string },
): Promise<MamoruInstances> {
  const { MamoruSandbox: Sandbox } = await import("./sandbox.js");
  const { EruberuProxy: Proxy } = await import("./eruberu-proxy.js");
  const { MamoruGate: Gate } = await import("./egress-gate.js");
  const { LocalModelSetup: Model } = await import("./local-model.js");
  const { MamoruApiKeys: Keys } = await import("./api-keys.js");
  const { MamoruVault: Vault } = await import("./secrets-vault.js");

  const client = opts?.client;
  const vaultKey = opts?.vaultKey ?? process.env.MAYROS_VAULT_KEY;

  if (client && !vaultKey) {
    throw new Error(
      "Vault key is required. Set MAYROS_VAULT_KEY env var or provide vaultKey option.",
    );
  }

  return {
    sandbox: new Sandbox(ns),
    proxy: new Proxy(ns),
    gate: new Gate(ns),
    localModel: new Model(),
    apiKeys: client ? new Keys(client, ns) : undefined,
    vault: client && vaultKey ? new Vault(client, ns, vaultKey) : undefined,
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

    // ── API Keys ─────────────────────────────────────────────────────

    "mamoru.keys.list": async (params: { agentId: string }) => {
      if (!instances.apiKeys) return { error: "API keys require a Cortex client" };
      return { keys: await instances.apiKeys.list(params.agentId) };
    },

    "mamoru.keys.create": async (params: {
      agentId: string;
      name: string;
      scopes?: string[];
      expiresInDays?: number;
    }) => {
      if (!instances.apiKeys) return { error: "API keys require a Cortex client" };
      const result = await instances.apiKeys.create(params.agentId, params.name, {
        scopes: params.scopes,
        expiresInDays: params.expiresInDays,
      });
      // WARNING: plaintext is shown ONCE. Gateway callers must ensure
      // this response transits only over authenticated, encrypted channels.
      // The plaintext is never stored — only the SHA-256 hash is persisted.
      return {
        key: result.key,
        plaintext: result.plaintext,
        warning: "Save this key now. It will not be shown again.",
      };
    },

    "mamoru.keys.revoke": async (params: { keyId: string }) => {
      if (!instances.apiKeys) return { error: "API keys require a Cortex client" };
      await instances.apiKeys.revoke(params.keyId);
      return { ok: true };
    },

    // ── Secrets Vault ────────────────────────────────────────────────

    "mamoru.vault.list": async (params?: { scope?: string }) => {
      if (!instances.vault) return { error: "Vault requires a Cortex client" };
      return { secrets: await instances.vault.list(params) };
    },

    "mamoru.vault.store": async (params: {
      name: string;
      value: string;
      scope?: "global" | "venture" | "agent";
      scopeId?: string;
    }) => {
      if (!instances.vault) return { error: "Vault requires a Cortex client" };
      const secret = await instances.vault.store(params.name, params.value, {
        scope: params.scope,
        scopeId: params.scopeId,
      });
      return { name: secret.name, version: secret.version, scope: secret.scope };
    },

    "mamoru.vault.exists": async (params: { name: string }) => {
      if (!instances.vault) return { error: "Vault requires a Cortex client" };
      return { exists: await instances.vault.exists(params.name) };
    },
  };
}

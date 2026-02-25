import { isDangerousHostEnvVarName, normalizeEnvVarKey } from "../infra/host-env-security.js";
import type { MayrosConfig } from "./types.js";

function collectConfigEnvVarsByTarget(cfg?: MayrosConfig): Record<string, string> {
  const envConfig = cfg?.env;
  if (!envConfig) {
    return {};
  }

  const entries: Record<string, string> = {};

  if (envConfig.vars) {
    for (const [rawKey, value] of Object.entries(envConfig.vars)) {
      if (!value) {
        continue;
      }
      const key = normalizeEnvVarKey(rawKey, { portable: true });
      if (!key) {
        continue;
      }
      if (isDangerousHostEnvVarName(key)) {
        continue;
      }
      entries[key] = value;
    }
  }

  for (const [rawKey, value] of Object.entries(envConfig)) {
    if (rawKey === "shellEnv" || rawKey === "vars") {
      continue;
    }
    if (typeof value !== "string" || !value.trim()) {
      continue;
    }
    const key = normalizeEnvVarKey(rawKey, { portable: true });
    if (!key) {
      continue;
    }
    if (isDangerousHostEnvVarName(key)) {
      continue;
    }
    entries[key] = value;
  }

  return entries;
}

export function collectConfigRuntimeEnvVars(cfg?: MayrosConfig): Record<string, string> {
  return collectConfigEnvVarsByTarget(cfg);
}

export function collectConfigServiceEnvVars(cfg?: MayrosConfig): Record<string, string> {
  return collectConfigEnvVarsByTarget(cfg);
}

/** @deprecated Use `collectConfigRuntimeEnvVars` or `collectConfigServiceEnvVars`. */
export function collectConfigEnvVars(cfg?: MayrosConfig): Record<string, string> {
  return collectConfigRuntimeEnvVars(cfg);
}

export function applyConfigEnvVars(cfg: MayrosConfig, env: NodeJS.ProcessEnv = process.env): void {
  const entries = collectConfigRuntimeEnvVars(cfg);
  for (const [key, value] of Object.entries(entries)) {
    if (env[key]?.trim()) {
      continue;
    }
    env[key] = value;
  }
}

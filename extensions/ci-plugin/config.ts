/**
 * CI/CD Plugin Configuration.
 *
 * Manual parse(), assertAllowedKeys pattern — same as mcp-client/config.ts.
 */

import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
  resolveEnvVars,
} from "../shared/cortex-config.js";

export type { CortexConfig };

// ============================================================================
// Types
// ============================================================================

export type CiProviderType = "github" | "gitlab";

export type CiProviderConfig = {
  type: CiProviderType;
  token: string;
  baseUrl?: string;
  defaultOrg?: string;
};

export type CiPluginConfig = {
  cortex: CortexConfig;
  namespace: string;
  providers: CiProviderConfig[];
  registerInCortex: boolean;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_NAMESPACE = "mayros";
const VALID_PROVIDER_TYPES = new Set<CiProviderType>(["github", "gitlab"]);

// ============================================================================
// Parsers
// ============================================================================

function parseProviderConfig(raw: unknown, index: number): CiProviderConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`providers[${index}] must be an object`);
  }
  const p = raw as Record<string, unknown>;
  assertAllowedKeys(p, ["type", "token", "baseUrl", "defaultOrg"], `providers[${index}]`);

  const type = typeof p.type === "string" ? p.type : "";
  if (!VALID_PROVIDER_TYPES.has(type as CiProviderType)) {
    throw new Error(
      `providers[${index}].type must be one of: ${[...VALID_PROVIDER_TYPES].join(", ")} (got "${type}")`,
    );
  }

  const tokenRaw = typeof p.token === "string" ? p.token : "";
  if (!tokenRaw) {
    throw new Error(`providers[${index}].token is required`);
  }
  const token = resolveEnvVars(tokenRaw);

  const provider: CiProviderConfig = { type: type as CiProviderType, token };
  if (typeof p.baseUrl === "string") provider.baseUrl = p.baseUrl;
  if (typeof p.defaultOrg === "string") provider.defaultOrg = p.defaultOrg;

  return provider;
}

// ============================================================================
// Schema
// ============================================================================

export const ciPluginConfigSchema = {
  parse(value: unknown): CiPluginConfig {
    const cfg = (value ?? {}) as Record<string, unknown>;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertAllowedKeys(
        cfg,
        ["cortex", "namespace", "providers", "registerInCortex"],
        "ci-plugin config",
      );
    }

    const cortex = parseCortexConfig(cfg.cortex);

    const namespace = typeof cfg.namespace === "string" ? cfg.namespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(namespace)) {
      throw new Error(
        "namespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const providers: CiProviderConfig[] = [];
    if (Array.isArray(cfg.providers)) {
      for (let i = 0; i < cfg.providers.length; i++) {
        providers.push(parseProviderConfig(cfg.providers[i], i));
      }
    }

    const registerInCortex =
      typeof cfg.registerInCortex === "boolean" ? cfg.registerInCortex : true;

    return { cortex, namespace, providers, registerInCortex };
  },
};

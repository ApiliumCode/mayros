import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";
import type { ResilienceConfig } from "../shared/cortex-resilience.js";

export type { CortexConfig, ResilienceConfig };

export type SkillSandboxConfig = {
  maxGraphQueries: number;
  maxAssertions: number;
  proofTimeoutMs: number;
  allowZkProofs: boolean;
  sandboxEnabled: boolean;
  childProcess: boolean;
  memoryLimitBytes: number;
  maxStackSizeBytes: number;
  executionTimeoutMs: number;
  maxCallsPerMinute: number;
};

export type VerificationConfig = {
  requireSignature: boolean;
  polValidation: boolean;
  autoScan: boolean;
};

export type SemanticSkillsConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  skillSandbox: SkillSandboxConfig;
  verification: VerificationConfig;
  hotReload: boolean;
};

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;

function clampInt(raw: unknown, min: number, max: number, defaultVal: number): number {
  if (typeof raw !== "number") return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function parseSandboxConfig(raw: unknown): SkillSandboxConfig {
  const sandbox = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      sandbox,
      [
        "maxGraphQueries",
        "maxAssertions",
        "proofTimeoutMs",
        "allowZkProofs",
        "sandboxEnabled",
        "childProcess",
        "memoryLimitBytes",
        "maxStackSizeBytes",
        "executionTimeoutMs",
        "maxCallsPerMinute",
      ],
      "skillSandbox config",
    );
  }

  return {
    maxGraphQueries:
      typeof sandbox.maxGraphQueries === "number" ? Math.floor(sandbox.maxGraphQueries) : 50,
    maxAssertions:
      typeof sandbox.maxAssertions === "number" ? Math.floor(sandbox.maxAssertions) : 20,
    proofTimeoutMs:
      typeof sandbox.proofTimeoutMs === "number" ? Math.floor(sandbox.proofTimeoutMs) : 5000,
    allowZkProofs: sandbox.allowZkProofs !== false,
    sandboxEnabled: sandbox.sandboxEnabled !== false,
    childProcess: sandbox.childProcess === true,
    memoryLimitBytes: clampInt(
      sandbox.memoryLimitBytes,
      1024 * 1024,
      256 * 1024 * 1024,
      8 * 1024 * 1024,
    ),
    maxStackSizeBytes: clampInt(sandbox.maxStackSizeBytes, 64 * 1024, 8 * 1024 * 1024, 512 * 1024),
    executionTimeoutMs: clampInt(sandbox.executionTimeoutMs, 100, 60_000, 10_000),
    maxCallsPerMinute: clampInt(sandbox.maxCallsPerMinute, 1, 1000, 60),
  };
}

function parseVerificationConfig(raw: unknown): VerificationConfig {
  const ver = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      ver,
      ["requireSignature", "polValidation", "autoScan"],
      "verification config",
    );
  }

  return {
    requireSignature: ver.requireSignature !== false,
    polValidation: ver.polValidation !== false,
    autoScan: ver.autoScan !== false,
  };
}

export const semanticSkillsConfigSchema = {
  parse(value: unknown): SemanticSkillsConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("semantic skills config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["cortex", "agentNamespace", "skillSandbox", "verification", "hotReload"],
      "semantic skills config",
    );

    const cortex = parseCortexConfig(cfg.cortex);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const skillSandbox = parseSandboxConfig(cfg.skillSandbox);
    const verification = parseVerificationConfig(cfg.verification);
    const hotReload = cfg.hotReload === true;

    return { cortex, agentNamespace, skillSandbox, verification, hotReload };
  },
  uiHints: {
    "cortex.host": {
      label: "Cortex Host",
      placeholder: DEFAULT_HOST,
      advanced: true,
      help: "Hostname where AIngle Cortex is listening",
    },
    "cortex.port": {
      label: "Cortex Port",
      placeholder: String(DEFAULT_PORT),
      advanced: true,
      help: "Port for Cortex REST API",
    },
    "cortex.authToken": {
      label: "Cortex Auth Token",
      sensitive: true,
      placeholder: "Bearer ...",
      help: "Optional authentication token for Cortex API (or use ${CORTEX_AUTH_TOKEN})",
    },
    agentNamespace: {
      label: "Agent Namespace",
      placeholder: DEFAULT_NAMESPACE,
      advanced: true,
      help: "RDF namespace prefix for skill data",
    },
  },
};

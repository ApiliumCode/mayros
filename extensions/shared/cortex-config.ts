/**
 * Unified Cortex configuration types and parsers.
 *
 * Shared across all MAYROS extensions that talk to AIngle Cortex.
 */

import type { ResilienceConfig } from "./cortex-resilience.js";

// ============================================================================
// Types
// ============================================================================

export type P2pConfig = {
  enabled: boolean;
  port: number;
  seed?: string;
  manualPeers: string[];
  mdns: boolean;
};

export type CortexConfig = {
  host: string;
  port: number;
  binaryPath?: string;
  autoStart?: boolean;
  authToken?: string;
  resilience?: ResilienceConfig;
  requireAuth?: boolean;
  strictVersionCheck?: boolean;
  p2p?: P2pConfig;
};

// ============================================================================
// Helpers
// ============================================================================

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 19090;

export function assertAllowedKeys(
  value: Record<string, unknown>,
  allowed: string[],
  label: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

export function resolveEnvVars(value: string): string {
  return value.replace(/\$\{([^}]+)\}/g, (_, envVar) => {
    const envValue = process.env[envVar];
    if (!envValue) {
      throw new Error(`Environment variable ${envVar} is not set`);
    }
    return envValue;
  });
}

/**
 * Parse a raw config object into a validated `CortexConfig`.
 *
 * Accepted keys: host, port, binaryPath, autoStart, authToken, resilience.
 * Unknown keys throw. Defaults: 127.0.0.1:19090, no auth.
 */
export function parseCortexConfig(raw: unknown): CortexConfig {
  const cortex = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      cortex,
      [
        "host",
        "port",
        "binaryPath",
        "autoStart",
        "authToken",
        "resilience",
        "requireAuth",
        "strictVersionCheck",
        "p2p",
      ],
      "cortex config",
    );
  }

  const host = typeof cortex.host === "string" ? cortex.host : DEFAULT_HOST;
  const port = typeof cortex.port === "number" ? Math.floor(cortex.port) : DEFAULT_PORT;
  if (port < 1 || port > 65535) {
    throw new Error("cortex.port must be between 1 and 65535");
  }

  const binaryPath = typeof cortex.binaryPath === "string" ? cortex.binaryPath : undefined;
  const autoStart = cortex.autoStart !== false;
  const authToken =
    typeof cortex.authToken === "string" ? resolveEnvVars(cortex.authToken) : undefined;
  const resilience = parseResilienceConfig(cortex.resilience);
  const requireAuth = cortex.requireAuth === true;
  const strictVersionCheck = cortex.strictVersionCheck === true;
  const p2p = parseP2pConfig(cortex.p2p);

  return {
    host,
    port,
    binaryPath,
    autoStart,
    authToken,
    resilience,
    requireAuth,
    strictVersionCheck,
    p2p,
  };
}

export function parseP2pConfig(raw: unknown): P2pConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const p = raw as Record<string, unknown>;
  assertAllowedKeys(p, ["enabled", "port", "seed", "manualPeers", "mdns"], "p2p config");

  const enabled = p.enabled === true;
  const port = typeof p.port === "number" ? Math.floor(p.port) : 19091;
  if (port < 1024 || port > 65535) {
    throw new Error("p2p.port must be between 1024 and 65535");
  }

  const seed = typeof p.seed === "string" ? p.seed : undefined;
  if (seed !== undefined) {
    if (!/^[a-zA-Z0-9_-]+$/.test(seed)) {
      throw new Error("p2p.seed must be alphanumeric (plus _ and -)");
    }
  }

  const manualPeers = Array.isArray(p.manualPeers)
    ? p.manualPeers
        .filter((v): v is string => typeof v === "string")
        .filter((v) => /^[^:]+:\d+$/.test(v))
    : [];

  const mdns = p.mdns === true;

  return { enabled, port, seed, manualPeers, mdns };
}

function parseResilienceConfig(raw: unknown): ResilienceConfig | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  assertAllowedKeys(
    r,
    ["timeoutMs", "maxRetries", "retryDelayMs", "circuitThreshold", "circuitResetMs"],
    "resilience config",
  );
  return {
    timeoutMs: typeof r.timeoutMs === "number" ? Math.floor(r.timeoutMs) : undefined,
    maxRetries: typeof r.maxRetries === "number" ? Math.floor(r.maxRetries) : undefined,
    retryDelayMs: typeof r.retryDelayMs === "number" ? Math.floor(r.retryDelayMs) : undefined,
    circuitThreshold:
      typeof r.circuitThreshold === "number" ? Math.floor(r.circuitThreshold) : undefined,
    circuitResetMs: typeof r.circuitResetMs === "number" ? Math.floor(r.circuitResetMs) : undefined,
  };
}

/**
 * IoT Bridge — configuration types and parser.
 */

import type { ResilienceConfig } from "../shared/cortex-resilience.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type IoTNodeConfig = {
  id: string;
  host: string;
  port: number;
  label?: string;
};

export type IoTBridgeConfig = {
  nodes: IoTNodeConfig[];
  pollIntervalMs: number;
  resilience: ResilienceConfig;
  fleetPersistPath: string;
  injectContext: boolean;
  maxNodes: number;
};

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_PORT = 19090;
const DEFAULT_FLEET_PERSIST_PATH = "~/.mayros/iot-fleet.json";
const DEFAULT_MAX_NODES = 50;

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function parseResilienceConfig(raw: unknown): ResilienceConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
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

const NODE_ID_RE = /^[a-zA-Z0-9][a-zA-Z0-9_-]*$/;

function parseNodeConfig(raw: unknown, index: number): IoTNodeConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`nodes[${index}] must be an object`);
  }
  const n = raw as Record<string, unknown>;
  assertAllowedKeys(n, ["id", "host", "port", "label"], `nodes[${index}]`);

  const host = typeof n.host === "string" ? n.host : undefined;
  if (!host) {
    throw new Error(`nodes[${index}].host is required`);
  }

  const id = typeof n.id === "string" ? n.id : host.replace(/\./g, "-");
  if (!NODE_ID_RE.test(id)) {
    throw new Error(
      `nodes[${index}].id "${id}" must be alphanumeric (hyphens/underscores allowed, cannot start with hyphen/underscore)`,
    );
  }

  const port = typeof n.port === "number" ? Math.floor(n.port) : DEFAULT_PORT;
  if (port < 1 || port > 65535) {
    throw new Error(`nodes[${index}].port must be between 1 and 65535`);
  }

  const label = typeof n.label === "string" ? n.label : undefined;

  return { id, host, port, label };
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

export const iotBridgeConfigSchema = {
  parse(value: unknown): IoTBridgeConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return {
        nodes: [],
        pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
        resilience: {},
        fleetPersistPath: DEFAULT_FLEET_PERSIST_PATH,
        injectContext: true,
        maxNodes: DEFAULT_MAX_NODES,
      };
    }

    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["nodes", "pollIntervalMs", "resilience", "fleetPersistPath", "injectContext", "maxNodes"],
      "iot-bridge config",
    );

    const nodesRaw = Array.isArray(cfg.nodes) ? cfg.nodes : [];
    const nodes = nodesRaw.map((n, i) => parseNodeConfig(n, i));

    const pollIntervalMs =
      typeof cfg.pollIntervalMs === "number"
        ? Math.floor(cfg.pollIntervalMs)
        : DEFAULT_POLL_INTERVAL_MS;
    if (pollIntervalMs < 1000) {
      throw new Error("pollIntervalMs must be at least 1000");
    }

    const resilience = parseResilienceConfig(cfg.resilience);

    const fleetPersistPath =
      typeof cfg.fleetPersistPath === "string" ? cfg.fleetPersistPath : DEFAULT_FLEET_PERSIST_PATH;

    const injectContext = cfg.injectContext !== false;

    const maxNodes =
      typeof cfg.maxNodes === "number" ? Math.floor(cfg.maxNodes) : DEFAULT_MAX_NODES;
    if (maxNodes < 1) {
      throw new Error("maxNodes must be at least 1");
    }

    return { nodes, pollIntervalMs, resilience, fleetPersistPath, injectContext, maxNodes };
  },
};

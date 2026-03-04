/**
 * Cortex Sync Configuration.
 *
 * Manages peer connections, sync intervals, namespace filtering,
 * and conflict resolution strategy for cross-device synchronization.
 */

import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";

export type { CortexConfig };

// ============================================================================
// Types
// ============================================================================

export type ConflictStrategy =
  | "last-writer-wins"
  | "keep-both"
  | "local-priority"
  | "remote-priority";

export type SyncPeerConfig = {
  nodeId: string;
  endpoint: string;
  namespaces: string[];
  enabled: boolean;
};

export type SyncConfig = {
  intervalSeconds: number;
  autoSync: boolean;
  conflictStrategy: ConflictStrategy;
  maxTriplesPerSync: number;
  syncTimeoutMs: number;
};

export type DiscoveryConfig = {
  bonjourEnabled: boolean;
  bonjourServiceType: string;
  manualPeers: SyncPeerConfig[];
};

export type CortexSyncConfig = {
  cortex: CortexConfig;
  namespace: string;
  sync: SyncConfig;
  discovery: DiscoveryConfig;
};

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_INTERVAL_SECONDS = 300;
const DEFAULT_AUTO_SYNC = false;
const DEFAULT_CONFLICT_STRATEGY: ConflictStrategy = "last-writer-wins";
const DEFAULT_MAX_TRIPLES_PER_SYNC = 5000;
const DEFAULT_SYNC_TIMEOUT_MS = 30000;
const DEFAULT_BONJOUR_ENABLED = false;
const DEFAULT_BONJOUR_SERVICE_TYPE = "_mayros-cortex._tcp";

const VALID_CONFLICT_STRATEGIES: ConflictStrategy[] = [
  "last-writer-wins",
  "keep-both",
  "local-priority",
  "remote-priority",
];

// ============================================================================
// Parsers
// ============================================================================

function parseSyncConfig(raw: unknown): SyncConfig {
  const sync = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      sync,
      ["intervalSeconds", "autoSync", "conflictStrategy", "maxTriplesPerSync", "syncTimeoutMs"],
      "sync config",
    );
  }

  const intervalSeconds =
    typeof sync.intervalSeconds === "number"
      ? Math.max(10, Math.floor(sync.intervalSeconds))
      : DEFAULT_INTERVAL_SECONDS;

  const autoSync = typeof sync.autoSync === "boolean" ? sync.autoSync : DEFAULT_AUTO_SYNC;

  let conflictStrategy = DEFAULT_CONFLICT_STRATEGY;
  if (
    typeof sync.conflictStrategy === "string" &&
    VALID_CONFLICT_STRATEGIES.includes(sync.conflictStrategy as ConflictStrategy)
  ) {
    conflictStrategy = sync.conflictStrategy as ConflictStrategy;
  }

  const maxTriplesPerSync =
    typeof sync.maxTriplesPerSync === "number"
      ? Math.max(100, Math.min(50000, Math.floor(sync.maxTriplesPerSync)))
      : DEFAULT_MAX_TRIPLES_PER_SYNC;

  const syncTimeoutMs =
    typeof sync.syncTimeoutMs === "number"
      ? Math.max(5000, Math.min(120000, Math.floor(sync.syncTimeoutMs)))
      : DEFAULT_SYNC_TIMEOUT_MS;

  return { intervalSeconds, autoSync, conflictStrategy, maxTriplesPerSync, syncTimeoutMs };
}

function parsePeerConfig(raw: unknown): SyncPeerConfig {
  const peer = (raw ?? {}) as Record<string, unknown>;
  return {
    nodeId: typeof peer.nodeId === "string" ? peer.nodeId : "",
    endpoint: typeof peer.endpoint === "string" ? peer.endpoint : "",
    namespaces: Array.isArray(peer.namespaces)
      ? peer.namespaces.filter((n): n is string => typeof n === "string")
      : [],
    enabled: peer.enabled !== false,
  };
}

function parseDiscoveryConfig(raw: unknown): DiscoveryConfig {
  const discovery = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      discovery,
      ["bonjourEnabled", "bonjourServiceType", "manualPeers"],
      "discovery config",
    );
  }

  const bonjourEnabled =
    typeof discovery.bonjourEnabled === "boolean"
      ? discovery.bonjourEnabled
      : DEFAULT_BONJOUR_ENABLED;

  const bonjourServiceType =
    typeof discovery.bonjourServiceType === "string"
      ? discovery.bonjourServiceType
      : DEFAULT_BONJOUR_SERVICE_TYPE;

  const manualPeers = Array.isArray(discovery.manualPeers)
    ? discovery.manualPeers.map(parsePeerConfig).filter((p) => p.nodeId && p.endpoint)
    : [];

  return { bonjourEnabled, bonjourServiceType, manualPeers };
}

export function parseCortexSyncConfig(raw: unknown): CortexSyncConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;

  const cortex = parseCortexConfig(cfg.cortex ?? {});
  const namespace = typeof cfg.namespace === "string" ? cfg.namespace : DEFAULT_NAMESPACE;
  const sync = parseSyncConfig(cfg.sync);
  const discovery = parseDiscoveryConfig(cfg.discovery);

  return { cortex, namespace, sync, discovery };
}

// ============================================================================
// UI Hints (for mayros doctor / config validation)
// ============================================================================

export const cortexSyncConfigUiHints = {
  "sync.intervalSeconds": {
    type: "number",
    default: DEFAULT_INTERVAL_SECONDS,
    min: 10,
    description: "Seconds between sync cycles",
  },
  "sync.autoSync": {
    type: "boolean",
    default: DEFAULT_AUTO_SYNC,
    description: "Auto-sync on session end and config changes",
  },
  "sync.conflictStrategy": {
    type: "enum",
    values: VALID_CONFLICT_STRATEGIES,
    default: DEFAULT_CONFLICT_STRATEGY,
  },
  "sync.maxTriplesPerSync": {
    type: "number",
    default: DEFAULT_MAX_TRIPLES_PER_SYNC,
    min: 100,
    max: 50000,
  },
  "discovery.bonjourEnabled": {
    type: "boolean",
    default: DEFAULT_BONJOUR_ENABLED,
    description: "Enable local network peer discovery",
  },
  "discovery.manualPeers": { type: "array", description: "Manually configured peers" },
} as const;

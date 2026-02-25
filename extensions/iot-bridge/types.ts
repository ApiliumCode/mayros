/**
 * IoT Bridge — TypeScript mirrors of aingle_minimal REST API response types.
 */

// ---------------------------------------------------------------------------
// Generic API envelope (matches Rust ApiResponse<T>)
// ---------------------------------------------------------------------------

export type ApiResponse<T> = {
  success: boolean;
  data?: T;
  error?: string;
};

// ---------------------------------------------------------------------------
// GET /api/v1/info
// ---------------------------------------------------------------------------

export type NodeInfoResponse = {
  node_id: string;
  version: string;
  uptime_secs: number;
  entries_count: number;
  peers_count: number;
  storage_backend: string;
  features: string[];
};

// ---------------------------------------------------------------------------
// GET /api/v1/stats
// ---------------------------------------------------------------------------

export type StatsResponse = {
  entries_count: number;
  actions_count: number;
  storage_used: number;
  peer_count: number;
  uptime_secs: number;
  gossip_rounds: number;
  sync_success: number;
  sync_failed: number;
};

// ---------------------------------------------------------------------------
// GET /api/v1/peers
// ---------------------------------------------------------------------------

export type PeerResponse = {
  addr: string;
  quality: number;
  latest_seq: number;
  last_seen_secs: number;
};

// ---------------------------------------------------------------------------
// POST /api/v1/entries
// ---------------------------------------------------------------------------

export type CreateEntryRequest = {
  data: unknown;
};

export type CreateEntryResponse = {
  hash: string;
  seq: number;
  timestamp: number;
};

// ---------------------------------------------------------------------------
// GET /api/v1/entries/:hash
// ---------------------------------------------------------------------------

export type GetEntryResponse = {
  hash: string;
  entry_type: string;
  content: unknown;
  size: number;
};

// ---------------------------------------------------------------------------
// Observation payload (sent via POST /api/v1/entries)
// ---------------------------------------------------------------------------

export type ObservationPayload = {
  type: "observation";
  obs_type: string;
  value: number;
  timestamp: number;
  confidence?: number;
  metadata?: Record<string, unknown>;
};

// ---------------------------------------------------------------------------
// Runtime node status (used by FleetManager)
// ---------------------------------------------------------------------------

export type NodeStatus = {
  id: string;
  label?: string;
  host: string;
  port: number;
  online: boolean;
  lastCheckedMs: number;
  info?: NodeInfoResponse;
  stats?: StatsResponse;
  error?: string;
};

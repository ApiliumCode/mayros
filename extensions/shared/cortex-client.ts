/**
 * Unified Cortex HTTP Client.
 *
 * Single CortexClient class used by every MAYROS extension that talks to
 * AIngle Cortex. Consolidates DTOs, methods, resilience (CircuitBreaker +
 * resilientFetch), and error handling.
 */

import type { CortexConfig } from "./cortex-config.js";
import { CircuitBreaker, resilientFetch, type ResilienceConfig } from "./cortex-resilience.js";

// Re-export config for convenience
export type { CortexConfig, P2pConfig } from "./cortex-config.js";
export {
  parseCortexConfig,
  parseP2pConfig,
  assertAllowedKeys,
  resolveEnvVars,
} from "./cortex-config.js";

// ============================================================================
// DTOs — mirror Rust types from aingle_cortex/src/rest/*.rs
// ============================================================================

export type ValueDto = string | number | boolean | { node: string };

export type TripleDto = {
  id?: string;
  subject: string;
  predicate: string;
  object: ValueDto;
  created_at?: string;
};

export type CreateTripleRequest = {
  subject: string;
  predicate: string;
  object: ValueDto;
};

export type ListTriplesQuery = {
  subject?: string;
  predicate?: string;
  object?: string;
  limit?: number;
  offset?: number;
};

export type ListTriplesResponse = {
  triples: TripleDto[];
  total: number;
  limit?: number;
  offset?: number;
};

export type PatternQueryRequest = {
  subject?: string;
  predicate?: string;
  object?: ValueDto;
  limit?: number;
};

export type PatternQueryResponse = {
  matches: TripleDto[];
  total: number;
  pattern?: {
    subject?: string;
    predicate?: string;
    object?: unknown;
  };
};

export type ListSubjectsQuery = {
  predicate?: string;
  limit?: number;
};

export type ListSubjectsResponse = {
  subjects: string[];
  total: number;
};

export type ValidateRequest = {
  triples?: Array<{
    subject: string;
    predicate: string;
    object: ValueDto;
  }>;
  statements?: Array<{ subject: string; predicate: string; object: unknown }>;
  rule_set?: string;
};

export type ValidationMessage = {
  level: string;
  message: string;
  rule?: string;
};

export type TripleValidationResult = {
  triple: TripleDto;
  valid: boolean;
  messages: ValidationMessage[];
};

export type ValidateResponse = {
  valid: boolean;
  results?: TripleValidationResult[];
  messages?: Array<{ level: string; message: string }>;
  proof_hash?: string;
};

export type VerifyProofRequest = {
  proof_hash: string;
  statements?: Array<{
    subject: string;
    predicate: string;
    object: ValueDto;
  }>;
};

export type VerifyProofResponse = {
  valid: boolean;
  details: {
    proof_hash: string;
    steps_verified: number;
    statements_covered: number;
    verified_at: string;
  };
};

export type SubmitProofRequest = {
  proof_type: string;
  proof_data?: unknown;
  subject?: string;
  predicate?: string;
  metadata?:
    | {
        submitter?: string;
        tags?: string[];
        extra?: Record<string, unknown>;
      }
    | Record<string, string>;
};

export type ProofResponse = {
  id: string;
  proof_type: string;
  created_at: string;
  verified?: boolean;
  verified_at?: string;
  subject?: string;
  predicate?: string;
  status?: string;
  metadata?: {
    submitter?: string;
    tags?: string[];
    extra?: Record<string, unknown>;
  };
  size_bytes?: number;
};

export type ProofStatsResponse = {
  total_proofs: number;
  proofs_by_type: Record<string, number>;
  total_verifications: number;
  successful_verifications: number;
  failed_verifications: number;
  cache_hits: number;
  cache_misses: number;
  cache_hit_rate: number;
  total_size_bytes: number;
};

export type GraphStatsDto = {
  triple_count: number;
  subject_count: number;
  predicate_count: number;
  object_count?: number;
};

export type ServerStatsDto = {
  connected_clients: number;
  uptime_seconds: number;
  version: string;
};

export type StatsResponse = {
  graph: GraphStatsDto;
  server: ServerStatsDto;
};

export type HealthResponse = {
  status: string;
  version?: string;
  components?: {
    graph: { status: string; message?: string };
    logic: { status: string; message?: string };
  };
};

/** Semantic-skills TripleMatch alias (object is `unknown`, includes hash). */
export type TripleMatch = {
  subject: string;
  predicate: string;
  object: unknown;
  hash?: string;
};

/** Trace event payload for the /api/v1/events endpoint. */
export type EventPayload = {
  subject: string;
  type: string;
  agentId: string;
  timestamp: string;
  session?: string;
  parentEvent?: string;
  durationMs?: number;
  fields: Record<string, string>;
};

/** Trace event as stored/returned by Cortex. */
export type TraceEventDto = {
  id: string;
  type: string;
  agentId: string;
  timestamp: string;
  session?: string;
  parentEvent?: string;
  durationMs?: number;
  fields: Record<string, string>;
};

// ============================================================================
// P2P DTOs — mirror Rust types from aingle_cortex/src/p2p/manager.rs
// ============================================================================

export type P2pStatusResponse = {
  node_id: string;
  enabled: boolean;
  port: number;
  peer_count: number;
  connected_peers: P2pPeerDto[];
  gossip_stats: P2pGossipStats;
  sync_stats: P2pSyncStats;
};

export type P2pPeerDto = {
  addr: string;
  connected: boolean;
};

export type P2pGossipStats = {
  round: number;
  pending_announcements: number;
  known_ids: number;
  bloom_filter_items: number;
  bloom_filter_fpr: number;
};

export type P2pSyncStats = {
  peer_count: number;
  local_ids: number;
  total_successful_syncs: number;
  total_failed_syncs: number;
};

export type P2pAddPeerResponse = {
  status: string;
  addr: string;
};

export type P2pDisconnectResponse = {
  status: string;
};

// ============================================================================
// DAG DTOs
// ============================================================================

export type DagActionDto = {
  hash: string;
  parents: string[];
  author: string;
  seq: number;
  timestamp: string;
  payload_type: string;
  payload_summary: string;
  signed: boolean;
  signature: string | null;
};

export type DagTipsResponse = { tips: string[]; count: number };

export type DagStatsResponse = { action_count: number; tip_count: number };

export type DagTimeTravelResponse = {
  target_hash: string;
  target_timestamp: string;
  actions_replayed: number;
  triple_count: number;
  triples: Array<{ subject: string; predicate: string; object: unknown }>;
};

export type DagDiffResponse = {
  from: string;
  to: string;
  action_count: number;
  actions: DagActionDto[];
};

export type DagPruneRequest = {
  policy: "keep_all" | "keep_since" | "keep_last" | "keep_depth";
  value?: number;
  create_checkpoint?: boolean;
};

export type DagPruneResponse = {
  pruned_count: number;
  retained_count: number;
  checkpoint_hash: string | null;
};

export type DagSyncRequest = { local_tips: string[]; want?: string[] };
export type DagSyncResponse = {
  actions: DagActionDto[];
  remote_tips: string[];
  action_count: number;
};
export type DagPullRequest = { peer_url: string };
export type DagPullResponse = { ingested: number; already_had: number; remote_tips: string[] };
export type DagVerifyResponse = {
  valid: boolean;
  public_key: string;
  action_hash: string;
  detail: string;
};

// ============================================================================
// Error
// ============================================================================

export class CortexError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CortexError";
  }
}

// ============================================================================
// Structural interfaces — use when you only need a subset of the client
// ============================================================================

/**
 * Minimal interface for components that only need triple CRUD + query.
 * Satisfied by CortexClient.
 */
export type CortexClientLike = {
  createTriple(req: {
    subject: string;
    predicate: string;
    object: ValueDto;
  }): Promise<TripleDto | { hash?: string }>;

  listTriples(query: {
    subject?: string;
    predicate?: string;
    limit?: number;
  }): Promise<{ triples: TripleDto[]; total: number }>;

  patternQuery(req: {
    subject?: string;
    predicate?: string;
    object?: ValueDto;
    limit?: number;
  }): Promise<{ matches: TripleDto[]; total: number }>;

  deleteTriple(id: string): Promise<void>;
};

/**
 * Minimal interface for verification/reputation components.
 * Satisfied by CortexClient.
 */
export type CortexLike = {
  isHealthy(): Promise<boolean>;
  validateSkillManifest(manifest: {
    assertions: Array<{ predicate: string; requireProof: boolean }>;
    namespace: string;
  }): Promise<{ valid: boolean; errors: string[] }>;
  createSandbox(namespace: string, ttlSeconds?: number): Promise<{ id: string; namespace: string }>;
  deleteSandbox(id: string): Promise<void>;
};

// ============================================================================
// Client
// ============================================================================

export class CortexClient implements CortexClientLike, CortexLike {
  readonly baseUrl: string;
  private readonly headers: Record<string, string>;
  readonly breaker: CircuitBreaker;
  private readonly resilienceConfig: ResilienceConfig;
  private destroyed = false;

  constructor(config: CortexConfig) {
    this.baseUrl = `http://${config.host}:${config.port}`;
    this.headers = { "Content-Type": "application/json" };
    if (config.authToken) {
      this.headers["Authorization"] = config.authToken;
    }
    this.resilienceConfig = config.resilience ?? {};
    this.breaker = new CircuitBreaker({
      threshold: config.resilience?.circuitThreshold,
      resetMs: config.resilience?.circuitResetMs,
    });
  }

  // ---------- lifecycle ----------

  /**
   * Destroy the client: reset the circuit breaker and reject all future requests.
   * Idempotent — safe to call multiple times.
   */
  destroy(): void {
    this.destroyed = true;
    this.breaker.reset();
  }

  /** Whether this client has been destroyed. */
  get isDestroyed(): boolean {
    return this.destroyed;
  }

  // ---------- helpers ----------

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    if (this.destroyed) {
      throw new CortexError("Client has been destroyed", 0, "CLIENT_DESTROYED");
    }
    const url = `${this.baseUrl}${path}`;
    const init: RequestInit = {
      method,
      headers: this.headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    };

    let res: Response;
    try {
      res = await resilientFetch(url, init, this.resilienceConfig, this.breaker);
    } catch (err) {
      throw new CortexError(`Cortex unreachable at ${url}: ${String(err)}`, 0, "CONNECTION_ERROR");
    }

    if (res.status === 204) {
      return undefined as T;
    }

    if (!res.ok) {
      let errorBody: { error?: string; code?: string; details?: string } = {};
      try {
        errorBody = (await res.json()) as typeof errorBody;
      } catch {
        // non-JSON error body
      }
      throw new CortexError(
        errorBody.error ?? `Cortex ${method} ${path} failed with ${res.status}`,
        res.status,
        errorBody.code,
        errorBody.details,
      );
    }

    return (await res.json()) as T;
  }

  private queryString(params: Record<string, string | number | boolean | undefined>): string {
    const parts: string[] = [];
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null) {
        parts.push(`${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`);
      }
    }
    return parts.length > 0 ? `?${parts.join("&")}` : "";
  }

  // ---------- Triples ----------

  async createTriple(req: CreateTripleRequest): Promise<TripleDto> {
    return this.request<TripleDto>("POST", "/api/v1/triples", req);
  }

  async getTriple(id: string): Promise<TripleDto> {
    return this.request<TripleDto>("GET", `/api/v1/triples/${encodeURIComponent(id)}`);
  }

  async deleteTriple(id: string): Promise<void> {
    return this.request<void>("DELETE", `/api/v1/triples/${encodeURIComponent(id)}`);
  }

  async listTriples(query?: ListTriplesQuery): Promise<ListTriplesResponse> {
    const qs = this.queryString({
      subject: query?.subject,
      predicate: query?.predicate,
      object: query?.object,
      limit: query?.limit,
      offset: query?.offset,
    });
    return this.request<ListTriplesResponse>("GET", `/api/v1/triples${qs}`);
  }

  /**
   * List triples created after `since` (ISO timestamp).
   * Client-side filter on `created_at` since Cortex REST API doesn't natively
   * support timestamp-based queries.
   */
  async listTriplesSince(
    since: string,
    query?: Omit<ListTriplesQuery, "offset">,
  ): Promise<ListTriplesResponse> {
    const result = await this.listTriples({ ...query, limit: query?.limit ?? 10000 });
    const sinceRaw = new Date(since).getTime();
    const sinceMs = Number.isNaN(sinceRaw) ? 0 : sinceRaw;
    const filtered = result.triples.filter((t) => {
      if (!t.created_at) return false;
      const ts = new Date(t.created_at).getTime();
      return !Number.isNaN(ts) && ts >= sinceMs;
    });
    return { triples: filtered, total: filtered.length };
  }

  // ---------- Query ----------

  async patternQuery(req: PatternQueryRequest): Promise<PatternQueryResponse> {
    return this.request<PatternQueryResponse>("POST", "/api/v1/query", req);
  }

  async listSubjects(query?: ListSubjectsQuery): Promise<ListSubjectsResponse> {
    const qs = this.queryString({
      predicate: query?.predicate,
      limit: query?.limit,
    });
    return this.request<ListSubjectsResponse>("GET", `/api/v1/query/subjects${qs}`);
  }

  async listPredicates(query?: {
    namespace?: string;
    limit?: number;
  }): Promise<{ predicates: string[]; total: number }> {
    const qs = query ? this.queryString(query) : "";
    return this.request("GET", `/api/v1/query/predicates${qs}`);
  }

  // ---------- Validation ----------

  async validate(req: ValidateRequest): Promise<ValidateResponse> {
    return this.request<ValidateResponse>("POST", "/api/v1/validate", req);
  }

  async verify(req: VerifyProofRequest): Promise<VerifyProofResponse> {
    return this.request<VerifyProofResponse>("POST", "/api/v1/verify", req);
  }

  // ---------- Proof API ----------

  async submitProof(req: SubmitProofRequest): Promise<ProofResponse> {
    return this.request("POST", "/api/v1/proofs", req);
  }

  async getProof(id: string): Promise<ProofResponse> {
    return this.request<ProofResponse>("GET", `/api/v1/proofs/${encodeURIComponent(id)}`);
  }

  async deleteProof(id: string): Promise<{ proof_id: string; deleted: boolean }> {
    return this.request("DELETE", `/api/v1/proofs/${encodeURIComponent(id)}`);
  }

  async verifyProof(id: string): Promise<VerifyProofResponse> {
    return this.request<VerifyProofResponse>(
      "GET",
      `/api/v1/proofs/${encodeURIComponent(id)}/verify`,
    );
  }

  async listProofs(opts?: {
    proof_type?: string;
    verified?: boolean;
    limit?: number;
  }): Promise<{ count: number; proofs: ProofResponse[] }> {
    const qs = this.queryString({
      proof_type: opts?.proof_type,
      verified: opts?.verified,
      limit: opts?.limit,
    });
    return this.request("GET", `/api/v1/proofs${qs}`);
  }

  async proofStats(): Promise<ProofStatsResponse> {
    return this.request<ProofStatsResponse>("GET", "/api/v1/proofs/stats");
  }

  async batchVerify(
    proofIds: string[],
  ): Promise<{ results: Array<{ id: string; verified: boolean }> }> {
    return this.request("POST", "/api/v1/proofs/verify/batch", { proof_ids: proofIds });
  }

  // ---------- Skill Verification (Phase 3 endpoints) ----------

  async validateSkillManifest(manifest: {
    assertions: Array<{ predicate: string; requireProof: boolean }>;
    namespace: string;
  }): Promise<{ valid: boolean; errors: string[] }> {
    return this.request("POST", "/api/v1/skills/validate", manifest);
  }

  async createSandbox(
    namespace: string,
    ttlSeconds?: number,
  ): Promise<{ id: string; namespace: string }> {
    return this.request("POST", "/api/v1/skills/sandbox", {
      namespace,
      ttl_seconds: ttlSeconds ?? 300,
    });
  }

  async deleteSandbox(id: string): Promise<void> {
    return this.request("DELETE", `/api/v1/skills/sandbox/${encodeURIComponent(id)}`);
  }

  // ---------- Reputation ----------

  async getConsistency(
    agentId: string,
  ): Promise<{ score: number; total: number; verified: number }> {
    return this.request("GET", `/api/v1/agents/${encodeURIComponent(agentId)}/consistency`);
  }

  async batchVerifyAssertions(
    assertions: Array<{ subject: string; predicate: string }>,
  ): Promise<{ results: Array<{ subject: string; predicate: string; verified: boolean }> }> {
    return this.request("POST", "/api/v1/assertions/verify-batch", { assertions });
  }

  // ---------- Events (observability) ----------

  async emitEvents(events: EventPayload[]): Promise<Response> {
    if (this.destroyed) {
      throw new CortexError("Client has been destroyed", 0, "CLIENT_DESTROYED");
    }
    const url = `${this.baseUrl}/api/v1/events`;
    return resilientFetch(
      url,
      {
        method: "POST",
        headers: this.headers,
        body: JSON.stringify({ events }),
      },
      this.resilienceConfig,
      this.breaker,
    );
  }

  async getEvents(
    params: Record<string, string | undefined>,
  ): Promise<{ events?: TraceEventDto[] }> {
    const qs = this.queryString(params as Record<string, string | undefined>);
    try {
      return await this.request("GET", `/api/v1/events${qs}`);
    } catch {
      return { events: [] };
    }
  }

  async getEvent(eventId: string): Promise<TraceEventDto> {
    return this.request("GET", `/api/v1/events/${encodeURIComponent(eventId)}`);
  }

  // ---------- Audit ----------

  async getAuditLog(params?: {
    user_id?: string;
    namespace?: string;
    action?: string;
    from?: string;
    to?: string;
    limit?: number;
  }): Promise<
    Array<{
      timestamp: string;
      user_id: string;
      namespace?: string;
      action: string;
      resource: string;
      details?: string;
      request_id?: string;
    }>
  > {
    const qs = params ? this.queryString(params) : "";
    return this.request("GET", `/api/v1/audit${qs}`);
  }

  async getAuditStats(): Promise<{
    total_entries: number;
    actions_by_type: Record<string, number>;
    entries_by_user: Record<string, number>;
    entries_by_namespace: Record<string, number>;
  }> {
    return this.request("GET", "/api/v1/audit/stats");
  }

  // ---------- Health / Stats ----------

  async health(): Promise<HealthResponse> {
    return this.request<HealthResponse>("GET", "/api/v1/health");
  }

  async stats(): Promise<StatsResponse> {
    return this.request<StatsResponse>("GET", "/api/v1/stats");
  }

  async isHealthy(): Promise<boolean> {
    try {
      const h = await this.health();
      return h.status === "healthy" || h.status === "ok";
    } catch {
      return false;
    }
  }

  // ---------- P2P (native QUIC gossip) ----------

  async p2pStatus(): Promise<P2pStatusResponse> {
    return this.request<P2pStatusResponse>("GET", "/api/v1/p2p/status");
  }

  async p2pListPeers(): Promise<P2pPeerDto[]> {
    const status = await this.p2pStatus();
    return status.connected_peers;
  }

  async p2pAddPeer(addr: string): Promise<P2pAddPeerResponse> {
    return this.request<P2pAddPeerResponse>("POST", "/api/v1/p2p/peers", { addr });
  }

  async p2pRemovePeer(addr: string): Promise<P2pDisconnectResponse> {
    return this.request<P2pDisconnectResponse>(
      "DELETE",
      `/api/v1/p2p/peers/${encodeURIComponent(addr)}`,
    );
  }

  /** Probe P2P availability. Returns status if enabled, null otherwise. */
  async p2pProbe(): Promise<P2pStatusResponse | null> {
    try {
      return await this.p2pStatus();
    } catch {
      return null;
    }
  }

  // ---------- Motomeru: Vector Search ----------

  async vectorSearch(req: {
    embedding: number[];
    k: number;
    min_similarity?: number;
    entry_type?: string;
    tags?: string[];
  }): Promise<unknown[]> {
    return this.request<unknown[]>("POST", "/api/v1/memory/search", req);
  }

  async vectorIndexStats(): Promise<{
    point_count: number;
    deleted_count: number;
    dimensions: number;
    memory_bytes: number;
  }> {
    return this.request("GET", "/api/v1/memory/index/stats");
  }

  async rebuildVectorIndex(): Promise<void> {
    return this.request("POST", "/api/v1/memory/index/rebuild");
  }

  // ---------- Semantic DAG ----------

  async dagTips(): Promise<DagTipsResponse> {
    return this.request<DagTipsResponse>("GET", "/api/v1/dag/tips");
  }

  async dagAction(hash: string): Promise<DagActionDto> {
    return this.request<DagActionDto>("GET", `/api/v1/dag/action/${encodeURIComponent(hash)}`);
  }

  async dagHistory(opts: {
    subject: string;
    limit?: number;
  }): Promise<{ actions: DagActionDto[] }> {
    const qs = this.queryString({ subject: opts.subject, limit: opts.limit });
    return this.request("GET", `/api/v1/dag/history${qs}`);
  }

  async dagChain(author: string, limit?: number): Promise<{ actions: DagActionDto[] }> {
    const qs = this.queryString({ author, limit });
    return this.request("GET", `/api/v1/dag/chain${qs}`);
  }

  async dagStats(): Promise<DagStatsResponse> {
    return this.request<DagStatsResponse>("GET", "/api/v1/dag/stats");
  }

  async dagPrune(req: DagPruneRequest): Promise<DagPruneResponse> {
    return this.request<DagPruneResponse>("POST", "/api/v1/dag/prune", req);
  }

  async dagAt(hash: string): Promise<DagTimeTravelResponse> {
    return this.request<DagTimeTravelResponse>("GET", `/api/v1/dag/at/${encodeURIComponent(hash)}`);
  }

  async dagDiff(from: string, to: string): Promise<DagDiffResponse> {
    const qs = this.queryString({ from, to });
    return this.request<DagDiffResponse>("GET", `/api/v1/dag/diff${qs}`);
  }

  async dagExport(format: string = "mermaid"): Promise<string> {
    if (this.destroyed) {
      throw new CortexError("Client has been destroyed", 0, "CLIENT_DESTROYED");
    }
    const url = `${this.baseUrl}/api/v1/dag/export?format=${encodeURIComponent(format)}`;
    const res = await resilientFetch(
      url,
      { method: "GET", headers: this.headers },
      this.resilienceConfig,
      this.breaker,
    );
    if (!res.ok) {
      throw new CortexError(`DAG export failed with ${res.status}`, res.status);
    }
    return res.text();
  }

  async dagSync(req: DagSyncRequest): Promise<DagSyncResponse> {
    return this.request<DagSyncResponse>("POST", "/api/v1/dag/sync", req);
  }

  async dagSyncPull(req: DagPullRequest): Promise<DagPullResponse> {
    return this.request<DagPullResponse>("POST", "/api/v1/dag/sync/pull", req);
  }

  async dagVerify(hash: string, publicKey: string): Promise<DagVerifyResponse> {
    return this.request<DagVerifyResponse>(
      "POST",
      `/api/v1/dag/verify/${encodeURIComponent(hash)}`,
      { public_key: publicKey },
    );
  }
}

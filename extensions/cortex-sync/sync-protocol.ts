/**
 * Cortex DAG Sync Protocol.
 *
 * Pull-based delta synchronization between Cortex instances.
 * Each node pulls deltas from its peers since the last sync timestamp.
 *
 * Conflict resolution: Last-Writer-Wins by `created_at` (default).
 * No deletions from remote — only additions are propagated.
 */

import type { CortexClient, TripleDto, CreateTripleRequest } from "../shared/cortex-client.js";
import type { ConflictStrategy } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type SyncPeer = {
  nodeId: string;
  endpoint: string;
  lastSyncAt: string;
  namespaces: string[];
};

export type SyncDelta = {
  since: string;
  nodeId: string;
  triples: TripleDto[];
  deletions: string[];
  syncedAt: string;
};

export type SyncConflict = {
  local: TripleDto;
  remote: TripleDto;
  resolution: "kept-local" | "kept-remote" | "kept-both";
};

export type SyncResult = {
  peerId: string;
  triplesReceived: number;
  triplesApplied: number;
  conflicts: SyncConflict[];
  syncedAt: string;
  durationMs: number;
};

// ============================================================================
// Delta building
// ============================================================================

/**
 * Build a delta of triples created since `since` for the given namespaces.
 */
export async function buildLocalDelta(
  client: CortexClient,
  namespaces: string[],
  since: string,
  limit: number = 5000,
): Promise<SyncDelta> {
  const allTriples: TripleDto[] = [];

  for (const ns of namespaces) {
    const result = await client.listTriples({
      subject: `${ns}:`,
      limit,
    });

    // Filter by created_at >= since (inclusive to avoid missing triples created
    // at the exact boundary timestamp; reconcile() deduplicates by exact key so
    // re-fetching boundary triples is harmless)
    const sinceRaw = new Date(since).getTime();
    const sinceMs = Number.isNaN(sinceRaw) ? 0 : sinceRaw;
    const filtered = result.triples.filter((t) => {
      if (!t.created_at) return false;
      const ts = new Date(t.created_at).getTime();
      return !Number.isNaN(ts) && ts >= sinceMs;
    });

    allTriples.push(...filtered);
  }

  // Sort by created_at ascending (NaN → 0)
  allTriples.sort((a, b) => {
    const aRaw = a.created_at ? new Date(a.created_at).getTime() : 0;
    const bRaw = b.created_at ? new Date(b.created_at).getTime() : 0;
    return (Number.isNaN(aRaw) ? 0 : aRaw) - (Number.isNaN(bRaw) ? 0 : bRaw);
  });

  // Cap to limit
  const capped = allTriples.slice(0, limit);

  return {
    since,
    nodeId: "",
    triples: capped,
    deletions: [],
    syncedAt: new Date().toISOString(),
  };
}

// ============================================================================
// Conflict detection & resolution
// ============================================================================

/**
 * Find conflicts between local and remote triples.
 * A conflict exists when both have the same subject+predicate but different objects.
 */
export function detectConflicts(
  local: TripleDto[],
  remote: TripleDto[],
): Array<{ local: TripleDto; remote: TripleDto }> {
  const localMap = new Map<string, TripleDto>();
  for (const t of local) {
    const key = `${t.subject}::${t.predicate}`;
    localMap.set(key, t);
  }

  const conflicts: Array<{ local: TripleDto; remote: TripleDto }> = [];
  for (const rt of remote) {
    const key = `${rt.subject}::${rt.predicate}`;
    const lt = localMap.get(key);
    if (lt && JSON.stringify(lt.object) !== JSON.stringify(rt.object)) {
      conflicts.push({ local: lt, remote: rt });
    }
  }

  return conflicts;
}

/**
 * Resolve a conflict using the configured strategy.
 */
export function resolveConflict(
  local: TripleDto,
  remote: TripleDto,
  strategy: ConflictStrategy,
): SyncConflict {
  switch (strategy) {
    case "last-writer-wins": {
      const localRaw = local.created_at ? new Date(local.created_at).getTime() : 0;
      const remoteRaw = remote.created_at ? new Date(remote.created_at).getTime() : 0;
      const localTime = Number.isNaN(localRaw) ? 0 : localRaw;
      const remoteTime = Number.isNaN(remoteRaw) ? 0 : remoteRaw;
      return {
        local,
        remote,
        resolution: remoteTime > localTime ? "kept-remote" : "kept-local",
      };
    }
    case "local-priority":
      return { local, remote, resolution: "kept-local" };
    case "remote-priority":
      return { local, remote, resolution: "kept-remote" };
    case "keep-both":
      return { local, remote, resolution: "kept-both" };
    default:
      return { local, remote, resolution: "kept-local" };
  }
}

// ============================================================================
// Reconciliation
// ============================================================================

/**
 * Reconcile local state with a remote delta.
 * Returns the list of triples to create locally and any conflicts.
 */
export function reconcile(
  localTriples: TripleDto[],
  remoteDelta: SyncDelta,
  strategy: ConflictStrategy,
): {
  toCreate: CreateTripleRequest[];
  conflicts: SyncConflict[];
} {
  const localKeys = new Set<string>();
  for (const t of localTriples) {
    localKeys.add(`${t.subject}::${t.predicate}::${JSON.stringify(t.object)}`);
  }

  const conflicts = detectConflicts(localTriples, remoteDelta.triples);
  const resolvedConflicts = conflicts.map((c) => resolveConflict(c.local, c.remote, strategy));

  // Remote triples to keep (conflict wins + new triples)
  const conflictRemoteKeep = new Set<string>();
  const conflictRemoteSkip = new Set<string>();
  for (const rc of resolvedConflicts) {
    const key = `${rc.remote.subject}::${rc.remote.predicate}`;
    if (rc.resolution === "kept-remote" || rc.resolution === "kept-both") {
      conflictRemoteKeep.add(key);
    } else {
      conflictRemoteSkip.add(key);
    }
  }

  const toCreate: CreateTripleRequest[] = [];

  for (const rt of remoteDelta.triples) {
    const exactKey = `${rt.subject}::${rt.predicate}::${JSON.stringify(rt.object)}`;
    const conflictKey = `${rt.subject}::${rt.predicate}`;

    // Skip if exact triple already exists locally
    if (localKeys.has(exactKey)) continue;

    // Skip if conflict resolved to keep local
    if (conflictRemoteSkip.has(conflictKey)) continue;

    // Add if new (no conflict) or conflict resolved to keep remote/both
    toCreate.push({
      subject: rt.subject,
      predicate: rt.predicate,
      object: rt.object,
    });
  }

  return { toCreate, conflicts: resolvedConflicts };
}

// ============================================================================
// Apply delta
// ============================================================================

/**
 * Apply reconciled triples to local Cortex.
 */
export async function applyDelta(
  client: CortexClient,
  toCreate: CreateTripleRequest[],
): Promise<number> {
  let applied = 0;
  for (const req of toCreate) {
    try {
      await client.createTriple(req);
      applied++;
    } catch {
      // Skip individual failures
    }
  }
  return applied;
}

// ============================================================================
// Full sync flow
// ============================================================================

/**
 * Execute a full sync cycle with a peer.
 *
 * 1. Build local delta since peer's last sync
 * 2. Fetch remote delta from peer's endpoint
 * 3. Reconcile remote delta with local state
 * 4. Apply new triples to local Cortex
 */
export async function syncWithPeer(
  localClient: CortexClient,
  peer: SyncPeer,
  opts: {
    conflictStrategy: ConflictStrategy;
    maxTriples: number;
    timeoutMs: number;
    fetchRemoteDelta: (peer: SyncPeer, since: string) => Promise<SyncDelta>;
  },
): Promise<SyncResult> {
  const start = Date.now();
  const since = peer.lastSyncAt || new Date(0).toISOString();

  // 1. Fetch remote delta
  const remoteDelta = await opts.fetchRemoteDelta(peer, since);

  // 2. Get local triples for conflicting namespaces
  const localTriples: TripleDto[] = [];
  for (const ns of peer.namespaces) {
    const result = await localClient.listTriples({
      subject: `${ns}:`,
      limit: opts.maxTriples,
    });
    localTriples.push(...result.triples);
  }

  // 3. Reconcile
  const { toCreate, conflicts } = reconcile(localTriples, remoteDelta, opts.conflictStrategy);

  // 4. Apply
  const applied = await applyDelta(localClient, toCreate);

  return {
    peerId: peer.nodeId,
    triplesReceived: remoteDelta.triples.length,
    triplesApplied: applied,
    conflicts,
    syncedAt: new Date().toISOString(),
    durationMs: Date.now() - start,
  };
}

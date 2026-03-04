/**
 * Cortex Sync Peer Manager.
 *
 * Manages peer discovery (Bonjour + manual), trust relationships,
 * and sync state persistence in Cortex.
 *
 * Peer state is stored as triples:
 *   {ns}:sync:peer:{nodeId}  →  endpoint, lastSyncAt, namespaces, status
 */

import { randomUUID } from "node:crypto";
import type {
  CortexClient,
  CreateTripleRequest,
  TripleDto,
  ValueDto,
} from "../shared/cortex-client.js";
import type { SyncPeerConfig } from "./config.js";
import type { SyncPeer, SyncResult } from "./sync-protocol.js";

// ============================================================================
// Types
// ============================================================================

export type PeerStatus = "active" | "paused" | "unreachable" | "removed";

export type PeerInfo = {
  nodeId: string;
  endpoint: string;
  namespaces: string[];
  status: PeerStatus;
  lastSyncAt: string;
  lastSyncResult?: string;
  addedAt: string;
  totalSyncs: number;
  totalTriplesSynced: number;
};

export type PeerDiscoveryResult = {
  nodeId: string;
  endpoint: string;
  source: "bonjour" | "manual";
};

// ============================================================================
// Namespace helpers
// ============================================================================

function peerSubject(ns: string, nodeId: string): string {
  return `${ns}:sync:peer:${nodeId}`;
}

function syncPredicate(ns: string, name: string): string {
  return `${ns}:sync:${name}`;
}

function stringValue(v: ValueDto): string {
  if (typeof v === "string") return v;
  if (typeof v === "number") return String(v);
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object" && v !== null && "node" in v) return v.node;
  return String(v);
}

function numberValue(v: ValueDto): number {
  if (typeof v === "number") return v;
  const n = Number(stringValue(v));
  return Number.isNaN(n) ? 0 : n;
}

// ============================================================================
// PeerManager class
// ============================================================================

export class PeerManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /**
   * Add a new peer from manual configuration or discovery.
   */
  async addPeer(config: SyncPeerConfig): Promise<PeerInfo> {
    const now = new Date().toISOString();
    const sub = peerSubject(this.ns, config.nodeId);

    const triples: CreateTripleRequest[] = [
      { subject: sub, predicate: syncPredicate(this.ns, "endpoint"), object: config.endpoint },
      {
        subject: sub,
        predicate: syncPredicate(this.ns, "namespaces"),
        object: config.namespaces.join(","),
      },
      {
        subject: sub,
        predicate: syncPredicate(this.ns, "status"),
        object: config.enabled ? "active" : "paused",
      },
      { subject: sub, predicate: syncPredicate(this.ns, "lastSyncAt"), object: "" },
      { subject: sub, predicate: syncPredicate(this.ns, "addedAt"), object: now },
      { subject: sub, predicate: syncPredicate(this.ns, "totalSyncs"), object: 0 },
      { subject: sub, predicate: syncPredicate(this.ns, "totalTriplesSynced"), object: 0 },
    ];

    for (const t of triples) {
      await this.client.createTriple(t);
    }

    return {
      nodeId: config.nodeId,
      endpoint: config.endpoint,
      namespaces: config.namespaces,
      status: config.enabled ? "active" : "paused",
      lastSyncAt: "",
      addedAt: now,
      totalSyncs: 0,
      totalTriplesSynced: 0,
    };
  }

  /**
   * Remove a peer (marks as "removed" in Cortex).
   */
  async removePeer(nodeId: string): Promise<boolean> {
    const sub = peerSubject(this.ns, nodeId);
    const existing = await this.client.listTriples({ subject: sub, limit: 20 });
    if (existing.triples.length === 0) return false;

    // Mark as removed rather than deleting
    await this.client.createTriple({
      subject: sub,
      predicate: syncPredicate(this.ns, "status"),
      object: "removed",
    });

    return true;
  }

  /**
   * Update peer status after a sync attempt.
   */
  async recordSyncResult(nodeId: string, result: SyncResult): Promise<void> {
    const sub = peerSubject(this.ns, nodeId);

    // Get current stats
    const existing = await this.getPeer(nodeId);
    const totalSyncs = (existing?.totalSyncs ?? 0) + 1;
    const totalTriplesSynced = (existing?.totalTriplesSynced ?? 0) + result.triplesApplied;

    const updates: CreateTripleRequest[] = [
      { subject: sub, predicate: syncPredicate(this.ns, "lastSyncAt"), object: result.syncedAt },
      {
        subject: sub,
        predicate: syncPredicate(this.ns, "lastSyncResult"),
        object: `${result.triplesApplied} applied, ${result.conflicts.length} conflicts`,
      },
      { subject: sub, predicate: syncPredicate(this.ns, "status"), object: "active" },
      { subject: sub, predicate: syncPredicate(this.ns, "totalSyncs"), object: totalSyncs },
      {
        subject: sub,
        predicate: syncPredicate(this.ns, "totalTriplesSynced"),
        object: totalTriplesSynced,
      },
    ];

    for (const t of updates) {
      await this.client.createTriple(t);
    }
  }

  /**
   * Mark a peer as unreachable after a failed sync.
   */
  async markUnreachable(nodeId: string): Promise<void> {
    const sub = peerSubject(this.ns, nodeId);
    await this.client.createTriple({
      subject: sub,
      predicate: syncPredicate(this.ns, "status"),
      object: "unreachable",
    });
  }

  /**
   * Get a specific peer by nodeId.
   */
  async getPeer(nodeId: string): Promise<PeerInfo | null> {
    const sub = peerSubject(this.ns, nodeId);
    const result = await this.client.listTriples({ subject: sub, limit: 20 });
    if (result.triples.length === 0) return null;
    return triplesToPeer(this.ns, nodeId, result.triples);
  }

  /**
   * List all active peers.
   */
  async listPeers(opts?: { includeRemoved?: boolean }): Promise<PeerInfo[]> {
    const statusMatches = await this.client.patternQuery({
      predicate: syncPredicate(this.ns, "status"),
      limit: 100,
    });

    const peers: PeerInfo[] = [];
    const seen = new Set<string>();

    for (const match of statusMatches.matches) {
      if (!match.subject.includes(":sync:peer:")) continue;

      // Extract nodeId
      const parts = match.subject.split(":sync:peer:");
      if (parts.length < 2) continue;
      const nodeId = parts[1];

      if (seen.has(nodeId)) continue;
      seen.add(nodeId);

      // Skip removed unless requested
      const status = stringValue(match.object);
      if (status === "removed" && !opts?.includeRemoved) continue;

      const peer = await this.getPeer(nodeId);
      if (peer) {
        peers.push(peer);
      }
    }

    return peers;
  }

  /**
   * Convert a PeerInfo to a SyncPeer for the sync protocol.
   */
  toSyncPeer(peer: PeerInfo): SyncPeer {
    return {
      nodeId: peer.nodeId,
      endpoint: peer.endpoint,
      lastSyncAt: peer.lastSyncAt,
      namespaces: peer.namespaces,
    };
  }

  /**
   * Initialize peers from config (add missing, skip existing).
   */
  async initFromConfig(peers: SyncPeerConfig[]): Promise<number> {
    let added = 0;
    for (const peerConfig of peers) {
      if (!peerConfig.nodeId || !peerConfig.endpoint) continue;
      const existing = await this.getPeer(peerConfig.nodeId);
      if (!existing) {
        await this.addPeer(peerConfig);
        added++;
      }
    }
    return added;
  }

  /**
   * Get sync status summary.
   */
  async status(): Promise<{
    totalPeers: number;
    activePeers: number;
    unreachablePeers: number;
    totalSyncs: number;
    totalTriplesSynced: number;
  }> {
    const peers = await this.listPeers();
    return {
      totalPeers: peers.length,
      activePeers: peers.filter((p) => p.status === "active").length,
      unreachablePeers: peers.filter((p) => p.status === "unreachable").length,
      totalSyncs: peers.reduce((sum, p) => sum + p.totalSyncs, 0),
      totalTriplesSynced: peers.reduce((sum, p) => sum + p.totalTriplesSynced, 0),
    };
  }
}

// ============================================================================
// Triple parsing helpers
// ============================================================================

function triplesToPeer(ns: string, nodeId: string, triples: TripleDto[]): PeerInfo {
  let endpoint = "";
  let namespaces: string[] = [];
  let status: PeerStatus = "active";
  let lastSyncAt = "";
  let lastSyncResult: string | undefined;
  let addedAt = "";
  let totalSyncs = 0;
  let totalTriplesSynced = 0;

  for (const t of triples) {
    const pred = t.predicate;
    if (pred.endsWith(":endpoint")) endpoint = stringValue(t.object);
    else if (pred.endsWith(":namespaces"))
      namespaces = stringValue(t.object).split(",").filter(Boolean);
    else if (pred.endsWith(":status")) status = stringValue(t.object) as PeerStatus;
    else if (pred.endsWith(":lastSyncAt")) lastSyncAt = stringValue(t.object);
    else if (pred.endsWith(":lastSyncResult")) lastSyncResult = stringValue(t.object);
    else if (pred.endsWith(":addedAt")) addedAt = stringValue(t.object);
    else if (pred.endsWith(":totalSyncs")) totalSyncs = numberValue(t.object);
    else if (pred.endsWith(":totalTriplesSynced")) totalTriplesSynced = numberValue(t.object);
  }

  return {
    nodeId,
    endpoint,
    namespaces,
    status,
    lastSyncAt,
    lastSyncResult,
    addedAt,
    totalSyncs,
    totalTriplesSynced,
  };
}

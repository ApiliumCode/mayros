/**
 * Distributed Venture Manager
 *
 * Enables ventures to span multiple Mayros nodes via P2P triple
 * synchronization. Uses the existing DAG sync primitives to replicate
 * venture state across peers.
 *
 * Supports auto-discovery via Cortex P2P (mDNS or manual peers)
 * using the existing p2pListPeers() API.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type PeerVenture = {
  ventureId: string;
  peerNodeIds: string[];
  syncStrategy: "full" | "selective";
  lastSyncAt: string | null;
};

export type SyncResult = {
  ventureId: string;
  actionsSynced: number;
  triplesAdded: number;
  conflicts: number;
  syncedAt: string;
};

// ============================================================================
// Helpers
// ============================================================================

function peerSubject(ns: string, ventureId: string): string {
  return `${ns}:peers:${ventureId}`;
}

function peerPredicate(ns: string, field: string): string {
  return `${ns}:peers:${field}`;
}

// ============================================================================
// DistributedVentureManager
// ============================================================================

export class DistributedVentureManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Register a peer node for a venture. */
  async registerPeer(ventureId: string, peerNodeId: string): Promise<void> {
    if (!ventureId.trim()) throw new Error("Venture ID is required");
    if (!peerNodeId.trim()) throw new Error("Peer node ID is required");

    const subject = peerSubject(this.ns, ventureId);

    // Check if already registered
    const existing = await this.listPeers(ventureId);
    if (existing.includes(peerNodeId)) return;

    await this.client.createTriple({
      subject,
      predicate: peerPredicate(this.ns, "node"),
      object: peerNodeId,
    });
  }

  /** Remove a peer node from a venture. */
  async removePeer(ventureId: string, peerNodeId: string): Promise<void> {
    const subject = peerSubject(this.ns, ventureId);
    const result = await this.client.listTriples({
      subject,
      predicate: peerPredicate(this.ns, "node"),
      limit: 50,
    });

    for (const t of result.triples) {
      if (String(t.object) === peerNodeId && t.id) {
        await this.client.deleteTriple(t.id);
      }
    }
  }

  /** List all peer nodes for a venture. */
  async listPeers(ventureId: string): Promise<string[]> {
    const subject = peerSubject(this.ns, ventureId);
    const result = await this.client.listTriples({
      subject,
      predicate: peerPredicate(this.ns, "node"),
      limit: 50,
    });

    return result.triples.map((t) => String(t.object));
  }

  /**
   * Sync a venture's state with registered peers via DAG.
   * Uses Cortex's built-in DAG sync primitives.
   */
  async syncVenture(ventureId: string): Promise<SyncResult> {
    const peers = await this.listPeers(ventureId);
    const now = new Date().toISOString();

    if (peers.length === 0) {
      return { ventureId, actionsSynced: 0, triplesAdded: 0, conflicts: 0, syncedAt: now };
    }

    // Get local DAG state
    let localTips: string[];
    try {
      const tipsResult = await this.client.dagTips();
      localTips = tipsResult.tips ?? [];
    } catch {
      localTips = [];
    }

    let totalActionsSynced = 0;
    let totalTriplesAdded = 0;
    let totalConflicts = 0;

    // Sync with each peer
    for (const peer of peers) {
      try {
        // Push local state to peer
        const pushResult = await this.client.dagSync({
          target: peer,
          tips: localTips,
        });
        totalActionsSynced += pushResult.actions_sent ?? 0;

        // Pull remote state from peer
        const pullResult = await this.client.dagSyncPull({
          source: peer,
        });
        totalTriplesAdded += pullResult.triples_added ?? 0;
        totalConflicts += pullResult.conflicts ?? 0;
      } catch {
        // Peer unreachable — skip silently
      }
    }

    // Record last sync time
    const subject = peerSubject(this.ns, ventureId);
    const existing = await this.client.listTriples({
      subject,
      predicate: peerPredicate(this.ns, "lastSyncAt"),
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
    await this.client.createTriple({
      subject,
      predicate: peerPredicate(this.ns, "lastSyncAt"),
      object: now,
    });

    return {
      ventureId,
      actionsSynced: totalActionsSynced,
      triplesAdded: totalTriplesAdded,
      conflicts: totalConflicts,
      syncedAt: now,
    };
  }

  /** Get sync status for a venture. */
  async getSyncStatus(ventureId: string): Promise<PeerVenture> {
    const peers = await this.listPeers(ventureId);
    const subject = peerSubject(this.ns, ventureId);

    const syncTriples = await this.client.listTriples({
      subject,
      predicate: peerPredicate(this.ns, "lastSyncAt"),
      limit: 1,
    });

    const lastSyncAt = syncTriples.triples.length > 0
      ? String(syncTriples.triples[0].object)
      : null;

    return {
      ventureId,
      peerNodeIds: peers,
      syncStrategy: "full",
      lastSyncAt,
    };
  }

  /**
   * Auto-discover peers via Cortex P2P network (mDNS or gossip).
   * Registers all discovered peers for the given venture.
   *
   * Requires Cortex to be running with --p2p and optionally --p2p-mdns.
   * Returns the list of newly registered peer addresses.
   */
  async discoverPeers(ventureId: string): Promise<string[]> {
    let connectedPeers: Array<{ addr: string }>;
    try {
      // Use Cortex P2P API to list connected peers
      const status = await this.client.p2pStatus();
      connectedPeers = status?.connected_peers ?? [];
    } catch {
      // P2P not enabled or Cortex unreachable
      return [];
    }

    if (connectedPeers.length === 0) return [];

    const existing = await this.listPeers(ventureId);
    const existingSet = new Set(existing);
    const newPeers: string[] = [];

    for (const peer of connectedPeers) {
      if (!peer.addr || existingSet.has(peer.addr)) continue;
      await this.registerPeer(ventureId, peer.addr);
      newPeers.push(peer.addr);
    }

    return newPeers;
  }

  /**
   * Add a P2P peer to Cortex's connection pool, then register it for the venture.
   * Combines peer connection + venture registration in one call.
   */
  async addAndRegisterPeer(ventureId: string, peerAddr: string): Promise<void> {
    // Connect via Cortex P2P
    try {
      await this.client.p2pAddPeer(peerAddr);
    } catch {
      // Connection may fail but registration can still proceed
    }

    // Register for the venture
    await this.registerPeer(ventureId, peerAddr);
  }
}

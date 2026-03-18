/**
 * Knowledge Transfer Service
 *
 * When an agent completes a mission, transfers knowledge from the agent's
 * private namespace to a shared namespace (squad or venture-scoped).
 *
 * Uses KnowledgeFusion for the actual merge and records the transfer
 * as a triple for audit trail.
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import type { KnowledgeFusion } from "../agent-mesh/knowledge-fusion.js";
import type { NamespaceManager } from "../agent-mesh/namespace-manager.js";
import type { FusionReport, MergeStrategy } from "../agent-mesh/mesh-protocol.js";
import { stripBrackets } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type TransferResult = {
  id: string;
  sourceAgent: string;
  targetNamespace: string;
  missionId: string;
  triplesTransferred: number;
  strategy: string;
  timestamp: string;
};

export type TransferConfig = {
  autoTransfer: boolean;
  strategy: MergeStrategy;
  maxTriples: number;
};

const DEFAULT_CONFIG: TransferConfig = {
  autoTransfer: true,
  strategy: "additive",
  maxTriples: 100,
};

// ============================================================================
// Helpers
// ============================================================================

function transferSubject(ns: string, id: string): string {
  return `${ns}:transfer:${id}`;
}

function transferPredicate(ns: string, field: string): string {
  return `${ns}:transfer:${field}`;
}

// ============================================================================
// KnowledgeTransferService
// ============================================================================

export class KnowledgeTransferService {
  private readonly config: TransferConfig;

  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
    private readonly fusion: KnowledgeFusion,
    private readonly nsMgr: NamespaceManager,
    config?: Partial<TransferConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Transfer knowledge from an agent's namespace to a shared target
   * after mission completion.
   */
  async transferOnComplete(
    agentId: string,
    missionId: string,
    squadId?: string,
  ): Promise<TransferResult> {
    // Resolve namespaces
    const sourceNs = this.nsMgr.getPrivateNs(agentId);
    const targetNs = squadId
      ? this.nsMgr.getSharedNs(`team-${squadId}`)
      : `${this.ns}:shared:venture`;

    // Execute fusion with configured strategy
    let report: FusionReport;
    try {
      report = await this.fusion.merge(sourceNs, targetNs, this.config.strategy);
    } catch {
      // If fusion fails (e.g., empty namespace), return zero-transfer result
      return this.recordTransfer(agentId, targetNs, missionId, 0, this.config.strategy);
    }

    // Cap transferred triples
    const transferred = Math.min(report.added, this.config.maxTriples);

    return this.recordTransfer(agentId, targetNs, missionId, transferred, report.strategy);
  }

  /** Get transfer history for an agent. */
  async getTransferHistory(agentId: string, limit = 20): Promise<TransferResult[]> {
    const result = await this.client.patternQuery({
      predicate: transferPredicate(this.ns, "sourceAgent"),
      object: agentId,
      limit,
    });

    const transfers: TransferResult[] = [];
    const prefix = `${this.ns}:transfer:`;

    for (const match of result.matches) {
      const sub = stripBrackets(String(match.subject));
      if (!sub.startsWith(prefix)) continue;
      const id = sub.slice(prefix.length);
      const transfer = await this.getTransfer(id);
      if (transfer) transfers.push(transfer);
    }

    return transfers.sort((a, b) =>
      new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    );
  }

  /** Get a specific transfer record. */
  private async getTransfer(id: string): Promise<TransferResult | null> {
    const subject = transferSubject(this.ns, id);
    const result = await this.client.listTriples({ subject, limit: 20 });

    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const prefix = `${this.ns}:transfer:`;

    for (const t of result.triples) {
      const pred = stripBrackets(String(t.predicate));
      if (pred.startsWith(prefix)) {
        fields[pred.slice(prefix.length)] = String(t.object);
      }
    }

    return {
      id,
      sourceAgent: fields.sourceAgent ?? "",
      targetNamespace: fields.targetNamespace ?? "",
      missionId: fields.missionId ?? "",
      triplesTransferred: parseInt(fields.triplesTransferred ?? "0", 10),
      strategy: fields.strategy ?? "additive",
      timestamp: fields.timestamp ?? "",
    };
  }

  /** Record a transfer result as triples for audit. */
  private async recordTransfer(
    agentId: string,
    targetNs: string,
    missionId: string,
    transferred: number,
    strategy: string,
  ): Promise<TransferResult> {
    const id = randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    const subject = transferSubject(this.ns, id);

    const fields: Array<[string, string | number]> = [
      ["sourceAgent", agentId],
      ["targetNamespace", targetNs],
      ["missionId", missionId],
      ["triplesTransferred", transferred],
      ["strategy", strategy],
      ["timestamp", now],
    ];

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: transferPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id,
      sourceAgent: agentId,
      targetNamespace: targetNs,
      missionId,
      triplesTransferred: transferred,
      strategy,
      timestamp: now,
    };
  }
}

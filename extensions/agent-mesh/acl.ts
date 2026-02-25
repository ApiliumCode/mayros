/**
 * Namespace Access Control List (ACL)
 *
 * Stores and queries ACL grants as RDF triples via a Cortex HTTP client.
 * Triple pattern:
 *   {ns}:acl:{uuid}  {ns}:acl:agent      {ns}:agent:{targetId}
 *   {ns}:acl:{uuid}  {ns}:acl:namespace   {ns}:shared:{name}
 *   {ns}:acl:{uuid}  {ns}:acl:level       "write"
 *   {ns}:acl:{uuid}  {ns}:acl:grantedBy   {ns}:agent:{ownerId}
 *   {ns}:acl:{uuid}  {ns}:acl:grantedAt   <timestamp>
 */

import { randomUUID } from "node:crypto";
import type { CortexClientLike } from "../shared/cortex-client.js";
import type { AccessLevel, Grant } from "./mesh-protocol.js";
import { accessLevelSatisfies } from "./mesh-protocol.js";

export type { CortexClientLike } from "../shared/cortex-client.js";

// ============================================================================
// ACL Class
// ============================================================================

export class NamespaceACL {
  private readonly client: CortexClientLike;
  private readonly ns: string;

  constructor(client: CortexClientLike, ns: string) {
    this.client = client;
    this.ns = ns;
  }

  // ---------- Helpers ----------

  private aclSubject(uuid: string): string {
    return `${this.ns}:acl:${uuid}`;
  }

  private aclPredicate(field: string): string {
    return `${this.ns}:acl:${field}`;
  }

  private agentNode(agentId: string): string {
    return `${this.ns}:agent:${agentId}`;
  }

  private extractNodeId(obj: string | number | boolean | { node: string }): string | undefined {
    if (typeof obj === "object" && obj !== null && "node" in obj) {
      return obj.node;
    }
    return typeof obj === "string" ? obj : undefined;
  }

  private extractStringValue(
    obj: string | number | boolean | { node: string },
  ): string | undefined {
    if (typeof obj === "string") return obj;
    if (typeof obj === "object" && obj !== null && "node" in obj) return obj.node;
    return String(obj);
  }

  // ---------- Public API ----------

  /**
   * Check if an agent has at least the required access level on a namespace.
   */
  async checkAccess(agentId: string, namespace: string, required: AccessLevel): Promise<boolean> {
    // "none" is always satisfied
    if (required === "none") return true;

    const grants = await this.listGrants(namespace);
    const agentGrant = grants.find((g) => g.agent === agentId);

    if (!agentGrant) return false;
    return accessLevelSatisfies(agentGrant.level, required);
  }

  /**
   * Grant an agent access to a namespace. Only the owner (admin) can grant.
   * If the agent already has a grant on this namespace, the old grant is revoked first.
   */
  async grant(
    ownerId: string,
    targetAgentId: string,
    namespace: string,
    level: AccessLevel,
  ): Promise<void> {
    // Revoke existing grant if any (idempotent)
    await this.revoke(ownerId, targetAgentId, namespace);

    const uuid = randomUUID();
    const subj = this.aclSubject(uuid);
    const now = Date.now();

    await this.client.createTriple({
      subject: subj,
      predicate: this.aclPredicate("agent"),
      object: { node: this.agentNode(targetAgentId) },
    });

    await this.client.createTriple({
      subject: subj,
      predicate: this.aclPredicate("namespace"),
      object: namespace,
    });

    await this.client.createTriple({
      subject: subj,
      predicate: this.aclPredicate("level"),
      object: level,
    });

    await this.client.createTriple({
      subject: subj,
      predicate: this.aclPredicate("grantedBy"),
      object: { node: this.agentNode(ownerId) },
    });

    await this.client.createTriple({
      subject: subj,
      predicate: this.aclPredicate("grantedAt"),
      object: now,
    });
  }

  /**
   * Revoke an agent's access to a namespace.
   * Deletes all triples for the matching ACL entry.
   */
  async revoke(_ownerId: string, targetAgentId: string, namespace: string): Promise<void> {
    const grants = await this.listGrants(namespace);
    const targetGrant = grants.find((g) => g.agent === targetAgentId);

    if (!targetGrant) return;

    // Delete all triples for this ACL entry
    const tripleResult = await this.client.listTriples({
      subject: this.aclSubject(targetGrant.id),
      limit: 20,
    });

    for (const t of tripleResult.triples) {
      if (t.id) {
        await this.client.deleteTriple(t.id);
      }
    }
  }

  /**
   * List all grants for a given namespace.
   */
  async listGrants(namespace: string): Promise<Grant[]> {
    // Find all ACL entries that reference this namespace
    const result = await this.client.patternQuery({
      predicate: this.aclPredicate("namespace"),
      object: namespace,
      limit: 200,
    });

    const grants: Grant[] = [];

    for (const match of result.matches) {
      const aclSubject = match.subject;
      // Extract UUID from subject: {ns}:acl:{uuid}
      const prefix = `${this.ns}:acl:`;
      if (!aclSubject.startsWith(prefix)) continue;
      const uuid = aclSubject.slice(prefix.length);

      // Fetch all triples for this ACL subject
      const tripleResult = await this.client.listTriples({
        subject: aclSubject,
        limit: 10,
      });

      let agent = "";
      let level: AccessLevel = "none";
      let grantedBy = "";
      let grantedAt = 0;

      for (const t of tripleResult.triples) {
        if (t.predicate === this.aclPredicate("agent")) {
          const nodeId = this.extractNodeId(t.object);
          if (nodeId) {
            // Extract agent ID from node: {ns}:agent:{id}
            const agentPrefix = `${this.ns}:agent:`;
            agent = nodeId.startsWith(agentPrefix) ? nodeId.slice(agentPrefix.length) : nodeId;
          }
        } else if (t.predicate === this.aclPredicate("level")) {
          const val = this.extractStringValue(t.object);
          if (val && ["none", "read", "write", "admin"].includes(val)) {
            level = val as AccessLevel;
          }
        } else if (t.predicate === this.aclPredicate("grantedBy")) {
          const nodeId = this.extractNodeId(t.object);
          if (nodeId) {
            const agentPrefix = `${this.ns}:agent:`;
            grantedBy = nodeId.startsWith(agentPrefix) ? nodeId.slice(agentPrefix.length) : nodeId;
          }
        } else if (t.predicate === this.aclPredicate("grantedAt")) {
          const val = t.object;
          if (typeof val === "number") {
            grantedAt = val;
          } else if (typeof val === "string") {
            grantedAt = parseInt(val, 10) || 0;
          }
        }
      }

      if (agent) {
        grants.push({
          id: uuid,
          agent,
          namespace,
          level,
          grantedBy,
          grantedAt,
        });
      }
    }

    return grants;
  }
}

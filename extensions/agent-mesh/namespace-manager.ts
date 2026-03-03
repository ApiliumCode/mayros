/**
 * Namespace Manager
 *
 * Manages private and shared namespaces within the agent mesh.
 * Private namespaces: {ns}:agent:{agentId}
 * Shared namespaces: {ns}:shared:{workspaceId}
 *
 * Uses NamespaceACL internally for access control.
 */

import type { CortexClientLike } from "./acl.js";
import { NamespaceACL } from "./acl.js";
import type { AccessLevel, NamespaceInfo } from "./mesh-protocol.js";

export class NamespaceManager {
  private readonly ns: string;
  private readonly acl: NamespaceACL;
  private readonly client: CortexClientLike;
  private readonly maxSharedNamespaces: number;

  constructor(client: CortexClientLike, ns: string, maxSharedNamespaces: number) {
    this.client = client;
    this.ns = ns;
    this.acl = new NamespaceACL(client, ns);
    this.maxSharedNamespaces = maxSharedNamespaces;
  }

  // ---------- Namespace Addressing ----------

  /**
   * Get the private namespace for an agent.
   */
  getPrivateNs(agentId: string): string {
    return `${this.ns}:agent:${agentId}`;
  }

  /**
   * Get the shared namespace for a workspace.
   */
  getSharedNs(workspaceId: string): string {
    return `${this.ns}:shared:${workspaceId}`;
  }

  // ---------- Namespace Lifecycle ----------

  /**
   * Create a shared namespace and grant admin access to all specified owners.
   * Returns the fully-qualified shared namespace.
   */
  async createSharedNamespace(name: string, owners: string[]): Promise<string> {
    if (!name || !/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(name)) {
      throw new Error(
        "Shared namespace name must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    // Check the shared namespace limit
    const existing = await this.listSharedNamespaces();
    if (existing.length >= this.maxSharedNamespaces) {
      throw new Error(
        `Maximum shared namespaces reached (${this.maxSharedNamespaces}). Remove unused namespaces first.`,
      );
    }

    const sharedNs = this.getSharedNs(name);

    // Register the namespace as a triple: {ns}:shared:{name} {ns}:ns:type "shared"
    await this.client.createTriple({
      subject: sharedNs,
      predicate: `${this.ns}:ns:type`,
      object: "shared",
    });

    await this.client.createTriple({
      subject: sharedNs,
      predicate: `${this.ns}:ns:createdAt`,
      object: Date.now(),
    });

    // Grant admin access to all owners
    for (const owner of owners) {
      await this.acl.grant("system", owner, sharedNs, "admin");
    }

    return sharedNs;
  }

  // ---------- Access Management (delegated to ACL) ----------

  /**
   * Grant an agent access to a namespace.
   */
  async grantAccess(namespace: string, agentId: string, level: AccessLevel): Promise<void> {
    // The "owner" for grant purposes is the system namespace manager
    await this.acl.grant("system", agentId, namespace, level);
  }

  /**
   * Revoke an agent's access to a namespace.
   */
  async revokeAccess(namespace: string, agentId: string): Promise<void> {
    await this.acl.revoke("system", agentId, namespace);
  }

  // ---------- Queries ----------

  /**
   * List all namespaces accessible to a given agent.
   * This includes the agent's private namespace and any shared namespaces
   * where the agent has a grant.
   */
  async listAccessible(agentId: string): Promise<NamespaceInfo[]> {
    const results: NamespaceInfo[] = [];

    // Always include the agent's private namespace
    const privateNs = this.getPrivateNs(agentId);
    const privateTriples = await this.client.listTriples({
      subject: privateNs,
      limit: 1,
    });
    results.push({
      namespace: privateNs,
      owner: agentId,
      accessLevel: "admin",
      tripleCount: privateTriples.total,
    });

    // Find shared namespaces where the agent has grants
    const sharedNamespaces = await this.listSharedNamespaces();
    for (const sharedNs of sharedNamespaces) {
      const grants = await this.acl.listGrants(sharedNs);
      const agentGrant = grants.find((g) => g.agent === agentId);

      if (agentGrant) {
        const nsTriples = await this.client.listTriples({
          subject: sharedNs,
          limit: 1,
        });
        const owner = grants.find((g) => g.level === "admin");
        results.push({
          namespace: sharedNs,
          owner: owner?.agent ?? "unknown",
          accessLevel: agentGrant.level,
          tripleCount: nsTriples.total,
        });
      }
    }

    return results;
  }

  /**
   * List all registered shared namespaces.
   */
  async listSharedNamespaces(): Promise<string[]> {
    const result = await this.client.patternQuery({
      predicate: `${this.ns}:ns:type`,
      object: "shared",
      limit: this.maxSharedNamespaces + 10,
    });

    return result.matches.map((m) => m.subject);
  }

  /**
   * Check if an agent has at least the required access to a namespace.
   */
  async checkAccess(agentId: string, namespace: string, required: AccessLevel): Promise<boolean> {
    // Agents always have admin access to their own private namespace
    if (namespace === this.getPrivateNs(agentId)) return true;

    return this.acl.checkAccess(agentId, namespace, required);
  }

  /**
   * Get the underlying ACL instance for direct grant management.
   */
  getACL(): NamespaceACL {
    return this.acl;
  }
}

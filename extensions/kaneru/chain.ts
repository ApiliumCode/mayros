/**
 * Chain Manager
 *
 * Manages agent deployment to ventures and the chain of command
 * (escalation hierarchy). Detects cycles in the escalation graph.
 *
 * All relationships stored as Cortex RDF triples.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import { stripBrackets } from "../shared/rdf-utils.js";

// ============================================================================
// Types
// ============================================================================

export type ChainNode = {
  agentId: string;
  role: string;
  escalatesTo: string | null;
  children: ChainNode[];
};

export type DeployedAgent = {
  agentId: string;
  ventureId: string;
  role: string;
  escalatesTo: string | null;
};

// ============================================================================
// Helpers
// ============================================================================

function agentSubject(ns: string, agentId: string): string {
  return `${ns}:agent:${agentId}`;
}

function agentPredicate(ns: string, field: string): string {
  return `${ns}:agent:${field}`;
}

// ============================================================================
// ChainManager
// ============================================================================

export class ChainManager {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /** Deploy an agent to a venture with a specific role. */
  async deploy(agentId: string, ventureId: string, role: string): Promise<void> {
    if (!agentId.trim()) throw new Error("Agent ID is required");
    if (!ventureId.trim()) throw new Error("Venture ID is required");
    if (!role.trim()) throw new Error("Role is required");

    const subject = agentSubject(this.ns, agentId);

    // Check if already deployed to this venture
    const existing = await this.client.listTriples({
      subject,
      predicate: agentPredicate(this.ns, "deployedAt"),
      limit: 10,
    });

    const ventureNode = `${this.ns}:venture:${ventureId}`;
    const alreadyDeployed = existing.triples.some((t) => {
      const val =
        typeof t.object === "object" &&
        t.object !== null &&
        "node" in (t.object as Record<string, unknown>)
          ? stripBrackets(String((t.object as { node: string }).node))
          : String(t.object);
      return val === ventureNode;
    });

    if (alreadyDeployed) {
      throw new Error(`Agent "${agentId}" is already deployed to venture "${ventureId}"`);
    }

    await this.client.createTriple({
      subject,
      predicate: agentPredicate(this.ns, "deployedAt"),
      object: { node: ventureNode },
    });

    await this.client.createTriple({
      subject,
      predicate: agentPredicate(this.ns, "role"),
      object: role,
    });
  }

  /** Retire an agent from a venture. */
  async retire(agentId: string, ventureId: string): Promise<void> {
    const subject = agentSubject(this.ns, agentId);
    const ventureNode = `${this.ns}:venture:${ventureId}`;

    // Find and delete deployment triple
    const deployments = await this.client.listTriples({
      subject,
      predicate: agentPredicate(this.ns, "deployedAt"),
      limit: 10,
    });

    for (const t of deployments.triples) {
      const val =
        typeof t.object === "object" &&
        t.object !== null &&
        "node" in (t.object as Record<string, unknown>)
          ? stripBrackets(String((t.object as { node: string }).node))
          : String(t.object);
      if (val === ventureNode && t.id) {
        await this.client.deleteTriple(t.id);
      }
    }

    // Remove escalation edges and role for this agent.
    // Note: currently not scoped per-venture — if an agent is deployed to
    // multiple ventures, this removes edges globally. Acceptable for v0.3.0
    // single-venture agents; scope by venture predicate for multi-venture.
    const escalations = await this.client.listTriples({
      subject,
      predicate: agentPredicate(this.ns, "escalatesTo"),
      limit: 10,
    });
    for (const t of escalations.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    // Remove role
    const roles = await this.client.listTriples({
      subject,
      predicate: agentPredicate(this.ns, "role"),
      limit: 10,
    });
    for (const t of roles.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
  }

  /** Set escalation path: `from` escalates to `to`. */
  async setEscalation(from: string, to: string): Promise<void> {
    if (from === to) throw new Error("Agent cannot escalate to itself");

    const subject = agentSubject(this.ns, from);
    const targetNode = agentSubject(this.ns, to);

    // Delete existing escalation
    const existing = await this.client.listTriples({
      subject,
      predicate: agentPredicate(this.ns, "escalatesTo"),
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    // Create new escalation edge
    await this.client.createTriple({
      subject,
      predicate: agentPredicate(this.ns, "escalatesTo"),
      object: targetNode,
    });

    // Detect cycles after setting
    if (await this.detectCycle(from)) {
      // Rollback: remove the edge we just created
      const newEdge = await this.client.listTriples({
        subject,
        predicate: agentPredicate(this.ns, "escalatesTo"),
        limit: 1,
      });
      for (const t of newEdge.triples) {
        if (t.id) await this.client.deleteTriple(t.id);
      }
      throw new Error(`Setting escalation from "${from}" to "${to}" would create a cycle`);
    }
  }

  /** Detect cycles in the escalation chain starting from agentId. */
  async detectCycle(agentId: string): Promise<boolean> {
    const visited = new Set<string>();
    let current: string | null = agentId;

    while (current) {
      if (visited.has(current)) return true;
      visited.add(current);

      const subject = agentSubject(this.ns, current);
      const result = await this.client.listTriples({
        subject,
        predicate: agentPredicate(this.ns, "escalatesTo"),
        limit: 1,
      });

      if (result.triples.length === 0) break;

      const val = result.triples[0].object;
      const target =
        typeof val === "object" && val !== null && "node" in (val as Record<string, unknown>)
          ? stripBrackets(String((val as { node: string }).node))
          : String(val);

      // Extract agent ID from node reference
      const agentPrefix = `${this.ns}:agent:`;
      current = target.startsWith(agentPrefix) ? target.slice(agentPrefix.length) : null;
    }

    return false;
  }

  /** Get the full chain of command for a venture. */
  async getChain(ventureId: string): Promise<ChainNode[]> {
    const ventureNode = `${this.ns}:venture:${ventureId}`;

    // Find all agents deployed to this venture (try node ref first, fall back to string)
    let deployments = await this.client.patternQuery({
      predicate: agentPredicate(this.ns, "deployedAt"),
      object: { node: ventureNode },
      limit: 200,
    });
    // Fallback: legacy data stored as plain string
    if (deployments.matches.length === 0) {
      deployments = await this.client.patternQuery({
        predicate: agentPredicate(this.ns, "deployedAt"),
        object: ventureNode,
        limit: 200,
      });
    }

    const agentPrefix = `${this.ns}:agent:`;
    const agentIds: string[] = [];
    for (const m of deployments.matches) {
      const sub = stripBrackets(String(m.subject));
      if (sub.startsWith(agentPrefix)) {
        agentIds.push(sub.slice(agentPrefix.length));
      }
    }

    // Load roles and escalation for each agent
    const agents: DeployedAgent[] = [];
    for (const aid of agentIds) {
      const subject = agentSubject(this.ns, aid);

      const roleTriples = await this.client.listTriples({
        subject,
        predicate: agentPredicate(this.ns, "role"),
        limit: 1,
      });
      const role =
        roleTriples.triples.length > 0 ? String(roleTriples.triples[0].object) : "member";

      const escTriples = await this.client.listTriples({
        subject,
        predicate: agentPredicate(this.ns, "escalatesTo"),
        limit: 1,
      });

      let escalatesTo: string | null = null;
      if (escTriples.triples.length > 0) {
        const val = escTriples.triples[0].object;
        const target =
          typeof val === "object" && val !== null && "node" in (val as Record<string, unknown>)
            ? stripBrackets(String((val as { node: string }).node))
            : String(val);
        if (target.startsWith(agentPrefix)) {
          escalatesTo = target.slice(agentPrefix.length);
        }
      }

      agents.push({ agentId: aid, ventureId, role, escalatesTo });
    }

    // Build tree: agents with no children as leaves, parents above
    return this.buildTree(agents);
  }

  /** Build a tree from flat agent list. */
  private buildTree(agents: DeployedAgent[]): ChainNode[] {
    const nodeMap = new Map<string, ChainNode>();

    for (const a of agents) {
      nodeMap.set(a.agentId, {
        agentId: a.agentId,
        role: a.role,
        escalatesTo: a.escalatesTo,
        children: [],
      });
    }

    // Link children: if A escalatesTo B, then A is a child of B
    const roots: ChainNode[] = [];
    for (const node of nodeMap.values()) {
      if (node.escalatesTo && nodeMap.has(node.escalatesTo)) {
        nodeMap.get(node.escalatesTo)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    return roots;
  }
}

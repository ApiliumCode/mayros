/**
 * DecisionGraph — reconstructs agent decision trees from trace events.
 *
 * Queries Cortex for event triples and assembles them into tree structures
 * for visualization and causal analysis.
 */

import type { CortexClient } from "../shared/cortex-client.js";
import type { TraceEvent, TraceEventType } from "./trace-emitter.js";

// ============================================================================
// Types
// ============================================================================

export type TraceEventNode = {
  id: string;
  type: string;
  agentId: string;
  timestamp: string;
  children: TraceEventNode[];
  fields: Record<string, string>;
};

export type DecisionTree = {
  rootEventId: string;
  events: TraceEventNode[];
  depth: number;
};

export type CausalChainLink = {
  eventId: string;
  type: string;
  agentId: string;
  timestamp: string;
  summary: string;
};

export type CausalChain = {
  chain: CausalChainLink[];
};

// ============================================================================
// DecisionGraph
// ============================================================================

export class DecisionGraph {
  constructor(
    private client: CortexClient,
    private ns: string,
  ) {}

  // ---------- Public API ----------

  /**
   * Build a decision tree from all events in a session.
   */
  async buildFromSession(sessionKey: string): Promise<DecisionTree> {
    const events = await this.fetchSessionEvents(sessionKey);

    if (events.length === 0) {
      return { rootEventId: "", events: [], depth: 0 };
    }

    // Sort by timestamp ascending
    events.sort((a, b) => a.timestamp.localeCompare(b.timestamp));

    // Build node map
    const nodeMap = new Map<string, TraceEventNode>();
    for (const evt of events) {
      nodeMap.set(evt.id, {
        id: evt.id,
        type: evt.type,
        agentId: evt.agentId,
        timestamp: evt.timestamp,
        children: [],
        fields: evt.fields,
      });
    }

    // Link parent-child relationships
    const roots: TraceEventNode[] = [];
    for (const evt of events) {
      const node = nodeMap.get(evt.id)!;
      if (evt.parentEvent && nodeMap.has(evt.parentEvent)) {
        nodeMap.get(evt.parentEvent)!.children.push(node);
      } else {
        roots.push(node);
      }
    }

    // Calculate max depth
    const depth = this.calculateDepth(roots);

    return {
      rootEventId: roots.length > 0 ? roots[0].id : "",
      events: roots,
      depth,
    };
  }

  /**
   * Find all events for an agent in a time range, optionally filtered by type.
   */
  async queryEvents(
    agentId: string,
    from?: Date,
    to?: Date,
    types?: string[],
  ): Promise<TraceEvent[]> {
    const params: Record<string, string | undefined> = {
      agentId,
    };
    if (from) {
      params.from = from.toISOString();
    }
    if (to) {
      params.to = to.toISOString();
    }
    if (types && types.length > 0) {
      params.types = types.join(",");
    }

    const result = await this.client.getEvents(params);
    return (result.events ?? []) as TraceEvent[];
  }

  /**
   * Get the causal chain leading to a specific event.
   * Walks up the parentEvent chain to reconstruct "why did this happen?"
   */
  async explainAction(eventId: string): Promise<CausalChain> {
    const chain: CausalChainLink[] = [];
    let currentId: string | undefined = eventId;
    const visited = new Set<string>();

    while (currentId && !visited.has(currentId)) {
      visited.add(currentId);

      try {
        const evt = await this.client.getEvent(currentId);
        chain.unshift({
          eventId: evt.id,
          type: evt.type,
          agentId: evt.agentId,
          timestamp: evt.timestamp,
          summary: this.summarizeEvent(evt as unknown as TraceEvent),
        });

        currentId = evt.parentEvent;
      } catch {
        break;
      }
    }

    return { chain };
  }

  // ---------- Private helpers ----------

  private async fetchSessionEvents(sessionKey: string): Promise<TraceEvent[]> {
    const result = await this.client.getEvents({ session: sessionKey });
    return (result.events ?? []) as TraceEvent[];
  }

  private calculateDepth(nodes: TraceEventNode[]): number {
    if (nodes.length === 0) return 0;
    let maxChildDepth = 0;
    for (const node of nodes) {
      const childDepth = this.calculateDepth(node.children);
      if (childDepth > maxChildDepth) {
        maxChildDepth = childDepth;
      }
    }
    return 1 + maxChildDepth;
  }

  private summarizeEvent(evt: TraceEvent): string {
    switch (evt.type) {
      case "tool_call":
        return `Tool call: ${evt.fields.toolName ?? "unknown"} (${evt.durationMs ?? 0}ms)`;
      case "llm_call":
        return `LLM call: ${evt.fields.model ?? "unknown"} (${evt.fields.totalTokens ?? "?"} tokens, ${evt.durationMs ?? 0}ms)`;
      case "decision":
        return `Decision: ${evt.fields.description ?? "unknown"} -> ${evt.fields.chosen ?? "?"}`;
      case "delegation":
        return `Delegation: ${evt.fields.parentId ?? "?"} -> ${evt.fields.childId ?? "?"} (${evt.fields.task ?? "?"})`;
      case "error":
        return `Error: ${evt.fields.error ?? "unknown"}`;
      default:
        return `Event: ${evt.type}`;
    }
  }
}

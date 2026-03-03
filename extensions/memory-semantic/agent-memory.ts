/**
 * Agent Persistent Memory — Cortex-backed per-agent memory.
 *
 * Replaces flat-file `~/.claude/agent-memory/MEMORY.md` with RDF triples
 * that are queryable by topic/type/project, confidence-based, usage-tracked,
 * and scoped per agent.
 *
 * Triple namespace:
 *   Subject: {ns}:agent:{name}:memory:{id}
 *   Predicates:
 *     {ns}:agent:memory:content     → memory text
 *     {ns}:agent:memory:type        → pattern|convention|insight|decision
 *     {ns}:agent:memory:project     → project name or "global"
 *     {ns}:agent:memory:confidence  → 0.0-1.0
 *     {ns}:agent:memory:createdAt   → ISO timestamp
 *     {ns}:agent:memory:lastUsedAt  → ISO timestamp
 *     {ns}:agent:memory:usageCount  → number
 */

import { randomUUID } from "node:crypto";
import type {
  CortexClientLike,
  CreateTripleRequest,
  TripleDto,
  ValueDto,
} from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type AgentMemoryType = "pattern" | "convention" | "insight" | "decision";

export type AgentMemoryEntry = {
  id: string;
  agentName: string;
  content: string;
  type: AgentMemoryType;
  project: string;
  confidence: number;
  createdAt: string;
  lastUsedAt: string;
  usageCount: number;
};

// ============================================================================
// Namespace helpers
// ============================================================================

function agentMemorySubject(ns: string, agentName: string, id: string): string {
  return `${ns}:agent:${agentName}:memory:${id}`;
}

function agentMemoryPredicate(ns: string, field: string): string {
  return `${ns}:agent:memory:${field}`;
}

// ============================================================================
// Triple parsing helpers
// ============================================================================

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

function triplesToAgentMemory(agentName: string, triples: TripleDto[]): AgentMemoryEntry | null {
  if (triples.length === 0) return null;

  const subj = triples[0].subject;
  // Extract id from subject: {ns}:agent:{name}:memory:{id}
  const parts = subj.split(":");
  const id = parts.length >= 5 ? parts.slice(4).join(":") : subj;

  let content = "";
  let type: AgentMemoryType = "insight";
  let project = "global";
  let confidence = 0.7;
  let createdAt = "";
  let lastUsedAt = "";
  let usageCount = 0;

  for (const t of triples) {
    const pred = t.predicate;
    if (pred.endsWith(":content")) content = stringValue(t.object);
    else if (pred.endsWith(":type")) type = stringValue(t.object) as AgentMemoryType;
    else if (pred.endsWith(":project")) project = stringValue(t.object);
    else if (pred.endsWith(":confidence")) confidence = numberValue(t.object);
    else if (pred.endsWith(":createdAt")) createdAt = stringValue(t.object);
    else if (pred.endsWith(":lastUsedAt")) lastUsedAt = stringValue(t.object);
    else if (pred.endsWith(":usageCount")) usageCount = numberValue(t.object);
  }

  if (!content) return null;

  return {
    id,
    agentName,
    content,
    type,
    project,
    confidence,
    createdAt,
    lastUsedAt,
    usageCount,
  };
}

// ============================================================================
// AgentMemory class
// ============================================================================

export class AgentMemory {
  constructor(
    private readonly client: CortexClientLike,
    private readonly ns: string,
  ) {}

  async store(
    agentName: string,
    entry: {
      content: string;
      type?: AgentMemoryType;
      project?: string;
      confidence?: number;
    },
  ): Promise<string> {
    const id = randomUUID();
    const sub = agentMemorySubject(this.ns, agentName, id);
    const now = new Date().toISOString();

    const triples: CreateTripleRequest[] = [
      {
        subject: sub,
        predicate: agentMemoryPredicate(this.ns, "content"),
        object: entry.content,
      },
      {
        subject: sub,
        predicate: agentMemoryPredicate(this.ns, "type"),
        object: entry.type ?? "insight",
      },
      {
        subject: sub,
        predicate: agentMemoryPredicate(this.ns, "project"),
        object: entry.project ?? "global",
      },
      {
        subject: sub,
        predicate: agentMemoryPredicate(this.ns, "confidence"),
        object: entry.confidence ?? 0.7,
      },
      {
        subject: sub,
        predicate: agentMemoryPredicate(this.ns, "createdAt"),
        object: now,
      },
      {
        subject: sub,
        predicate: agentMemoryPredicate(this.ns, "lastUsedAt"),
        object: now,
      },
      {
        subject: sub,
        predicate: agentMemoryPredicate(this.ns, "usageCount"),
        object: 0,
      },
    ];

    for (const t of triples) {
      await this.client.createTriple(t);
    }

    return id;
  }

  async recall(
    agentName: string,
    opts?: {
      type?: AgentMemoryType;
      project?: string;
      query?: string;
      limit?: number;
    },
  ): Promise<AgentMemoryEntry[]> {
    const limit = opts?.limit ?? 10;

    // Query all memories for this agent via content predicate
    const contentMatches = await this.client.patternQuery({
      predicate: agentMemoryPredicate(this.ns, "content"),
      limit: limit * 10,
    });

    const agentPrefix = `${this.ns}:agent:${agentName}:memory:`;
    const memories: AgentMemoryEntry[] = [];

    for (const match of contentMatches.matches) {
      if (!match.subject.startsWith(agentPrefix)) continue;

      const tripleResult = await this.client.listTriples({
        subject: match.subject,
        limit: 20,
      });
      const entry = triplesToAgentMemory(agentName, tripleResult.triples);
      if (!entry) continue;

      // Apply filters
      if (opts?.type && entry.type !== opts.type) continue;
      if (opts?.project && entry.project !== opts.project) continue;
      if (opts?.query) {
        const lower = opts.query.toLowerCase();
        if (!entry.content.toLowerCase().includes(lower)) continue;
      }

      memories.push(entry);
      if (memories.length >= limit * 2) break;
    }

    // Sort by usageCount desc
    memories.sort((a, b) => b.usageCount - a.usageCount);

    return memories.slice(0, limit);
  }

  async touch(agentName: string, memoryId: string): Promise<void> {
    const sub = agentMemorySubject(this.ns, agentName, memoryId);
    const now = new Date().toISOString();

    // Update lastUsedAt
    const lastUsedMatches = await this.client.patternQuery({
      subject: sub,
      predicate: agentMemoryPredicate(this.ns, "lastUsedAt"),
      limit: 1,
    });
    for (const t of lastUsedMatches.matches) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
    await this.client.createTriple({
      subject: sub,
      predicate: agentMemoryPredicate(this.ns, "lastUsedAt"),
      object: now,
    });

    // Increment usageCount
    const countMatches = await this.client.patternQuery({
      subject: sub,
      predicate: agentMemoryPredicate(this.ns, "usageCount"),
      limit: 1,
    });
    let currentCount = 0;
    for (const t of countMatches.matches) {
      currentCount = numberValue(t.object);
      if (t.id) await this.client.deleteTriple(t.id);
    }
    await this.client.createTriple({
      subject: sub,
      predicate: agentMemoryPredicate(this.ns, "usageCount"),
      object: currentCount + 1,
    });
  }

  async forget(agentName: string, memoryId: string): Promise<void> {
    const sub = agentMemorySubject(this.ns, agentName, memoryId);
    const result = await this.client.listTriples({ subject: sub, limit: 20 });
    for (const t of result.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }
  }

  async listByAgent(agentName: string, opts?: { limit?: number }): Promise<AgentMemoryEntry[]> {
    return this.recall(agentName, { limit: opts?.limit ?? 50 });
  }

  async stats(agentName: string): Promise<Record<AgentMemoryType, number>> {
    const all = await this.recall(agentName, { limit: 1000 });
    const counts: Record<AgentMemoryType, number> = {
      pattern: 0,
      convention: 0,
      insight: 0,
      decision: 0,
    };

    for (const entry of all) {
      counts[entry.type]++;
    }

    return counts;
  }

  async prune(
    agentName: string,
    opts?: { minConfidence?: number; maxAge?: number },
  ): Promise<number> {
    const all = await this.recall(agentName, { limit: 1000 });
    const minConfidence = opts?.minConfidence ?? 0.3;
    const now = Date.now();
    const maxAge = opts?.maxAge ?? Infinity;
    let pruned = 0;

    for (const entry of all) {
      const age = now - new Date(entry.createdAt).getTime();
      if (entry.confidence < minConfidence || age > maxAge) {
        await this.forget(agentName, entry.id);
        pruned++;
      }
    }

    return pruned;
  }

  formatForPrompt(memories: AgentMemoryEntry[]): string {
    if (memories.length === 0) return "";

    const lines = memories.map((m) => `- [${m.type}] ${m.content}`);

    return `<agent-memory>\n${lines.join("\n")}\n</agent-memory>`;
  }
}

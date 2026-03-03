import { describe, expect, it } from "vitest";
import type { CortexClientLike, TripleDto, ValueDto } from "../shared/cortex-client.js";
import { AgentMemory, type AgentMemoryEntry, type AgentMemoryType } from "./agent-memory.js";

// ============================================================================
// Mock CortexClient
// ============================================================================

function createMockCortex(): CortexClientLike & { triples: TripleDto[] } {
  let nextId = 1;
  const triples: TripleDto[] = [];

  return {
    triples,

    async createTriple(req: { subject: string; predicate: string; object: ValueDto }) {
      const id = String(nextId++);
      const triple: TripleDto = {
        id,
        subject: req.subject,
        predicate: req.predicate,
        object: req.object,
        created_at: new Date().toISOString(),
      };
      triples.push(triple);
      return triple;
    },

    async listTriples(query: { subject?: string; predicate?: string; limit?: number }) {
      const limit = query.limit ?? 100;
      const matching = triples.filter((t) => {
        if (query.subject && t.subject !== query.subject) return false;
        if (query.predicate && t.predicate !== query.predicate) return false;
        return true;
      });
      return { triples: matching.slice(0, limit), total: matching.length };
    },

    async patternQuery(req: {
      subject?: string;
      predicate?: string;
      object?: ValueDto;
      limit?: number;
    }) {
      const limit = req.limit ?? 100;
      const matching = triples.filter((t) => {
        if (req.subject && t.subject !== req.subject) return false;
        if (req.predicate && t.predicate !== req.predicate) return false;
        if (req.object !== undefined) {
          if (typeof req.object === "object" && req.object !== null && "node" in req.object) {
            if (typeof t.object !== "object" || !("node" in t.object)) return false;
            if (t.object.node !== req.object.node) return false;
          } else if (t.object !== req.object) {
            return false;
          }
        }
        return true;
      });
      return { matches: matching.slice(0, limit), total: matching.length };
    },

    async deleteTriple(id: string) {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
    },
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("AgentMemory", () => {
  describe("store", () => {
    it("creates correct triples", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      const id = await mem.store("reviewer", {
        content: "Always check for null pointers",
        type: "pattern",
        project: "mayros",
      });

      expect(id).toBeTruthy();
      expect(cortex.triples.length).toBe(7);

      // Check subject format
      const subjects = new Set(cortex.triples.map((t) => t.subject));
      expect(subjects.size).toBe(1);
      const subject = [...subjects][0];
      expect(subject).toMatch(/^test:agent:reviewer:memory:/);

      // Check predicates
      const predicates = cortex.triples.map((t) => t.predicate);
      expect(predicates).toContain("test:agent:memory:content");
      expect(predicates).toContain("test:agent:memory:type");
      expect(predicates).toContain("test:agent:memory:project");
      expect(predicates).toContain("test:agent:memory:confidence");
      expect(predicates).toContain("test:agent:memory:createdAt");
      expect(predicates).toContain("test:agent:memory:lastUsedAt");
      expect(predicates).toContain("test:agent:memory:usageCount");
    });

    it("uses defaults for optional fields", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("coder", { content: "Use vitest" });

      const typeTriple = cortex.triples.find((t) => t.predicate === "test:agent:memory:type");
      expect(typeTriple?.object).toBe("insight");

      const projectTriple = cortex.triples.find((t) => t.predicate === "test:agent:memory:project");
      expect(projectTriple?.object).toBe("global");

      const confTriple = cortex.triples.find((t) => t.predicate === "test:agent:memory:confidence");
      expect(confTriple?.object).toBe(0.7);
    });
  });

  describe("recall", () => {
    it("filters by type", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("agent1", { content: "Pattern A", type: "pattern" });
      await mem.store("agent1", { content: "Decision B", type: "decision" });

      const patterns = await mem.recall("agent1", { type: "pattern" });
      expect(patterns.length).toBe(1);
      expect(patterns[0].content).toBe("Pattern A");
    });

    it("filters by project", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("agent1", { content: "Proj memory", project: "mayros" });
      await mem.store("agent1", { content: "Global memory", project: "global" });

      const projectMems = await mem.recall("agent1", { project: "mayros" });
      expect(projectMems.length).toBe(1);
      expect(projectMems[0].content).toBe("Proj memory");
    });

    it("filters by query text match", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("agent1", { content: "TypeScript strict mode" });
      await mem.store("agent1", { content: "Use pnpm" });

      const results = await mem.recall("agent1", { query: "typescript" });
      expect(results.length).toBe(1);
      expect(results[0].content).toBe("TypeScript strict mode");
    });

    it("sorts by usageCount desc", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      const id1 = await mem.store("agent1", { content: "Low use" });
      const id2 = await mem.store("agent1", { content: "High use" });

      // Touch id2 multiple times
      await mem.touch("agent1", id2);
      await mem.touch("agent1", id2);

      const results = await mem.recall("agent1");
      expect(results[0].content).toBe("High use");
      expect(results[0].usageCount).toBe(2);
    });

    it("scopes to specific agent", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("agent1", { content: "Agent 1 memory" });
      await mem.store("agent2", { content: "Agent 2 memory" });

      const agent1Mems = await mem.recall("agent1");
      expect(agent1Mems.length).toBe(1);
      expect(agent1Mems[0].content).toBe("Agent 1 memory");
    });
  });

  describe("touch", () => {
    it("updates lastUsedAt and increments usageCount", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      const id = await mem.store("agent1", { content: "Memory" });
      const before = await mem.recall("agent1");
      expect(before[0].usageCount).toBe(0);

      await mem.touch("agent1", id);

      const after = await mem.recall("agent1");
      expect(after[0].usageCount).toBe(1);
    });
  });

  describe("forget", () => {
    it("deletes all triples for memory", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      const id = await mem.store("agent1", { content: "Forget me" });
      expect(cortex.triples.length).toBe(7);

      await mem.forget("agent1", id);

      const results = await mem.recall("agent1");
      expect(results.length).toBe(0);
    });
  });

  describe("listByAgent", () => {
    it("returns all memories for specific agent", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("agent1", { content: "Mem 1" });
      await mem.store("agent1", { content: "Mem 2" });
      await mem.store("agent2", { content: "Mem 3" });

      const list = await mem.listByAgent("agent1");
      expect(list.length).toBe(2);
    });
  });

  describe("stats", () => {
    it("returns count by type", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("agent1", { content: "P1", type: "pattern" });
      await mem.store("agent1", { content: "P2", type: "pattern" });
      await mem.store("agent1", { content: "C1", type: "convention" });
      await mem.store("agent1", { content: "I1", type: "insight" });

      const s = await mem.stats("agent1");
      expect(s.pattern).toBe(2);
      expect(s.convention).toBe(1);
      expect(s.insight).toBe(1);
      expect(s.decision).toBe(0);
    });
  });

  describe("prune", () => {
    it("removes entries below minConfidence", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      await mem.store("agent1", { content: "High conf", confidence: 0.9 });
      await mem.store("agent1", { content: "Low conf", confidence: 0.1 });

      const pruned = await mem.prune("agent1", { minConfidence: 0.5 });
      expect(pruned).toBe(1);

      const remaining = await mem.recall("agent1");
      expect(remaining.length).toBe(1);
      expect(remaining[0].content).toBe("High conf");
    });
  });

  describe("formatForPrompt", () => {
    it("returns correct XML block", () => {
      const mem = new AgentMemory(createMockCortex(), "test");

      const memories: AgentMemoryEntry[] = [
        {
          id: "1",
          agentName: "reviewer",
          content: "Check null pointers",
          type: "pattern",
          project: "mayros",
          confidence: 0.8,
          createdAt: "2024-01-01T00:00:00Z",
          lastUsedAt: "2024-01-02T00:00:00Z",
          usageCount: 5,
        },
      ];

      const result = mem.formatForPrompt(memories);
      expect(result).toContain("<agent-memory>");
      expect(result).toContain("</agent-memory>");
      expect(result).toContain("[pattern] Check null pointers");
    });

    it("returns empty string for empty memories", () => {
      const mem = new AgentMemory(createMockCortex(), "test");
      expect(mem.formatForPrompt([])).toBe("");
    });
  });

  describe("without Cortex data", () => {
    it("returns empty for all queries", async () => {
      const cortex = createMockCortex();
      const mem = new AgentMemory(cortex, "test");

      expect(await mem.recall("agent1")).toEqual([]);
      expect(await mem.listByAgent("agent1")).toEqual([]);
      const s = await mem.stats("agent1");
      expect(s.pattern + s.convention + s.insight + s.decision).toBe(0);
    });
  });
});

import { describe, expect, it } from "vitest";
import type {
  CortexClient,
  CortexClientLike,
  TripleDto,
  ValueDto,
} from "../shared/cortex-client.js";
import { RulesEngine } from "./rules-engine.js";
import { ProjectMemory } from "./project-memory.js";
import { AgentMemory } from "./agent-memory.js";
import { ContextualAwareness, type Notification } from "./contextual-awareness.js";

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

function createAwareness(cortex: CortexClientLike) {
  const ns = "test";
  const rulesEngine = new RulesEngine(cortex, ns);
  // ProjectMemory expects CortexClient but our mock satisfies the interface
  const projectMemory = new ProjectMemory(cortex as unknown as CortexClient, ns);
  const agentMemory = new AgentMemory(cortex, ns);
  const awareness = new ContextualAwareness(cortex, ns, rulesEngine, projectMemory, agentMemory);
  return { awareness, rulesEngine, projectMemory, agentMemory };
}

// ============================================================================
// Tests
// ============================================================================

describe("ContextualAwareness", () => {
  describe("gatherNotifications", () => {
    it("returns pending rule proposals", async () => {
      const cortex = createMockCortex();
      const { awareness, rulesEngine } = createAwareness(cortex);

      await rulesEngine.proposeRule("Use strict mode", "global");

      const notifications = await awareness.gatherNotifications("agent1");
      const ruleNotifs = notifications.filter((n) => n.type === "rule_proposal");
      expect(ruleNotifs.length).toBe(1);
      expect(ruleNotifs[0].message).toContain("1 rule proposal");
      expect(ruleNotifs[0].priority).toBe("medium");
      expect(ruleNotifs[0].actionable).toBe(true);
    });

    it("returns unresolved findings", async () => {
      const cortex = createMockCortex();
      const { awareness, projectMemory } = createAwareness(cortex);

      await projectMemory.storeSessionFinding({
        id: "f1",
        type: "finding",
        text: "Null pointer in auth module",
        createdAt: new Date().toISOString(),
      });

      const notifications = await awareness.gatherNotifications("agent1");
      const findingNotifs = notifications.filter((n) => n.type === "unresolved_finding");
      expect(findingNotifs.length).toBe(1);
      expect(findingNotifs[0].message).toContain("Null pointer in auth module");
    });

    it("returns agent reminders", async () => {
      const cortex = createMockCortex();
      const { awareness, agentMemory } = createAwareness(cortex);

      await agentMemory.store("agent1", {
        content: "TODO: fix the failing test in auth module",
        type: "insight",
      });

      const notifications = await awareness.gatherNotifications("agent1");
      const reminderNotifs = notifications.filter((n) => n.type === "agent_reminder");
      expect(reminderNotifs.length).toBe(1);
      expect(reminderNotifs[0].message).toContain("TODO");
    });

    it("returns project stats", async () => {
      const cortex = createMockCortex();
      const { awareness, projectMemory } = createAwareness(cortex);

      await projectMemory.storeConvention({
        text: "Use TypeScript",
        category: "style",
        source: "user",
      });
      await projectMemory.storeDecision({
        text: "Use pnpm",
        category: "tooling",
        source: "user",
      });

      const notifications = await awareness.gatherNotifications("agent1");
      const statsNotifs = notifications.filter((n) => n.type === "project_stats");
      expect(statsNotifs.length).toBe(1);
      expect(statsNotifs[0].message).toContain("conventions");
      expect(statsNotifs[0].priority).toBe("low");
    });

    it("returns empty when Cortex empty", async () => {
      const cortex = createMockCortex();
      const { awareness } = createAwareness(cortex);

      const notifications = await awareness.gatherNotifications("agent1");
      expect(notifications.length).toBe(0);
    });

    it("sorts by priority (high first)", async () => {
      const cortex = createMockCortex();
      const { awareness, projectMemory, rulesEngine } = createAwareness(cortex);

      // Create a low-priority stat
      await projectMemory.storeConvention({
        text: "Style convention",
        category: "style",
        source: "user",
      });

      // Create a medium-priority rule proposal
      await rulesEngine.proposeRule("A rule", "global");

      // Create a high-priority error finding
      await projectMemory.storeSessionFinding({
        id: "e1",
        type: "error",
        text: "Critical error in production",
        createdAt: new Date().toISOString(),
      });

      const notifications = await awareness.gatherNotifications("agent1");
      expect(notifications.length).toBeGreaterThanOrEqual(2);

      // High-priority should be first
      const highIdx = notifications.findIndex((n) => n.priority === "high");
      const lowIdx = notifications.findIndex((n) => n.priority === "low");
      if (highIdx >= 0 && lowIdx >= 0) {
        expect(highIdx).toBeLessThan(lowIdx);
      }
    });

    it("handles Cortex errors gracefully", async () => {
      const cortex = createMockCortex();
      // Override patternQuery to throw
      const originalPatternQuery = cortex.patternQuery.bind(cortex);
      let callCount = 0;
      cortex.patternQuery = async (req) => {
        callCount++;
        if (callCount <= 2) throw new Error("Cortex error");
        return originalPatternQuery(req);
      };

      const { awareness } = createAwareness(cortex);

      // Should not throw, just return what it can
      const notifications = await awareness.gatherNotifications("agent1");
      expect(Array.isArray(notifications)).toBe(true);
    });
  });

  describe("formatNotifications", () => {
    it("renders correct XML", () => {
      const cortex = createMockCortex();
      const { awareness } = createAwareness(cortex);

      const notifications: Notification[] = [
        {
          type: "rule_proposal",
          message: "2 rule proposals pending",
          priority: "high",
          source: "rules-engine",
          actionable: true,
        },
        {
          type: "project_stats",
          message: "5 conventions, 3 decisions",
          priority: "low",
          source: "project-memory",
          actionable: false,
        },
      ];

      const result = awareness.formatNotifications(notifications);
      expect(result).toContain("<session-notifications>");
      expect(result).toContain("</session-notifications>");
      expect(result).toContain("[!] 2 rule proposals pending");
      expect(result).toContain("[-] 5 conventions, 3 decisions");
    });

    it("returns empty string for empty notifications", () => {
      const cortex = createMockCortex();
      const { awareness } = createAwareness(cortex);
      expect(awareness.formatNotifications([])).toBe("");
    });
  });
});

import { describe, expect, it } from "vitest";
import type { CortexClientLike, TripleDto, ValueDto } from "../shared/cortex-client.js";
import { RulesEngine, type Rule, type RuleScope } from "./rules-engine.js";

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

describe("RulesEngine", () => {
  describe("addRule", () => {
    it("creates correct triples with subject format and predicates", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.addRule({
        content: "Always use TypeScript strict mode",
        scope: "project",
        scopeTarget: "mayros",
        priority: 10,
      });

      expect(id).toBeTruthy();
      expect(cortex.triples.length).toBe(8);

      // Check subject format
      const subjects = new Set(cortex.triples.map((t) => t.subject));
      expect(subjects.size).toBe(1);
      const subject = [...subjects][0];
      expect(subject).toMatch(/^test:rule:project:/);

      // Check predicates
      const predicates = cortex.triples.map((t) => t.predicate);
      expect(predicates).toContain("test:rule:content");
      expect(predicates).toContain("test:rule:scope");
      expect(predicates).toContain("test:rule:scopeTarget");
      expect(predicates).toContain("test:rule:priority");
      expect(predicates).toContain("test:rule:source");
      expect(predicates).toContain("test:rule:confidence");
      expect(predicates).toContain("test:rule:enabled");
      expect(predicates).toContain("test:rule:createdAt");
    });

    it("uses defaults for optional fields", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({ content: "Use pnpm", scope: "global" });

      const sourceTriple = cortex.triples.find((t) => t.predicate === "test:rule:source");
      expect(sourceTriple?.object).toBe("manual");

      const confidenceTriple = cortex.triples.find((t) => t.predicate === "test:rule:confidence");
      expect(confidenceTriple?.object).toBe(0.8);

      const enabledTriple = cortex.triples.find((t) => t.predicate === "test:rule:enabled");
      expect(enabledTriple?.object).toBe(true);
    });
  });

  describe("removeRule", () => {
    it("deletes all triples for rule subject", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.addRule({ content: "No any", scope: "global" });
      expect(cortex.triples.length).toBe(8);

      await engine.removeRule(id);
      expect(cortex.triples.length).toBe(0);
    });

    it("does nothing for non-existent rule", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.removeRule("non-existent-id");
      expect(cortex.triples.length).toBe(0);
    });
  });

  describe("updateRule", () => {
    it("upserts only changed fields", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.addRule({ content: "Old content", scope: "global" });
      await engine.updateRule(id, { content: "New content" });

      const rule = await engine.getRule(id);
      expect(rule?.content).toBe("New content");
      expect(rule?.scope).toBe("global");
    });

    it("updates multiple fields at once", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.addRule({ content: "Test", scope: "global" });
      await engine.updateRule(id, { priority: 100, confidence: 0.9 });

      const rule = await engine.getRule(id);
      expect(rule?.priority).toBe(100);
      expect(rule?.confidence).toBe(0.9);
    });
  });

  describe("getRule", () => {
    it("reconstructs Rule from triples", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.addRule({
        content: "Always use vitest",
        scope: "project",
        scopeTarget: "mayros",
        priority: 15,
        source: "manual",
        confidence: 0.9,
      });

      const rule = await engine.getRule(id);
      expect(rule).toBeTruthy();
      expect(rule!.content).toBe("Always use vitest");
      expect(rule!.scope).toBe("project");
      expect(rule!.scopeTarget).toBe("mayros");
      expect(rule!.priority).toBe(15);
      expect(rule!.source).toBe("manual");
      expect(rule!.confidence).toBe(0.9);
      expect(rule!.enabled).toBe(true);
      expect(rule!.createdAt).toBeTruthy();
    });

    it("returns null for non-existent rule", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const rule = await engine.getRule("non-existent");
      expect(rule).toBeNull();
    });
  });

  describe("listRules", () => {
    it("filters by scope", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({ content: "Global rule", scope: "global" });
      await engine.addRule({ content: "Project rule", scope: "project" });
      await engine.addRule({ content: "Agent rule", scope: "agent" });

      const projectRules = await engine.listRules({ scope: "project" });
      expect(projectRules.length).toBe(1);
      expect(projectRules[0].content).toBe("Project rule");
    });

    it("filters by enabled status", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({ content: "Enabled", scope: "global", enabled: true });
      await engine.addRule({ content: "Disabled", scope: "global", enabled: false });

      const enabled = await engine.listRules({ enabled: true });
      expect(enabled.length).toBe(1);
      expect(enabled[0].content).toBe("Enabled");

      const disabled = await engine.listRules({ enabled: false });
      expect(disabled.length).toBe(1);
      expect(disabled[0].content).toBe("Disabled");
    });

    it("respects limit", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({ content: "Rule 1", scope: "global" });
      await engine.addRule({ content: "Rule 2", scope: "global" });
      await engine.addRule({ content: "Rule 3", scope: "global" });

      const rules = await engine.listRules({ limit: 2 });
      expect(rules.length).toBe(2);
    });
  });

  describe("resolveRules", () => {
    it("returns hierarchical resolution (global + project + specific scope)", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({ content: "Global rule", scope: "global", priority: 0 });
      await engine.addRule({ content: "Project rule", scope: "project", priority: 10 });
      await engine.addRule({ content: "Agent rule", scope: "agent", priority: 20 });

      const resolved = await engine.resolveRules({ scope: "agent" });
      expect(resolved.length).toBe(3);
    });

    it("sorts by priority (most specific wins)", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({ content: "Low prio", scope: "global", priority: 0 });
      await engine.addRule({ content: "High prio", scope: "agent", priority: 50 });
      await engine.addRule({ content: "Mid prio", scope: "project", priority: 10 });

      const resolved = await engine.resolveRules({ scope: "agent" });
      expect(resolved[0].content).toBe("High prio");
      expect(resolved[1].content).toBe("Mid prio");
      expect(resolved[2].content).toBe("Low prio");
    });

    it("excludes disabled rules", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({ content: "Active", scope: "global", enabled: true });
      await engine.addRule({ content: "Inactive", scope: "global", enabled: false });

      const resolved = await engine.resolveRules({ scope: "global" });
      expect(resolved.length).toBe(1);
      expect(resolved[0].content).toBe("Active");
    });

    it("filters by scope target", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      await engine.addRule({
        content: "Agent-specific rule",
        scope: "agent",
        scopeTarget: "reviewer",
      });
      await engine.addRule({
        content: "Other agent rule",
        scope: "agent",
        scopeTarget: "coder",
      });

      const resolved = await engine.resolveRules({ scope: "agent", target: "reviewer" });
      const agentRules = resolved.filter((r) => r.scope === "agent");
      expect(agentRules.length).toBe(1);
      expect(agentRules[0].content).toBe("Agent-specific rule");
    });
  });

  describe("proposeRule", () => {
    it("creates with confidence=0.5 and enabled=false", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.proposeRule("Proposed rule", "project", "mayros", "session-123");

      const rule = await engine.getRule(id);
      expect(rule).toBeTruthy();
      expect(rule!.confidence).toBe(0.5);
      expect(rule!.enabled).toBe(false);
      expect(rule!.source).toBe("learned");

      // Check learnedFrom was stored
      const learnedTriple = cortex.triples.find((t) => t.predicate === "test:rule:learnedFrom");
      expect(learnedTriple?.object).toBe("session-123");
    });
  });

  describe("confirmRule", () => {
    it("sets enabled=true and confidence=0.8", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.proposeRule("Learned rule", "global");
      const before = await engine.getRule(id);
      expect(before!.enabled).toBe(false);
      expect(before!.confidence).toBe(0.5);

      await engine.confirmRule(id);

      const after = await engine.getRule(id);
      expect(after!.enabled).toBe(true);
      expect(after!.confidence).toBe(0.8);
    });
  });

  describe("rejectRule", () => {
    it("deletes the rule", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      const id = await engine.proposeRule("Bad rule", "global");
      expect(await engine.getRule(id)).toBeTruthy();

      await engine.rejectRule(id);
      expect(await engine.getRule(id)).toBeNull();
    });
  });

  describe("formatRulesForPrompt", () => {
    it("returns correct XML block", () => {
      const engine = new RulesEngine(createMockCortex(), "test");

      const rules: Rule[] = [
        {
          id: "1",
          content: "Use TypeScript strict mode",
          scope: "project",
          scopeTarget: "mayros",
          priority: 10,
          source: "manual",
          confidence: 0.8,
          enabled: true,
          createdAt: "2024-01-01T00:00:00Z",
        },
        {
          id: "2",
          content: "No any types",
          scope: "global",
          priority: 0,
          source: "manual",
          confidence: 0.8,
          enabled: true,
          createdAt: "2024-01-01T00:00:00Z",
        },
      ];

      const result = engine.formatRulesForPrompt(rules);
      expect(result).toContain("<rules>");
      expect(result).toContain("</rules>");
      expect(result).toContain("[project:mayros] Use TypeScript strict mode");
      expect(result).toContain("[global] No any types");
    });

    it("returns empty string for empty rules", () => {
      const engine = new RulesEngine(createMockCortex(), "test");
      expect(engine.formatRulesForPrompt([])).toBe("");
    });
  });

  describe("without Cortex data", () => {
    it("returns empty arrays for all queries", async () => {
      const cortex = createMockCortex();
      const engine = new RulesEngine(cortex, "test");

      expect(await engine.listRules()).toEqual([]);
      expect(await engine.resolveRules({ scope: "global" })).toEqual([]);
      expect(await engine.getRule("non-existent")).toBeNull();
    });
  });
});

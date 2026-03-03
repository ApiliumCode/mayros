/**
 * Rules Engine — Cortex-backed hierarchical scoping.
 *
 * Replaces flat-file `.claude/rules/*.md` with RDF triples that are
 * queryable, learnable, hierarchically scoped, and don't require
 * manual file management.
 *
 * Triple namespace:
 *   Subject: {ns}:rule:{scope}:{id}
 *   Predicates:
 *     {ns}:rule:content      → rule text
 *     {ns}:rule:scope        → global|project|agent|skill|file
 *     {ns}:rule:scopeTarget  → target name/pattern (empty for global)
 *     {ns}:rule:priority     → numeric
 *     {ns}:rule:source       → learned|manual|imported
 *     {ns}:rule:confidence   → 0.0-1.0
 *     {ns}:rule:createdAt    → ISO timestamp
 *     {ns}:rule:learnedFrom  → session key
 *     {ns}:rule:enabled      → true|false
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

export type RuleScope = "global" | "project" | "agent" | "skill" | "file";

export type RuleSource = "learned" | "manual" | "imported";

export type Rule = {
  id: string;
  content: string;
  scope: RuleScope;
  scopeTarget?: string;
  priority: number;
  source: RuleSource;
  confidence: number;
  enabled: boolean;
  createdAt: string;
  learnedFrom?: string;
};

// ============================================================================
// Namespace helpers
// ============================================================================

function ruleSubject(ns: string, scope: RuleScope, id: string): string {
  return `${ns}:rule:${scope}:${id}`;
}

function rulePredicate(ns: string, field: string): string {
  return `${ns}:rule:${field}`;
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

function booleanValue(v: ValueDto): boolean {
  if (typeof v === "boolean") return v;
  const s = stringValue(v).toLowerCase();
  return s === "true" || s === "1";
}

function triplesToRule(triples: TripleDto[]): Rule | null {
  if (triples.length === 0) return null;

  const subj = triples[0].subject;
  // Extract id from subject: {ns}:rule:{scope}:{id}
  const parts = subj.split(":");
  const id = parts.length >= 4 ? parts.slice(3).join(":") : subj;

  let content = "";
  let scope: RuleScope = "global";
  let scopeTarget: string | undefined;
  let priority = 0;
  let source: RuleSource = "manual";
  let confidence = 0.8;
  let enabled = true;
  let createdAt = "";
  let learnedFrom: string | undefined;

  for (const t of triples) {
    const pred = t.predicate;
    if (pred.endsWith(":content")) content = stringValue(t.object);
    else if (pred.endsWith(":scope") && !pred.endsWith(":scopeTarget"))
      scope = stringValue(t.object) as RuleScope;
    else if (pred.endsWith(":scopeTarget")) {
      const val = stringValue(t.object);
      scopeTarget = val || undefined;
    } else if (pred.endsWith(":priority")) priority = numberValue(t.object);
    else if (pred.endsWith(":source")) source = stringValue(t.object) as RuleSource;
    else if (pred.endsWith(":confidence")) confidence = numberValue(t.object);
    else if (pred.endsWith(":enabled")) enabled = booleanValue(t.object);
    else if (pred.endsWith(":createdAt")) createdAt = stringValue(t.object);
    else if (pred.endsWith(":learnedFrom")) {
      const val = stringValue(t.object);
      learnedFrom = val || undefined;
    }
  }

  if (!content) return null;

  return {
    id,
    content,
    scope,
    scopeTarget,
    priority,
    source,
    confidence,
    enabled,
    createdAt,
    learnedFrom,
  };
}

// ============================================================================
// Scope priority map
// ============================================================================

const SCOPE_PRIORITY: Record<RuleScope, number> = {
  global: 0,
  project: 10,
  agent: 20,
  skill: 30,
  file: 40,
};

// ============================================================================
// RulesEngine class
// ============================================================================

export class RulesEngine {
  constructor(
    private readonly client: CortexClientLike,
    private readonly ns: string,
  ) {}

  async addRule(entry: {
    content: string;
    scope: RuleScope;
    scopeTarget?: string;
    priority?: number;
    source?: RuleSource;
    confidence?: number;
    enabled?: boolean;
  }): Promise<string> {
    const id = randomUUID();
    const sub = ruleSubject(this.ns, entry.scope, id);
    const now = new Date().toISOString();

    const triples: CreateTripleRequest[] = [
      { subject: sub, predicate: rulePredicate(this.ns, "content"), object: entry.content },
      { subject: sub, predicate: rulePredicate(this.ns, "scope"), object: entry.scope },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "scopeTarget"),
        object: entry.scopeTarget ?? "",
      },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "priority"),
        object: entry.priority ?? SCOPE_PRIORITY[entry.scope],
      },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "source"),
        object: entry.source ?? "manual",
      },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "confidence"),
        object: entry.confidence ?? 0.8,
      },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "enabled"),
        object: entry.enabled !== false,
      },
      { subject: sub, predicate: rulePredicate(this.ns, "createdAt"), object: now },
    ];

    for (const t of triples) {
      await this.client.createTriple(t);
    }

    return id;
  }

  async removeRule(id: string): Promise<void> {
    // Find the rule subject by querying all scopes
    for (const scope of ["global", "project", "agent", "skill", "file"] as RuleScope[]) {
      const sub = ruleSubject(this.ns, scope, id);
      const result = await this.client.listTriples({ subject: sub, limit: 20 });
      if (result.triples.length > 0) {
        for (const t of result.triples) {
          if (t.id) await this.client.deleteTriple(t.id);
        }
        return;
      }
    }
  }

  async updateRule(
    id: string,
    patch: Partial<Pick<Rule, "content" | "priority" | "confidence" | "enabled">>,
  ): Promise<void> {
    // Find the rule
    const rule = await this.getRule(id);
    if (!rule) return;

    const sub = ruleSubject(this.ns, rule.scope, id);

    // Upsert changed fields: query → delete → create
    for (const [field, value] of Object.entries(patch)) {
      if (value === undefined) continue;
      const pred = rulePredicate(this.ns, field);

      // Delete existing triple for this predicate
      const existing = await this.client.patternQuery({
        subject: sub,
        predicate: pred,
        limit: 1,
      });
      for (const t of existing.matches) {
        if (t.id) await this.client.deleteTriple(t.id);
      }

      // Create new triple
      await this.client.createTriple({ subject: sub, predicate: pred, object: value as ValueDto });
    }
  }

  async getRule(id: string): Promise<Rule | null> {
    for (const scope of ["global", "project", "agent", "skill", "file"] as RuleScope[]) {
      const sub = ruleSubject(this.ns, scope, id);
      const result = await this.client.listTriples({ subject: sub, limit: 20 });
      if (result.triples.length > 0) {
        return triplesToRule(result.triples);
      }
    }
    return null;
  }

  async listRules(opts?: {
    scope?: RuleScope;
    enabled?: boolean;
    limit?: number;
  }): Promise<Rule[]> {
    const limit = opts?.limit ?? 50;

    // Query by scope or all content predicates
    let matches: TripleDto[];
    if (opts?.scope) {
      const scopeMatches = await this.client.patternQuery({
        predicate: rulePredicate(this.ns, "scope"),
        object: opts.scope,
        limit: limit * 5,
      });
      matches = scopeMatches.matches;
    } else {
      const allMatches = await this.client.patternQuery({
        predicate: rulePredicate(this.ns, "content"),
        limit: limit * 5,
      });
      matches = allMatches.matches;
    }

    const rules: Rule[] = [];
    const seen = new Set<string>();

    for (const match of matches) {
      if (seen.has(match.subject)) continue;
      seen.add(match.subject);

      const tripleResult = await this.client.listTriples({ subject: match.subject, limit: 20 });
      const rule = triplesToRule(tripleResult.triples);
      if (!rule) continue;

      if (opts?.enabled !== undefined && rule.enabled !== opts.enabled) continue;

      rules.push(rule);
      if (rules.length >= limit) break;
    }

    rules.sort((a, b) => b.priority - a.priority);
    return rules;
  }

  async resolveRules(context: { scope: RuleScope; target?: string }): Promise<Rule[]> {
    // Hierarchical resolution: gather all matching rules from global → specific scope
    const scopeChain: RuleScope[] = ["global"];
    if (context.scope !== "global") {
      scopeChain.push("project");
      if (context.scope !== "project") {
        scopeChain.push(context.scope);
      }
    }

    const allRules: Rule[] = [];

    for (const scope of scopeChain) {
      const rules = await this.listRules({ scope, enabled: true });
      for (const rule of rules) {
        // For scoped rules, check target match
        if (rule.scopeTarget && context.target && rule.scopeTarget !== context.target) {
          continue;
        }
        allRules.push(rule);
      }
    }

    // Sort by priority (most specific wins) then by createdAt
    allRules.sort((a, b) => {
      const pd = b.priority - a.priority;
      if (pd !== 0) return pd;
      return b.createdAt.localeCompare(a.createdAt);
    });

    return allRules;
  }

  async proposeRule(
    content: string,
    scope: RuleScope,
    scopeTarget?: string,
    learnedFrom?: string,
  ): Promise<string> {
    const id = randomUUID();
    const sub = ruleSubject(this.ns, scope, id);
    const now = new Date().toISOString();

    const triples: CreateTripleRequest[] = [
      { subject: sub, predicate: rulePredicate(this.ns, "content"), object: content },
      { subject: sub, predicate: rulePredicate(this.ns, "scope"), object: scope },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "scopeTarget"),
        object: scopeTarget ?? "",
      },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "priority"),
        object: SCOPE_PRIORITY[scope],
      },
      {
        subject: sub,
        predicate: rulePredicate(this.ns, "source"),
        object: "learned" as RuleSource,
      },
      { subject: sub, predicate: rulePredicate(this.ns, "confidence"), object: 0.5 },
      { subject: sub, predicate: rulePredicate(this.ns, "enabled"), object: false },
      { subject: sub, predicate: rulePredicate(this.ns, "createdAt"), object: now },
    ];

    if (learnedFrom) {
      triples.push({
        subject: sub,
        predicate: rulePredicate(this.ns, "learnedFrom"),
        object: learnedFrom,
      });
    }

    for (const t of triples) {
      await this.client.createTriple(t);
    }

    return id;
  }

  async confirmRule(id: string): Promise<void> {
    await this.updateRule(id, { enabled: true, confidence: 0.8 });
  }

  async rejectRule(id: string): Promise<void> {
    await this.removeRule(id);
  }

  formatRulesForPrompt(rules: Rule[]): string {
    if (rules.length === 0) return "";

    const lines = rules.map(
      (r) => `- [${r.scope}${r.scopeTarget ? `:${r.scopeTarget}` : ""}] ${r.content}`,
    );

    return `<rules>\n${lines.join("\n")}\n</rules>`;
  }
}

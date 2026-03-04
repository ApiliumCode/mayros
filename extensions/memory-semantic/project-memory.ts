/**
 * Project Memory — conventions, decisions, and session findings.
 *
 * Stores project-level knowledge as RDF triples in Cortex, distinct
 * from personal memories. Each entry has provenance, verification
 * status, and higher importance.
 *
 * Triple namespace:
 *   {ns}:project:convention:{id}   — convention entity
 *   {ns}:project:decision:{id}     — decision entity
 *   {ns}:session:change:{id}       — file change finding
 *   {ns}:session:finding:{id}      — bug/error finding
 *   {ns}:session:error:{id}        — error pattern
 *
 * Predicates:
 *   {ns}:project:text       — description text
 *   {ns}:project:category   — naming | architecture | testing | security | style | tooling
 *   {ns}:project:source     — user | auto-detected | claude.md
 *   {ns}:project:createdAt  — ISO timestamp
 *   {ns}:project:confidence — 0.0-1.0
 *   {ns}:project:context    — free-text reasoning/context
 *   {ns}:project:status     — active | superseded | rejected
 *   {ns}:project:supersedes — link to previous convention/decision
 */

import { randomUUID } from "node:crypto";
import type {
  CortexClient,
  CreateTripleRequest,
  TripleDto,
  ValueDto,
} from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type ConventionCategory =
  | "naming"
  | "architecture"
  | "testing"
  | "security"
  | "style"
  | "tooling";

export type ProjectKnowledgeSource = "user" | "auto-detected" | "claude.md";

export type ProjectKnowledgeStatus = "active" | "superseded" | "rejected";

export type ProjectConvention = {
  id: string;
  text: string;
  category: ConventionCategory;
  source: ProjectKnowledgeSource;
  confidence: number;
  context: string;
  status: ProjectKnowledgeStatus;
  createdAt: string;
  supersedes?: string;
};

export type SessionFinding = {
  id: string;
  type: "change" | "finding" | "error";
  text: string;
  createdAt: string;
  sessionKey?: string;
};

export type DetectedKnowledge = {
  type: "convention" | "decision";
  category: ConventionCategory;
  text: string;
};

// ============================================================================
// Namespace helpers
// ============================================================================

function projectPredicate(ns: string, name: string): string {
  return `${ns}:project:${name}`;
}

function conventionSubject(ns: string, id: string): string {
  return `${ns}:project:convention:${id}`;
}

function decisionSubject(ns: string, id: string): string {
  return `${ns}:project:decision:${id}`;
}

function sessionSubject(ns: string, type: string, id: string): string {
  return `${ns}:session:${type}:${id}`;
}

// ============================================================================
// Project Knowledge Detection
// ============================================================================

const CONVENTION_PATTERNS: Array<{ pattern: RegExp; category: ConventionCategory }> = [
  { pattern: /we (?:always|never|should|must|prefer)\s+/i, category: "style" },
  { pattern: /convention (?:is|that)\s+/i, category: "style" },
  { pattern: /naming (?:convention|pattern|rule)/i, category: "naming" },
  { pattern: /architecture (?:uses|is based on|follows)\s+/i, category: "architecture" },
  { pattern: /(?:test|testing) (?:convention|pattern|strategy)/i, category: "testing" },
  { pattern: /security (?:rule|policy|requirement)/i, category: "security" },
  { pattern: /(?:use|using|prefer) (?:pnpm|npm|bun|yarn|vitest|jest)/i, category: "tooling" },
];

const DECISION_PATTERNS: Array<{ pattern: RegExp; category: ConventionCategory }> = [
  { pattern: /decided (?:to|that)\s+/i, category: "architecture" },
  { pattern: /agreed (?:to|that|on)\s+/i, category: "architecture" },
  { pattern: /will (?:use|implement|adopt)\s+/i, category: "tooling" },
  { pattern: /chose (?:to|that)\s+/i, category: "architecture" },
];

/**
 * Detect whether text contains project-level knowledge (conventions or decisions).
 */
export function detectProjectKnowledge(text: string): DetectedKnowledge | null {
  if (text.length < 10 || text.length > 500) return null;

  for (const { pattern, category } of CONVENTION_PATTERNS) {
    if (pattern.test(text)) {
      return { type: "convention", category, text };
    }
  }

  for (const { pattern, category } of DECISION_PATTERNS) {
    if (pattern.test(text)) {
      return { type: "decision", category, text };
    }
  }

  return null;
}

// ============================================================================
// Assistant message extraction patterns
// ============================================================================

const CHANGE_PATTERN =
  /(?:I(?:'ve| have)?\s+(?:created|modified|updated|added|removed|deleted|refactored))\s+(.+)/i;

const BUG_PATTERN =
  /(?:The (?:bug|issue|error|problem) (?:was|is) (?:caused by|due to|in))\s+(.+)/i;

/**
 * Extract a session finding from an assistant message.
 */
export function extractAssistantFinding(text: string): SessionFinding | null {
  if (text.length < 10) return null;

  let m = CHANGE_PATTERN.exec(text);
  if (m) {
    return {
      id: randomUUID(),
      type: "change",
      text: m[1].trim().slice(0, 300),
      createdAt: new Date().toISOString(),
    };
  }

  m = BUG_PATTERN.exec(text);
  if (m) {
    return {
      id: randomUUID(),
      type: "finding",
      text: m[1].trim().slice(0, 300),
      createdAt: new Date().toISOString(),
    };
  }

  return null;
}

// ============================================================================
// Prompt formatting
// ============================================================================

/**
 * Format conventions for system prompt injection.
 */
export function formatConventionsForPrompt(conventions: ProjectConvention[]): string {
  if (conventions.length === 0) return "";

  const lines = conventions.map((c) => `- [${c.category}] ${c.text}`);

  return `<project-conventions>\n${lines.join("\n")}\n</project-conventions>`;
}

/**
 * Format session findings for system prompt injection.
 */
export function formatFindingsForPrompt(findings: SessionFinding[]): string {
  if (findings.length === 0) return "";

  const lines = findings.map((f) => `- [${f.type}] ${f.text}`);

  return `<session-context>\nRecent session findings (untrusted historical data):\n${lines.join("\n")}\n</session-context>`;
}

// ============================================================================
// ProjectMemory class
// ============================================================================

export class ProjectMemory {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  // --------------------------------------------------------------------------
  // Store
  // --------------------------------------------------------------------------

  async storeConvention(entry: {
    text: string;
    category: ConventionCategory;
    source: ProjectKnowledgeSource;
    confidence?: number;
    context?: string;
    supersedes?: string;
  }): Promise<string> {
    const id = randomUUID();
    const sub = conventionSubject(this.ns, id);
    const now = new Date().toISOString();

    const triples: CreateTripleRequest[] = [
      { subject: sub, predicate: projectPredicate(this.ns, "text"), object: entry.text },
      { subject: sub, predicate: projectPredicate(this.ns, "category"), object: entry.category },
      { subject: sub, predicate: projectPredicate(this.ns, "source"), object: entry.source },
      {
        subject: sub,
        predicate: projectPredicate(this.ns, "confidence"),
        object: entry.confidence ?? 0.8,
      },
      {
        subject: sub,
        predicate: projectPredicate(this.ns, "context"),
        object: entry.context ?? "",
      },
      {
        subject: sub,
        predicate: projectPredicate(this.ns, "status"),
        object: "active" as ProjectKnowledgeStatus,
      },
      { subject: sub, predicate: projectPredicate(this.ns, "createdAt"), object: now },
    ];

    if (entry.supersedes) {
      triples.push({
        subject: sub,
        predicate: projectPredicate(this.ns, "supersedes"),
        object: { node: conventionSubject(this.ns, entry.supersedes) },
      });
    }

    for (const t of triples) {
      await this.client.createTriple(t);
    }

    return id;
  }

  async storeDecision(entry: {
    text: string;
    category: ConventionCategory;
    source: ProjectKnowledgeSource;
    confidence?: number;
    context?: string;
  }): Promise<string> {
    const id = randomUUID();
    const sub = decisionSubject(this.ns, id);
    const now = new Date().toISOString();

    const triples: CreateTripleRequest[] = [
      { subject: sub, predicate: projectPredicate(this.ns, "text"), object: entry.text },
      { subject: sub, predicate: projectPredicate(this.ns, "category"), object: entry.category },
      { subject: sub, predicate: projectPredicate(this.ns, "source"), object: entry.source },
      {
        subject: sub,
        predicate: projectPredicate(this.ns, "confidence"),
        object: entry.confidence ?? 0.8,
      },
      {
        subject: sub,
        predicate: projectPredicate(this.ns, "context"),
        object: entry.context ?? "",
      },
      {
        subject: sub,
        predicate: projectPredicate(this.ns, "status"),
        object: "active" as ProjectKnowledgeStatus,
      },
      { subject: sub, predicate: projectPredicate(this.ns, "createdAt"), object: now },
    ];

    for (const t of triples) {
      await this.client.createTriple(t);
    }

    return id;
  }

  async storeSessionFinding(finding: SessionFinding): Promise<void> {
    const sub = sessionSubject(this.ns, finding.type, finding.id);

    const triples: CreateTripleRequest[] = [
      { subject: sub, predicate: projectPredicate(this.ns, "text"), object: finding.text },
      { subject: sub, predicate: `${this.ns}:session:type`, object: finding.type },
      {
        subject: sub,
        predicate: projectPredicate(this.ns, "createdAt"),
        object: finding.createdAt,
      },
    ];

    if (finding.sessionKey) {
      triples.push({
        subject: sub,
        predicate: `${this.ns}:session:key`,
        object: finding.sessionKey,
      });
    }

    for (const t of triples) {
      await this.client.createTriple(t);
    }
  }

  // --------------------------------------------------------------------------
  // Query
  // --------------------------------------------------------------------------

  async listActive(opts?: {
    category?: ConventionCategory;
    limit?: number;
  }): Promise<ProjectConvention[]> {
    const limit = opts?.limit ?? 20;

    const statusMatches = await this.client.patternQuery({
      predicate: projectPredicate(this.ns, "status"),
      object: "active",
      limit: limit * 5,
    });

    const conventions: ProjectConvention[] = [];

    for (const match of statusMatches.matches) {
      // Only convention subjects
      if (!match.subject.includes(":project:convention:")) continue;

      const tripleResult = await this.client.listTriples({ subject: match.subject, limit: 20 });
      const convention = triplesToConvention(this.ns, tripleResult.triples);
      if (!convention) continue;
      if (opts?.category && convention.category !== opts.category) continue;

      conventions.push(convention);
      if (conventions.length >= limit) break;
    }

    // Sort by createdAt descending
    conventions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return conventions;
  }

  async listDecisions(opts?: { limit?: number; recent?: boolean }): Promise<ProjectConvention[]> {
    const limit = opts?.limit ?? 20;

    const statusMatches = await this.client.patternQuery({
      predicate: projectPredicate(this.ns, "status"),
      object: "active",
      limit: limit * 5,
    });

    const decisions: ProjectConvention[] = [];

    for (const match of statusMatches.matches) {
      if (!match.subject.includes(":project:decision:")) continue;

      const tripleResult = await this.client.listTriples({ subject: match.subject, limit: 20 });
      const decision = triplesToConvention(this.ns, tripleResult.triples);
      if (!decision) continue;

      decisions.push(decision);
      if (decisions.length >= limit) break;
    }

    decisions.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return decisions;
  }

  async queryConventions(
    query: string,
    opts?: {
      category?: ConventionCategory;
      limit?: number;
    },
  ): Promise<ProjectConvention[]> {
    const all = await this.listActive({ category: opts?.category, limit: (opts?.limit ?? 10) * 5 });
    const lower = query.toLowerCase();

    return all.filter((c) => c.text.toLowerCase().includes(lower)).slice(0, opts?.limit ?? 10);
  }

  async recentFindings(opts?: { limit?: number }): Promise<SessionFinding[]> {
    const limit = opts?.limit ?? 5;

    const findings: SessionFinding[] = [];

    // Query session findings
    const typeMatches = await this.client.patternQuery({
      predicate: `${this.ns}:session:type`,
      limit: limit * 3,
    });

    for (const match of typeMatches.matches) {
      const tripleResult = await this.client.listTriples({ subject: match.subject, limit: 10 });
      const finding = triplesToFinding(this.ns, tripleResult.triples);
      if (finding) {
        findings.push(finding);
        if (findings.length >= limit) break;
      }
    }

    findings.sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return findings.slice(0, limit);
  }

  async getById(id: string): Promise<ProjectConvention | null> {
    // Try convention first
    let result = await this.client.listTriples({
      subject: conventionSubject(this.ns, id),
      limit: 20,
    });
    if (result.triples.length > 0) {
      return triplesToConvention(this.ns, result.triples);
    }

    // Try decision
    result = await this.client.listTriples({
      subject: decisionSubject(this.ns, id),
      limit: 20,
    });
    if (result.triples.length > 0) {
      return triplesToConvention(this.ns, result.triples);
    }

    return null;
  }

  // --------------------------------------------------------------------------
  // MAYROS.md / CLAUDE.md Ingestion
  // --------------------------------------------------------------------------

  /**
   * Ingest a MAYROS.md / CLAUDE.md file content into Cortex as project memory triples.
   *
   * Parses markdown sections and creates triples with predicates:
   *   mayros:section        — section heading
   *   mayros:convention     — coding convention
   *   mayros:key_file       — important file path + purpose
   *   mayros:build_command  — build/test/install command
   *
   * Returns the number of triples created.
   */
  async ingestMayrosMd(content: string): Promise<number> {
    if (!content.trim()) return 0;

    const lines = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const triples: CreateTripleRequest[] = [];
    let currentSection = "";
    let sectionDepth = 0;

    for (const line of lines) {
      // Track section headings
      const headingMatch = /^(#{1,4})\s+(.+)$/.exec(line);
      if (headingMatch) {
        sectionDepth = headingMatch[1].length;
        currentSection = headingMatch[2].trim();

        triples.push({
          subject: `${this.ns}:mayros:section:${slugify(currentSection)}`,
          predicate: `${this.ns}:mayros:section`,
          object: currentSection,
        });
        continue;
      }

      // Detect build/test commands
      const cmdMatch = /^\s*[-*]\s*\*?\*?(\w[\w\s]*?)\*?\*?:\s*`(.+)`/.exec(line);
      if (cmdMatch) {
        const label = cmdMatch[1].trim().toLowerCase();
        const cmd = cmdMatch[2].trim();

        if (BUILD_LABELS.some((bl) => label.includes(bl))) {
          triples.push({
            subject: `${this.ns}:mayros:build:${slugify(label)}`,
            predicate: `${this.ns}:mayros:build_command`,
            object: `${label}: ${cmd}`,
          });
        }
        continue;
      }

      // Detect key files in table rows
      const tableMatch = /^\|\s*`([^`]+)`\s*\|\s*(.+?)\s*\|/.exec(line);
      if (tableMatch && currentSection.toLowerCase().includes("file")) {
        const filePath = tableMatch[1].trim();
        const purpose = tableMatch[2].trim();
        if (filePath && purpose && !filePath.includes("---")) {
          triples.push({
            subject: `${this.ns}:mayros:file:${slugify(filePath)}`,
            predicate: `${this.ns}:mayros:key_file`,
            object: `${filePath} — ${purpose}`,
          });
          continue;
        }
      }

      // Detect coding conventions (bullet points with strong indicators)
      const bulletMatch = /^\s*[-*]\s+(.+)$/.exec(line);
      if (bulletMatch && currentSection && sectionDepth >= 1) {
        const text = bulletMatch[1].trim();
        if (
          text.length >= 10 &&
          text.length <= 200 &&
          CONVENTION_INDICATORS.some((ci) => text.toLowerCase().includes(ci))
        ) {
          triples.push({
            subject: `${this.ns}:mayros:convention:${slugify(text.slice(0, 40))}`,
            predicate: `${this.ns}:mayros:convention`,
            object: text,
          });
        }
      }
    }

    // Deduplicate by subject+predicate
    const seen = new Set<string>();
    const unique = triples.filter((t) => {
      const key = `${t.subject}::${t.predicate}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    // Write to Cortex
    for (const t of unique) {
      await this.client.createTriple(t);
    }

    return unique.length;
  }

  async stats(): Promise<{
    conventions: number;
    decisions: number;
    findings: number;
  }> {
    let conventions = 0;
    let decisions = 0;
    let findings = 0;

    try {
      const statusMatches = await this.client.patternQuery({
        predicate: projectPredicate(this.ns, "status"),
        limit: 10000,
      });

      for (const match of statusMatches.matches) {
        if (match.subject.includes(":project:convention:")) conventions++;
        else if (match.subject.includes(":project:decision:")) decisions++;
      }

      const sessionMatches = await this.client.patternQuery({
        predicate: `${this.ns}:session:type`,
        limit: 10000,
      });
      findings = sessionMatches.total;
    } catch {
      // Stats unavailable
    }

    return { conventions, decisions, findings };
  }
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

function triplesToConvention(ns: string, triples: TripleDto[]): ProjectConvention | null {
  if (triples.length === 0) return null;

  const subj = triples[0].subject;
  // Extract id from subject: {ns}:project:convention:{id} or {ns}:project:decision:{id}
  const parts = subj.split(":");
  const id = parts.length >= 4 ? parts.slice(3).join(":") : subj;

  let text = "";
  let category: ConventionCategory = "style";
  let source: ProjectKnowledgeSource = "user";
  let confidence = 0.8;
  let context = "";
  let status: ProjectKnowledgeStatus = "active";
  let createdAt = "";
  let supersedes: string | undefined;

  for (const t of triples) {
    const pred = t.predicate;
    if (pred.endsWith(":text")) text = stringValue(t.object);
    else if (pred.endsWith(":category")) category = stringValue(t.object) as ConventionCategory;
    else if (pred.endsWith(":source")) source = stringValue(t.object) as ProjectKnowledgeSource;
    else if (pred.endsWith(":confidence")) confidence = numberValue(t.object);
    else if (pred.endsWith(":context")) context = stringValue(t.object);
    else if (pred.endsWith(":status")) status = stringValue(t.object) as ProjectKnowledgeStatus;
    else if (pred.endsWith(":createdAt")) createdAt = stringValue(t.object);
    else if (pred.endsWith(":supersedes")) {
      const node = stringValue(t.object);
      const nodeParts = node.split(":");
      supersedes = nodeParts.length >= 4 ? nodeParts.slice(3).join(":") : node;
    }
  }

  if (!text) return null;

  return { id, text, category, source, confidence, context, status, createdAt, supersedes };
}

// ============================================================================
// MAYROS.md ingestion helpers
// ============================================================================

const BUILD_LABELS = ["install", "build", "test", "lint", "type", "check", "run", "deploy", "sync"];

const CONVENTION_INDICATORS = [
  "typescript",
  "esm",
  "strict",
  "no ",
  "colocated",
  "vitest",
  "pnpm",
  "npm",
  "plugin",
  "extension",
  "typebox",
  "zod",
  "not ",
  "prefer",
  "always",
  "never",
  "avoid",
  "use ",
  "keep",
  "must",
  "should",
];

function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
  return slug || `item-${Date.now().toString(36)}-${randomUUID().slice(0, 8)}`;
}

function triplesToFinding(ns: string, triples: TripleDto[]): SessionFinding | null {
  if (triples.length === 0) return null;

  const subj = triples[0].subject;
  const parts = subj.split(":");
  const id = parts.length >= 4 ? parts.slice(3).join(":") : subj;

  let type: "change" | "finding" | "error" = "finding";
  let text = "";
  let createdAt = "";
  let sessionKey: string | undefined;

  for (const t of triples) {
    const pred = t.predicate;
    if (pred.endsWith(":text")) text = stringValue(t.object);
    else if (pred.endsWith(":type")) type = stringValue(t.object) as "change" | "finding" | "error";
    else if (pred.endsWith(":createdAt")) createdAt = stringValue(t.object);
    else if (pred.endsWith(":key")) sessionKey = stringValue(t.object);
  }

  if (!text) return null;

  return { id, type, text, createdAt, sessionKey };
}

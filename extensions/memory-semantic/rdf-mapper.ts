/**
 * Converts between MAYROS memory entries and RDF triples
 * suitable for the Cortex graph database.
 *
 * Namespace convention:
 *   {ns}:agent:{agentId}          — entity representing an agent
 *   {ns}:memory:{uuid}            — a single memory entry
 *
 * Predicates:
 *   {ns}:memory:text              — memory body text
 *   {ns}:memory:category          — preference | fact | decision | entity | other
 *   {ns}:memory:importance        — 0.0–1.0 float
 *   {ns}:memory:createdAt         — ISO-8601 timestamp
 *   {ns}:memory:source            — origin: "user", "auto-capture", "migration"
 *   {ns}:memory:relatedTo         — link to another memory node
 *   {ns}:memory:ownedBy           — link from memory back to agent
 */

import { randomUUID } from "node:crypto";
import type { CreateTripleRequest, TripleDto, ValueDto } from "./cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type SemanticMemoryEntry = {
  id: string;
  text: string;
  category: string;
  importance: number;
  createdAt: string;
  source: string;
  relations: string[];
};

// ============================================================================
// Namespace helpers
// ============================================================================

export function agentSubject(ns: string, agentId: string): string {
  return `${ns}:agent:${agentId}`;
}

export function memorySubject(ns: string, memoryId: string): string {
  return `${ns}:memory:${memoryId}`;
}

export function predicate(ns: string, name: string): string {
  return `${ns}:memory:${name}`;
}

// ============================================================================
// Memory → Triples
// ============================================================================

export function memoryToTriples(
  ns: string,
  agentId: string,
  entry: {
    id?: string;
    text: string;
    category?: string;
    importance?: number;
    source?: string;
    relations?: string[];
  },
): CreateTripleRequest[] {
  const id = entry.id ?? randomUUID();
  const subj = memorySubject(ns, id);
  const now = new Date().toISOString();

  const triples: CreateTripleRequest[] = [
    { subject: subj, predicate: predicate(ns, "text"), object: entry.text },
    { subject: subj, predicate: predicate(ns, "category"), object: entry.category ?? "other" },
    { subject: subj, predicate: predicate(ns, "importance"), object: entry.importance ?? 0.7 },
    { subject: subj, predicate: predicate(ns, "createdAt"), object: now },
    { subject: subj, predicate: predicate(ns, "source"), object: entry.source ?? "user" },
    {
      subject: subj,
      predicate: predicate(ns, "ownedBy"),
      object: { node: agentSubject(ns, agentId) },
    },
  ];

  if (entry.relations) {
    for (const rel of entry.relations) {
      triples.push({
        subject: subj,
        predicate: predicate(ns, "relatedTo"),
        object: { node: memorySubject(ns, rel) },
      });
    }
  }

  return triples;
}

// ============================================================================
// Triples → Memory
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

/**
 * Reassemble a SemanticMemoryEntry from a flat list of triples
 * that all share the same subject (a memory node).
 */
export function triplesToMemory(triples: TripleDto[]): SemanticMemoryEntry | null {
  if (triples.length === 0) return null;

  // Extract memoryId from subject   "ns:memory:uuid" → "uuid"
  const subj = triples[0].subject;
  const parts = subj.split(":");
  const id = parts.length >= 3 ? parts.slice(2).join(":") : subj;

  let text = "";
  let category = "other";
  let importance = 0.7;
  let createdAt = "";
  let source = "user";
  const relations: string[] = [];

  for (const t of triples) {
    const pred = t.predicate;
    if (pred.endsWith(":text")) {
      text = stringValue(t.object);
    } else if (pred.endsWith(":category")) {
      category = stringValue(t.object);
    } else if (pred.endsWith(":importance")) {
      importance = numberValue(t.object);
    } else if (pred.endsWith(":createdAt")) {
      createdAt = stringValue(t.object);
    } else if (pred.endsWith(":source")) {
      source = stringValue(t.object);
    } else if (pred.endsWith(":relatedTo")) {
      const node = stringValue(t.object);
      // Extract memoryId from node reference
      const nodeParts = node.split(":");
      relations.push(nodeParts.length >= 3 ? nodeParts.slice(2).join(":") : node);
    }
  }

  if (!text) return null;

  return { id, text, category, importance, createdAt, source, relations };
}

// ============================================================================
// Markdown → Triples
// ============================================================================

/**
 * Parse a simple markdown memory file (MEMORY.md / memory/*.md)
 * into triples. Each top-level list item or heading+body becomes
 * one memory entry.
 */
export function markdownMemoryToTriples(
  ns: string,
  agentId: string,
  markdown: string,
): CreateTripleRequest[] {
  const all: CreateTripleRequest[] = [];
  const entries = parseMarkdownEntries(markdown);

  for (const entry of entries) {
    const triples = memoryToTriples(ns, agentId, {
      text: entry.text,
      category: entry.category,
      importance: entry.importance,
      source: "migration",
    });
    all.push(...triples);
  }

  return all;
}

// ============================================================================
// Markdown parsing helpers
// ============================================================================

type ParsedEntry = {
  text: string;
  category: string;
  importance: number;
};

function detectCategoryFromText(text: string): string {
  const lower = text.toLowerCase();
  if (/prefer|like|love|hate|want|always|never/i.test(lower)) return "preference";
  if (/decided|will use|chose|agreed/i.test(lower)) return "decision";
  if (/\+\d{10,}|@[\w.-]+\.\w+|is called|named/i.test(lower)) return "entity";
  if (/is|are|has|have|runs|uses/i.test(lower)) return "fact";
  return "other";
}

export function parseMarkdownEntries(markdown: string): ParsedEntry[] {
  const entries: ParsedEntry[] = [];
  const lines = markdown.split("\n");

  let currentHeading = "";
  let currentBody: string[] = [];

  const flush = () => {
    if (currentBody.length > 0) {
      const text = currentBody.join("\n").trim();
      if (text.length >= 5) {
        entries.push({
          text: currentHeading ? `${currentHeading}: ${text}` : text,
          category: detectCategoryFromText(text),
          importance: 0.6,
        });
      }
      currentBody = [];
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();

    // Heading
    if (/^#{1,3}\s/.test(line)) {
      flush();
      currentHeading = line.replace(/^#+\s*/, "").trim();
      continue;
    }

    // Top-level list item  (- or *)
    if (/^[-*]\s/.test(line)) {
      // Each bullet is its own entry
      const text = line.replace(/^[-*]\s+/, "").trim();
      if (text.length >= 5) {
        entries.push({
          text: currentHeading ? `${currentHeading}: ${text}` : text,
          category: detectCategoryFromText(text),
          importance: 0.6,
        });
      }
      continue;
    }

    // Continuation or body text
    if (line.trim().length > 0) {
      currentBody.push(line);
    } else {
      flush();
    }
  }

  flush();
  return entries;
}

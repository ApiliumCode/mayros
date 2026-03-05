/**
 * Smart Compaction — structured knowledge extraction from messages.
 *
 * Extracts structured knowledge from both user and assistant messages
 * before context compaction. Each extracted item is typed and can be
 * stored as project conventions, session findings, or error patterns.
 */

import { randomUUID } from "node:crypto";
import type { ConventionCategory, SessionFinding } from "./project-memory.js";

// ============================================================================
// Types
// ============================================================================

export type ExtractedKnowledge =
  | { kind: "convention"; text: string; category: ConventionCategory }
  | { kind: "decision"; text: string; category: ConventionCategory }
  | { kind: "change"; text: string }
  | { kind: "finding"; text: string }
  | { kind: "error"; text: string };

export type ExtractionResult = {
  items: ExtractedKnowledge[];
  messageCount: number;
};

// ============================================================================
// Extraction patterns — Assistant messages
// ============================================================================

const ASSISTANT_PATTERNS: Array<{
  pattern: RegExp;
  kind: ExtractedKnowledge["kind"];
}> = [
  {
    pattern:
      /(?:I(?:'ve| have)?\s+(?:created|modified|updated|added|removed|deleted|refactored))\s+(.+)/i,
    kind: "change",
  },
  {
    pattern: /(?:The (?:bug|issue|error|problem) (?:was|is) (?:caused by|due to|in))\s+(.+)/i,
    kind: "finding",
  },
  {
    pattern: /(?:(?:Convention|Pattern|Rule):\s*)(.+)/i,
    kind: "convention",
  },
  {
    pattern: /(?:error|exception|failed|crash)(?:ed)?[:\s]+(.{10,})/i,
    kind: "error",
  },
];

// ============================================================================
// Extraction patterns — User messages
// ============================================================================

const USER_CONVENTION_PATTERNS: Array<{
  pattern: RegExp;
  category: ConventionCategory;
}> = [
  { pattern: /we (?:always|never|should|must|prefer)\s+(.+)/i, category: "style" },
  { pattern: /convention (?:is|that)\s+(.+)/i, category: "style" },
  { pattern: /architecture (?:uses|is based on|follows)\s+(.+)/i, category: "architecture" },
  {
    pattern: /(?:test|testing) (?:strategy|approach|convention)\s*(?:is|:)\s*(.+)/i,
    category: "testing",
  },
  { pattern: /naming (?:convention|pattern)\s*(?:is|:)\s*(.+)/i, category: "naming" },
];

const USER_DECISION_PATTERNS: Array<{
  pattern: RegExp;
  category: ConventionCategory;
}> = [
  { pattern: /decided (?:to|that)\s+(.+)/i, category: "architecture" },
  { pattern: /agreed (?:to|that|on)\s+(.+)/i, category: "architecture" },
  { pattern: /will (?:use|implement|adopt)\s+(.+)/i, category: "tooling" },
];

// ============================================================================
// Extraction logic
// ============================================================================

function extractFromText(text: string, role: "user" | "assistant"): ExtractedKnowledge[] {
  const items: ExtractedKnowledge[] = [];
  if (!text || text.length < 10) return items;

  // Skip XML-tagged content (injected context, tool results)
  if (text.startsWith("<") && text.includes("</")) return items;

  if (role === "assistant") {
    for (const { pattern, kind } of ASSISTANT_PATTERNS) {
      const m = pattern.exec(text);
      if (m && m[1]) {
        const extracted = m[1].trim().slice(0, 300);
        if (extracted.length >= 10) {
          if (kind === "convention") {
            items.push({ kind, text: extracted, category: "style" });
          } else {
            items.push({ kind, text: extracted } as ExtractedKnowledge);
          }
        }
      }
    }
  }

  if (role === "user") {
    for (const { pattern, category } of USER_CONVENTION_PATTERNS) {
      const m = pattern.exec(text);
      if (m && m[1]) {
        const extracted = m[1].trim().slice(0, 300);
        if (extracted.length >= 5) {
          items.push({ kind: "convention", text: extracted, category });
        }
      }
    }

    for (const { pattern, category } of USER_DECISION_PATTERNS) {
      const m = pattern.exec(text);
      if (m && m[1]) {
        const extracted = m[1].trim().slice(0, 300);
        if (extracted.length >= 5) {
          items.push({ kind: "decision", text: extracted, category });
        }
      }
    }
  }

  return items;
}

// ============================================================================
// Public API
// ============================================================================

export class CompactionExtractor {
  /**
   * Extract structured knowledge from an array of chat messages.
   * Messages are expected to have `role` and `content` fields.
   */
  static extract(messages: Array<Record<string, unknown>>): ExtractionResult {
    const items: ExtractedKnowledge[] = [];
    let messageCount = 0;

    for (const msg of messages) {
      if (!msg || typeof msg !== "object") continue;

      const role = msg.role as string;
      if (role !== "user" && role !== "assistant") continue;

      messageCount++;

      const content = msg.content;
      if (typeof content === "string") {
        items.push(...extractFromText(content, role as "user" | "assistant"));
      } else if (Array.isArray(content)) {
        for (const block of content) {
          if (
            block &&
            typeof block === "object" &&
            "type" in (block as Record<string, unknown>) &&
            (block as Record<string, unknown>).type === "text" &&
            "text" in (block as Record<string, unknown>) &&
            typeof (block as Record<string, unknown>).text === "string"
          ) {
            items.push(
              ...extractFromText(
                (block as Record<string, unknown>).text as string,
                role as "user" | "assistant",
              ),
            );
          }
        }
      }
    }

    // Deduplicate by text (keep first occurrence)
    const seen = new Set<string>();
    const unique = items.filter((item) => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });

    return { items: unique.slice(0, 20), messageCount };
  }

  /**
   * Convert extracted knowledge items to session findings.
   */
  static toFindings(items: ExtractedKnowledge[], sessionKey?: string): SessionFinding[] {
    return items
      .filter((item) => item.kind === "change" || item.kind === "finding" || item.kind === "error")
      .map((item) => ({
        id: randomUUID(),
        type: item.kind as "change" | "finding" | "error",
        text: item.text,
        createdAt: new Date().toISOString(),
        sessionKey,
      }));
  }
}

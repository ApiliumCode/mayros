/**
 * Compact handler — manual context compaction triggered by /compact.
 *
 * Extracts knowledge from current messages using pattern-based extraction,
 * then creates a summary replacing the history.
 */

export type CompactOptions = {
  messages: Array<{ role: string; content: string }>;
  sessionKey: string;
  onKnowledgeExtracted?: (items: Array<{ kind: string; text: string }>) => Promise<void>;
};

export type CompactResult = {
  originalCount: number;
  summaryLength: number;
  knowledgeItems: number;
  summary: string;
};

// Convention categories for extraction
type ConventionCategory =
  | "naming"
  | "architecture"
  | "testing"
  | "tooling"
  | "style"
  | "workflow"
  | "general";

type ExtractedKnowledge =
  | { kind: "convention"; text: string; category: ConventionCategory }
  | { kind: "decision"; text: string; category: string }
  | { kind: "change"; text: string }
  | { kind: "finding"; text: string }
  | { kind: "error"; text: string };

// Inline extraction logic (mirrors CompactionExtractor patterns without import dependency)
const ASSISTANT_CHANGE_PATTERNS = [
  /I(?:'ve|'ve| have) (?:created|modified|updated|added|removed|deleted|refactored|renamed|moved)/i,
  /(?:created|modified|updated|added|removed|deleted|refactored) (?:the |a )?(?:file|function|class|component|module|test)/i,
];

const ASSISTANT_FINDING_PATTERNS = [
  /(?:the )?(?:bug|issue|problem|error|root cause) (?:was|is|seems to be)/i,
  /(?:found|discovered|noticed|identified) (?:that|a |the )/i,
];

const ASSISTANT_CONVENTION_PATTERNS = [
  /convention:\s*/i,
  /(?:the )?(?:project|codebase|code) (?:uses?|follows?|has)\s/i,
];

const USER_CONVENTION_PATTERNS = [
  /we (?:always|never|should|must|prefer|use|follow)/i,
  /(?:naming |coding )?convention/i,
  /architecture uses?/i,
];

const USER_DECISION_PATTERNS = [
  /(?:let'?s|we'?ll|I'?ll|decided to|will) (?:use|implement|go with|switch to)/i,
  /decided (?:to|that)/i,
];

function extractKnowledge(text: string, role: string): ExtractedKnowledge[] {
  if (!text || text.length < 10) return [];
  // Skip XML-tagged content
  if (text.startsWith("<") && text.includes("</")) return [];

  const items: ExtractedKnowledge[] = [];
  const lines = text.split("\n").filter((l) => l.trim().length > 10);

  for (const line of lines) {
    if (role === "assistant") {
      for (const pat of ASSISTANT_CHANGE_PATTERNS) {
        if (pat.test(line)) {
          items.push({ kind: "change", text: line.trim() });
          break;
        }
      }
      for (const pat of ASSISTANT_FINDING_PATTERNS) {
        if (pat.test(line)) {
          items.push({ kind: "finding", text: line.trim() });
          break;
        }
      }
      for (const pat of ASSISTANT_CONVENTION_PATTERNS) {
        if (pat.test(line)) {
          items.push({ kind: "convention", text: line.trim(), category: "general" });
          break;
        }
      }
    }
    if (role === "user") {
      for (const pat of USER_CONVENTION_PATTERNS) {
        if (pat.test(line)) {
          items.push({ kind: "convention", text: line.trim(), category: "general" });
          break;
        }
      }
      for (const pat of USER_DECISION_PATTERNS) {
        if (pat.test(line)) {
          items.push({ kind: "decision", text: line.trim(), category: "general" });
          break;
        }
      }
    }
  }

  return items;
}

function buildSummary(
  messages: Array<{ role: string; content: string }>,
  knowledge: ExtractedKnowledge[],
): string {
  const parts: string[] = [`[Compacted from ${messages.length} messages]`];

  // Group knowledge by kind
  const changes = knowledge.filter((k) => k.kind === "change");
  const findings = knowledge.filter((k) => k.kind === "finding");
  const conventions = knowledge.filter((k) => k.kind === "convention");
  const decisions = knowledge.filter((k) => k.kind === "decision");

  if (changes.length > 0) {
    parts.push("\nChanges made:");
    for (const c of changes.slice(0, 10)) {
      parts.push(`  - ${c.text}`);
    }
  }
  if (findings.length > 0) {
    parts.push("\nFindings:");
    for (const f of findings.slice(0, 5)) {
      parts.push(`  - ${f.text}`);
    }
  }
  if (conventions.length > 0) {
    parts.push("\nConventions:");
    for (const c of conventions.slice(0, 5)) {
      parts.push(`  - ${c.text}`);
    }
  }
  if (decisions.length > 0) {
    parts.push("\nDecisions:");
    for (const d of decisions.slice(0, 5)) {
      parts.push(`  - ${d.text}`);
    }
  }

  // Include last user message as context
  const lastUserMsg = [...messages].reverse().find((m) => m.role === "user");
  if (lastUserMsg && lastUserMsg.content.length < 500) {
    parts.push(`\nLast request: ${lastUserMsg.content}`);
  }

  return parts.join("\n");
}

export async function compactMessages(options: CompactOptions): Promise<CompactResult> {
  const { messages, onKnowledgeExtracted } = options;

  // Extract knowledge from all messages
  const allKnowledge: ExtractedKnowledge[] = [];
  for (const msg of messages) {
    const extracted = extractKnowledge(msg.content, msg.role);
    allKnowledge.push(...extracted);
  }

  // Deduplicate by text
  const seen = new Set<string>();
  const uniqueKnowledge = allKnowledge.filter((k) => {
    if (seen.has(k.text)) return false;
    seen.add(k.text);
    return true;
  });

  const summary = buildSummary(messages, uniqueKnowledge);

  // Invoke the knowledge callback defensively — a Cortex write failure must
  // not prevent the compaction result from being returned to the caller.
  if (onKnowledgeExtracted && uniqueKnowledge.length > 0) {
    const items = uniqueKnowledge.map((k) => ({ kind: k.kind, text: k.text }));
    try {
      await onKnowledgeExtracted(items);
    } catch (err) {
      // Best-effort: log but do not propagate so callers always get a result.
      process.stderr.write(
        `[compact-handler] onKnowledgeExtracted callback failed: ${String(err)}\n`,
      );
    }
  }

  return {
    originalCount: messages.length,
    summaryLength: summary.length,
    knowledgeItems: uniqueKnowledge.length,
    summary,
  };
}

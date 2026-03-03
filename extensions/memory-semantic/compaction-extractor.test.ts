/**
 * Compaction Extractor Tests
 *
 * Tests cover:
 * - Assistant message extraction (changes, findings, errors, conventions)
 * - User message extraction (conventions, decisions)
 * - Mixed message extraction
 * - Edge cases (empty, XML-tagged, too short)
 * - Deduplication
 * - toFindings conversion
 */

import { describe, test, expect } from "vitest";
import { CompactionExtractor, type ExtractedKnowledge } from "./compaction-extractor.js";

// ============================================================================
// Assistant message extraction
// ============================================================================

describe("assistant message extraction", () => {
  test("extracts file changes", () => {
    const messages = [
      {
        role: "assistant",
        content: "I've modified the authentication handler to fix the token refresh bug.",
      },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("change");
    expect(result.items[0].text).toContain("authentication handler");
  });

  test("extracts created items", () => {
    const messages = [
      { role: "assistant", content: "I have created a new utility function for date formatting." },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "change")).toBe(true);
  });

  test("extracts bug findings", () => {
    const messages = [
      {
        role: "assistant",
        content: "The bug was caused by a race condition in the WebSocket handler.",
      },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "finding")).toBe(true);
    expect(result.items[0].text).toContain("race condition");
  });

  test("extracts convention statements", () => {
    const messages = [
      { role: "assistant", content: "Convention: always use snake_case for database column names" },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "convention")).toBe(true);
  });

  test("extracts error patterns", () => {
    const messages = [
      {
        role: "assistant",
        content: "error: ECONNREFUSED when connecting to the database at localhost:5432",
      },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "error")).toBe(true);
  });
});

// ============================================================================
// User message extraction
// ============================================================================

describe("user message extraction", () => {
  test("extracts convention from 'we always'", () => {
    const messages = [
      { role: "user", content: "we always use TypeScript strict mode in this project" },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].kind).toBe("convention");
    expect(result.items[0]).toHaveProperty("category", "style");
  });

  test("extracts convention from 'we never'", () => {
    const messages = [{ role: "user", content: "we never use any type in our codebase" }];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "convention")).toBe(true);
  });

  test("extracts architecture convention", () => {
    const messages = [
      { role: "user", content: "architecture uses hexagonal pattern with ports and adapters" },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items[0]).toHaveProperty("category", "architecture");
  });

  test("extracts decision from 'decided to'", () => {
    const messages = [{ role: "user", content: "decided to use pnpm as the package manager" }];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "decision")).toBe(true);
  });

  test("extracts decision from 'will use'", () => {
    const messages = [{ role: "user", content: "will use vitest instead of jest for all tests" }];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "decision")).toBe(true);
    expect(result.items[0]).toHaveProperty("category", "tooling");
  });
});

// ============================================================================
// Mixed messages
// ============================================================================

describe("mixed message extraction", () => {
  test("extracts from both user and assistant messages", () => {
    const messages = [
      { role: "user", content: "we always write tests for new functions" },
      { role: "assistant", content: "I've created the test file for the new parser." },
      { role: "user", content: "decided to use vitest for this project" },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.length).toBeGreaterThanOrEqual(3);
    expect(result.messageCount).toBe(3);
  });

  test("handles array content blocks", () => {
    const messages = [
      {
        role: "user",
        content: [{ type: "text", text: "we always use strict TypeScript" }],
      },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items.some((i) => i.kind === "convention")).toBe(true);
  });
});

// ============================================================================
// Edge cases
// ============================================================================

describe("edge cases", () => {
  test("skips empty messages", () => {
    const messages = [
      { role: "user", content: "" },
      { role: "assistant", content: "" },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items).toHaveLength(0);
  });

  test("skips very short messages", () => {
    const messages = [{ role: "user", content: "ok" }];

    const result = CompactionExtractor.extract(messages);
    expect(result.items).toHaveLength(0);
  });

  test("skips XML-tagged content", () => {
    const messages = [
      { role: "assistant", content: "<tool-result>I've modified the file</tool-result>" },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items).toHaveLength(0);
  });

  test("skips system role messages", () => {
    const messages = [{ role: "system", content: "we always use TypeScript" }];

    const result = CompactionExtractor.extract(messages);
    expect(result.items).toHaveLength(0);
    expect(result.messageCount).toBe(0);
  });

  test("handles null and malformed messages", () => {
    const messages = [
      null as unknown as Record<string, unknown>,
      {} as Record<string, unknown>,
      { role: "user" },
    ];

    const result = CompactionExtractor.extract(messages);
    expect(result.items).toHaveLength(0);
  });

  test("deduplicates identical extractions", () => {
    const messages = [
      { role: "user", content: "we always use TypeScript strict mode" },
      { role: "user", content: "we always use TypeScript strict mode" },
    ];

    const result = CompactionExtractor.extract(messages);
    // Should only have 1 unique extraction
    const conventionItems = result.items.filter((i) => i.kind === "convention");
    expect(conventionItems).toHaveLength(1);
  });

  test("caps at 20 items", () => {
    // Create many messages that all extract something
    const messages = Array.from({ length: 30 }, (_, i) => ({
      role: "user" as const,
      content: `we always use pattern number ${i} in our codebase`,
    }));

    const result = CompactionExtractor.extract(messages);
    expect(result.items.length).toBeLessThanOrEqual(20);
  });
});

// ============================================================================
// toFindings conversion
// ============================================================================

describe("toFindings", () => {
  test("converts change items to findings", () => {
    const items: ExtractedKnowledge[] = [
      { kind: "change", text: "modified auth handler" },
      { kind: "finding", text: "race condition in websocket" },
      { kind: "error", text: "ECONNREFUSED on port 5432" },
      { kind: "convention", text: "use strict mode", category: "style" },
    ];

    const findings = CompactionExtractor.toFindings(items, "session-123");

    // Should only include change, finding, error — not convention
    expect(findings).toHaveLength(3);
    expect(findings[0].type).toBe("change");
    expect(findings[1].type).toBe("finding");
    expect(findings[2].type).toBe("error");
    expect(findings[0].sessionKey).toBe("session-123");
    expect(findings[0].id).toBeTruthy();
    expect(findings[0].createdAt).toBeTruthy();
  });

  test("returns empty array for no matching items", () => {
    const items: ExtractedKnowledge[] = [
      { kind: "convention", text: "use strict mode", category: "style" },
      { kind: "decision", text: "use vitest", category: "tooling" },
    ];

    const findings = CompactionExtractor.toFindings(items);
    expect(findings).toHaveLength(0);
  });
});

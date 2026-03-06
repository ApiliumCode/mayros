import { describe, it, expect } from "vitest";
import { compactMessages } from "./compact-handler.js";

describe("compactMessages", () => {
  it("returns summary for empty messages", async () => {
    const result = await compactMessages({ messages: [], sessionKey: "test" });
    expect(result.originalCount).toBe(0);
    expect(result.summary).toContain("[Compacted from 0 messages]");
    expect(result.knowledgeItems).toBe(0);
  });

  it("extracts changes from assistant messages", async () => {
    const result = await compactMessages({
      messages: [
        {
          role: "assistant",
          content: "I've created the new module in src/lib.ts with the helper functions.",
        },
      ],
      sessionKey: "test",
    });
    expect(result.knowledgeItems).toBeGreaterThan(0);
    expect(result.summary).toContain("Changes made:");
  });

  it("extracts findings from assistant messages", async () => {
    const result = await compactMessages({
      messages: [
        {
          role: "assistant",
          content: "The bug was caused by a race condition in the async handler.",
        },
      ],
      sessionKey: "test",
    });
    expect(result.knowledgeItems).toBeGreaterThan(0);
    expect(result.summary).toContain("Findings:");
  });

  it("extracts conventions from user messages", async () => {
    const result = await compactMessages({
      messages: [
        { role: "user", content: "We always use camelCase for variable names in this project." },
      ],
      sessionKey: "test",
    });
    expect(result.knowledgeItems).toBeGreaterThan(0);
    expect(result.summary).toContain("Conventions:");
  });

  it("extracts decisions from user messages", async () => {
    const result = await compactMessages({
      messages: [
        { role: "user", content: "Let's use Redis for the caching layer instead of memcached." },
      ],
      sessionKey: "test",
    });
    expect(result.knowledgeItems).toBeGreaterThan(0);
    expect(result.summary).toContain("Decisions:");
  });

  it("deduplicates knowledge items", async () => {
    const result = await compactMessages({
      messages: [
        { role: "assistant", content: "I've created the new file src/main.ts" },
        { role: "assistant", content: "I've created the new file src/main.ts" },
      ],
      sessionKey: "test",
    });
    // Should deduplicate
    expect(result.knowledgeItems).toBe(1);
  });

  it("includes last user message in summary", async () => {
    const result = await compactMessages({
      messages: [
        { role: "user", content: "Fix the login bug" },
        {
          role: "assistant",
          content: "I've modified the login handler to fix the race condition.",
        },
        { role: "user", content: "Now add tests for it" },
      ],
      sessionKey: "test",
    });
    expect(result.summary).toContain("Last request: Now add tests for it");
    expect(result.originalCount).toBe(3);
  });

  it("skips short messages", async () => {
    const result = await compactMessages({
      messages: [
        { role: "user", content: "ok" },
        { role: "assistant", content: "done" },
      ],
      sessionKey: "test",
    });
    expect(result.knowledgeItems).toBe(0);
  });

  it("skips XML-tagged content", async () => {
    const result = await compactMessages({
      messages: [
        { role: "assistant", content: "<tool-result>I've created the new file</tool-result>" },
      ],
      sessionKey: "test",
    });
    expect(result.knowledgeItems).toBe(0);
  });

  it("invokes onKnowledgeExtracted callback with extracted items", async () => {
    const captured: Array<{ kind: string; text: string }> = [];
    const result = await compactMessages({
      messages: [
        {
          role: "assistant",
          content: "I've created the new module in src/lib.ts with the helper functions.",
        },
      ],
      sessionKey: "test",
      onKnowledgeExtracted: async (items) => {
        captured.push(...items);
      },
    });
    expect(result.knowledgeItems).toBeGreaterThan(0);
    expect(captured.length).toBeGreaterThan(0);
    expect(captured[0]).toHaveProperty("kind");
    expect(captured[0]).toHaveProperty("text");
  });

  it("does not throw when onKnowledgeExtracted callback rejects", async () => {
    await expect(
      compactMessages({
        messages: [
          {
            role: "assistant",
            content: "I've created the new module in src/lib.ts with the helper functions.",
          },
        ],
        sessionKey: "test",
        onKnowledgeExtracted: async () => {
          throw new Error("Cortex unavailable");
        },
      }),
    ).resolves.toBeDefined();
  });
});

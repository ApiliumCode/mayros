import { describe, expect, it } from "vitest";
import { extractTopics, generateSessionSummary, generateTitle } from "./session-summary.js";

describe("extractTopics", () => {
  it("extracts programming language keywords from user messages", () => {
    const topics = extractTopics([
      { role: "user", content: "Fix the TypeScript error in the parser" },
      { role: "assistant", content: "I see the issue in the TypeScript file" },
    ]);
    expect(topics).toContain("typescript");
    expect(topics).toContain("fix");
  });

  it("extracts framework keywords", () => {
    const topics = extractTopics([
      { role: "user", content: "Add a React component with Tailwind styles" },
    ]);
    expect(topics).toContain("react");
    expect(topics).toContain("tailwind");
    expect(topics).toContain("add");
  });

  it("returns at most 5 topics", () => {
    const topics = extractTopics([
      {
        role: "user",
        content:
          "Fix the TypeScript React component, add Python tests, refactor the Rust code, update Docker config, optimize SQL queries, deploy to Kubernetes",
      },
    ]);
    expect(topics.length).toBeLessThanOrEqual(5);
  });

  it("ignores assistant messages", () => {
    const topics = extractTopics([
      { role: "assistant", content: "Using TypeScript and React here" },
    ]);
    expect(topics).toHaveLength(0);
  });
});

describe("generateTitle", () => {
  it("uses the first user message when it starts with a verb", () => {
    const title = generateTitle([{ role: "user", content: "Fix the login page bug" }]);
    expect(title).toBe("Fix the login page bug");
  });

  it("prefixes with the most common verb when message doesn't start with one", () => {
    const title = generateTitle([
      { role: "user", content: "The parser has a bug" },
      { role: "user", content: "I need to fix the parser" },
    ]);
    expect(title).toMatch(/^Fix: /);
  });

  it("truncates long titles to 60 chars", () => {
    const long = "A".repeat(100);
    const title = generateTitle([{ role: "user", content: long }]);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/\.\.\.$/);
  });

  it("returns 'Empty session' when no user messages exist", () => {
    expect(generateTitle([{ role: "system", content: "init" }])).toBe("Empty session");
  });
});

describe("generateSessionSummary", () => {
  it("computes correct message count and duration", () => {
    const summary = generateSessionSummary({
      messages: [
        { role: "user", content: "Fix bug" },
        { role: "assistant", content: "Done" },
      ],
      sessionKey: "s1",
      startedAt: 1000,
      endedAt: 5000,
    });
    expect(summary.messageCount).toBe(2);
    expect(summary.durationMs).toBe(4000);
  });

  it("extracts unique tool names", () => {
    const summary = generateSessionSummary({
      messages: [{ role: "user", content: "read files" }],
      toolCalls: [{ name: "read_file" }, { name: "edit_file" }, { name: "read_file" }],
      sessionKey: "s2",
      startedAt: 0,
      endedAt: 1000,
    });
    expect(summary.toolsUsed).toEqual(["read_file", "edit_file"]);
  });

  it("includes topics and title in the output", () => {
    const summary = generateSessionSummary({
      messages: [
        { role: "user", content: "Add a new React component" },
        { role: "assistant", content: "Here is the component" },
      ],
      sessionKey: "s3",
      startedAt: 0,
      endedAt: 2000,
    });
    expect(summary.title).toBeTruthy();
    expect(summary.topics.length).toBeGreaterThan(0);
    expect(summary.description).toContain("1 user message");
  });
});

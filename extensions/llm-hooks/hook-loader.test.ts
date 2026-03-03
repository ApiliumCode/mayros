import { describe, it, expect } from "vitest";
import { parseHookMarkdown } from "./hook-loader.js";

// ============================================================================
// Helper
// ============================================================================

function makeHookMd(
  frontmatter: Record<string, string>,
  body = 'Analyze and respond with JSON: { "decision": "approve", "reason": "ok" }',
): string {
  const lines = Object.entries(frontmatter).map(([k, v]) => `${k}: ${v}`);
  return `---\n${lines.join("\n")}\n---\n\n${body}`;
}

// ============================================================================
// parseHookMarkdown
// ============================================================================

describe("parseHookMarkdown", () => {
  it("parses a valid hook file with all fields", () => {
    const content = makeHookMd({
      name: "no-force-push",
      description: "Prevent force pushes to protected branches",
      events: "before_tool_call",
      condition: 'toolName == "exec"',
      model: "anthropic/claude-sonnet-4-20250514",
      timeout: "15000",
      cache: "session",
      priority: "150",
      enabled: "true",
    });

    const hook = parseHookMarkdown(content, "/path/to/hook.md", "project");

    expect(hook.name).toBe("no-force-push");
    expect(hook.description).toBe("Prevent force pushes to protected branches");
    expect(hook.events).toEqual(["before_tool_call"]);
    expect(hook.condition).toBe('toolName == "exec"');
    expect(hook.model).toBe("anthropic/claude-sonnet-4-20250514");
    expect(hook.timeoutMs).toBe(15000);
    expect(hook.cache).toBe("session");
    expect(hook.priority).toBe(150);
    expect(hook.enabled).toBe(true);
    expect(hook.sourcePath).toBe("/path/to/hook.md");
    expect(hook.origin).toBe("project");
    expect(hook.body).toContain("Analyze and respond");
  });

  it("throws when name is missing", () => {
    const content = makeHookMd({ events: "before_tool_call" });
    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow(
      "missing required field: name",
    );
  });

  it("throws when events is missing", () => {
    const content = makeHookMd({ name: "test-hook" });
    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow(
      "missing required field: events",
    );
  });

  it("parses comma-separated events", () => {
    const content = makeHookMd({
      name: "multi-event",
      events: "before_tool_call, after_tool_call, message_sending",
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.events).toEqual(["before_tool_call", "after_tool_call", "message_sending"]);
  });

  it("parses single event", () => {
    const content = makeHookMd({
      name: "single-event",
      events: "session_start",
    });

    const hook = parseHookMarkdown(content, "/test.md", "user");
    expect(hook.events).toEqual(["session_start"]);
    expect(hook.origin).toBe("user");
  });

  it("throws on invalid event name", () => {
    const content = makeHookMd({
      name: "bad-event",
      events: "invalid_event",
    });

    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow(
      "invalid event: invalid_event",
    );
  });

  it("throws on empty events list", () => {
    const content = makeHookMd({
      name: "empty-events",
      events: "  ,  ,  ",
    });

    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow("empty events list");
  });

  it("applies default values for optional fields", () => {
    const content = makeHookMd({
      name: "defaults-hook",
      events: "before_tool_call",
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.description).toBe("");
    expect(hook.condition).toBeUndefined();
    expect(hook.model).toBeUndefined();
    expect(hook.timeoutMs).toBe(15000);
    expect(hook.cache).toBe("session");
    expect(hook.priority).toBe(100);
    expect(hook.enabled).toBe(true);
  });

  it("extracts body after second --- delimiter", () => {
    const body = "Check if the command is dangerous.\n\nRespond with JSON.";
    const content = makeHookMd({ name: "body-test", events: "before_tool_call" }, body);

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.body).toBe(body);
  });

  it("throws when body is empty", () => {
    const content = "---\nname: no-body\nevents: before_tool_call\n---\n";
    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow("no prompt body");
  });

  it("parses disabled hooks", () => {
    const content = makeHookMd({
      name: "disabled-hook",
      events: "before_tool_call",
      enabled: "false",
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.enabled).toBe(false);
  });

  it("throws on invalid timeout value", () => {
    const content = makeHookMd({
      name: "bad-timeout",
      events: "before_tool_call",
      timeout: "abc",
    });

    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow("invalid timeout");
  });

  it("throws on timeout below minimum", () => {
    const content = makeHookMd({
      name: "low-timeout",
      events: "before_tool_call",
      timeout: "50",
    });

    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow("invalid timeout");
  });

  it("throws on invalid cache scope", () => {
    const content = makeHookMd({
      name: "bad-cache",
      events: "before_tool_call",
      cache: "forever",
    });

    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow("invalid cache scope");
  });

  it("throws on invalid priority value", () => {
    const content = makeHookMd({
      name: "bad-priority",
      events: "before_tool_call",
      priority: "abc",
    });

    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow("invalid priority");
  });

  it("handles missing frontmatter delimiters gracefully (no ---)", () => {
    const content = "Just some markdown content without frontmatter.";
    expect(() => parseHookMarkdown(content, "/test.md", "project")).toThrow(
      "missing required field: name",
    );
  });

  it("handles Windows-style line endings", () => {
    const content =
      "---\r\nname: win-hook\r\nevents: before_tool_call\r\n---\r\n\r\nPrompt body here.";
    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.name).toBe("win-hook");
    expect(hook.body).toBe("Prompt body here.");
  });

  it("preserves multiline body content", () => {
    const body = "Line 1.\n\nLine 2.\n\nLine 3 with special chars: <>&\"'";
    const content = makeHookMd({ name: "multiline", events: "before_tool_call" }, body);

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.body).toBe(body);
  });

  it("sets origin to user for user hooks", () => {
    const content = makeHookMd({ name: "user-hook", events: "session_start" });
    const hook = parseHookMarkdown(content, "~/.mayros/hooks/test.md", "user");
    expect(hook.origin).toBe("user");
  });

  it("parses all valid event types", () => {
    const allEvents = [
      "before_tool_call",
      "before_prompt_build",
      "message_sending",
      "before_agent_start",
      "after_tool_call",
      "session_start",
      "session_end",
    ];

    const content = makeHookMd({
      name: "all-events",
      events: allEvents.join(", "),
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.events).toEqual(allEvents);
  });

  it("handles cache scope 'none'", () => {
    const content = makeHookMd({
      name: "no-cache",
      events: "before_tool_call",
      cache: "none",
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.cache).toBe("none");
  });

  it("handles cache scope 'global'", () => {
    const content = makeHookMd({
      name: "global-cache",
      events: "before_tool_call",
      cache: "global",
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.cache).toBe("global");
  });

  it("strips quotes from frontmatter values", () => {
    const content = makeHookMd({
      name: '"quoted-hook"',
      events: "before_tool_call",
      description: "'A quoted description'",
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.name).toBe("quoted-hook");
    expect(hook.description).toBe("A quoted description");
  });

  it("handles condition with complex expression", () => {
    const content = makeHookMd({
      name: "complex-condition",
      events: "before_tool_call",
      condition: 'toolName == "exec" && params.command.includes("git push")',
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.condition).toBe('toolName == "exec" && params.command.includes("git push")');
  });

  it("handles numeric priority correctly", () => {
    const content = makeHookMd({
      name: "high-priority",
      events: "before_tool_call",
      priority: "999",
    });

    const hook = parseHookMarkdown(content, "/test.md", "project");
    expect(hook.priority).toBe(999);
  });
});

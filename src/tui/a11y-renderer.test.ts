import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { A11yRenderer, isA11yMode } from "./a11y-renderer.js";

describe("A11yRenderer", () => {
  let lines: string[];
  let renderer: A11yRenderer;

  beforeEach(() => {
    lines = [];
    renderer = new A11yRenderer((text) => {
      lines.push(text);
    });
  });

  it("emit system event formats as [System] text", () => {
    renderer.emit({ type: "system", text: "hello world" });
    expect(lines).toEqual(["[System] hello world\n"]);
  });

  it("emit user event formats as [You] text", () => {
    renderer.emit({ type: "user", text: "my question" });
    expect(lines).toEqual(["[You] my question\n"]);
  });

  it("emit assistant event formats as [Assistant] text", () => {
    renderer.emit({ type: "assistant", text: "my answer" });
    expect(lines).toEqual(["[Assistant] my answer\n"]);
  });

  it("emit tool-start event formats as [Tool] name", () => {
    renderer.emit({ type: "tool-start", name: "bash" });
    expect(lines).toEqual(["[Tool] bash\n"]);
  });

  it("emit tool-start with detail formats as [Tool] name: detail", () => {
    renderer.emit({ type: "tool-start", name: "bash", detail: "ls -la" });
    expect(lines).toEqual(["[Tool] bash: ls -la\n"]);
  });

  it("emit tool-result event formats as [Result] name: text", () => {
    renderer.emit({ type: "tool-result", name: "bash", text: "file1.ts" });
    expect(lines).toEqual(["[Result] bash: file1.ts\n"]);
  });

  it("emit tool-result error formats as [Error] name: text", () => {
    renderer.emit({ type: "tool-result", name: "bash", text: "not found", isError: true });
    expect(lines).toEqual(["[Error] bash: not found\n"]);
  });

  it("emit status event formats as [Status] text", () => {
    renderer.emit({ type: "status", text: "Ready" });
    expect(lines).toEqual(["[Status] Ready\n"]);
  });

  it("announce wraps text with dashes", () => {
    renderer.announce("Welcome");
    expect(lines).toEqual(["--- Welcome ---\n"]);
  });

  it("strips ANSI escape codes from all events", () => {
    renderer.emit({ type: "system", text: "\u001b[31mred text\u001b[0m" });
    expect(lines).toEqual(["[System] red text\n"]);
  });
});

describe("isA11yMode", () => {
  const originalEnv = process.env.MAYROS_ACCESSIBILITY;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.MAYROS_ACCESSIBILITY;
    } else {
      process.env.MAYROS_ACCESSIBILITY = originalEnv;
    }
  });

  it("returns true when MAYROS_ACCESSIBILITY=1", () => {
    process.env.MAYROS_ACCESSIBILITY = "1";
    expect(isA11yMode()).toBe(true);
  });

  it("returns false when MAYROS_ACCESSIBILITY is unset", () => {
    delete process.env.MAYROS_ACCESSIBILITY;
    expect(isA11yMode()).toBe(false);
  });
});

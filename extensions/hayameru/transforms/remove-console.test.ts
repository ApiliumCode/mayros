import { describe, it, expect } from "vitest";
import { removeConsole } from "./remove-console.js";

describe("removeConsole", () => {
  it("removes console.log", () => {
    const r = removeConsole("console.log('hello');\nconst x = 1;", "test.ts");
    expect(r.changed).toBe(true);
    expect(r.output).toBe("const x = 1;");
  });

  it("removes multiple console methods", () => {
    const source = "console.log('a');\nconsole.warn('b');\nconsole.debug('c');";
    const r = removeConsole(source, "test.ts");
    expect(r.edits).toBe(3);
    expect(r.output.trim()).toBe("");
  });

  it("handles multi-line console calls", () => {
    const source = "console.log(\n  'hello',\n  'world'\n);\nconst x = 1;";
    const r = removeConsole(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.output.trim()).toBe("const x = 1;");
  });

  it("leaves non-console code untouched", () => {
    const source = "const x = 1;\nreturn x;";
    const r = removeConsole(source, "test.ts");
    expect(r.changed).toBe(false);
  });

  // --- H7 fixes ---

  it("ignores parentheses inside double-quoted strings", () => {
    const source = 'console.log(")()(");\nconst x = 1;';
    const r = removeConsole(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.edits).toBe(1);
    expect(r.output).toBe("const x = 1;");
  });

  it("ignores parentheses inside single-quoted strings", () => {
    const source = "console.log('())(');\nconst x = 1;";
    const r = removeConsole(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.edits).toBe(1);
    expect(r.output).toBe("const x = 1;");
  });

  it("ignores parentheses inside template literals", () => {
    const source = "console.log(`()()`);\nconst x = 1;";
    const r = removeConsole(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.edits).toBe(1);
    expect(r.output).toBe("const x = 1;");
  });

  it("handles multi-line console with parens in string arguments", () => {
    const source = 'console.log(\n  "has ) inside",\n  "and ( too"\n);\nconst y = 2;';
    const r = removeConsole(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.output.trim()).toBe("const y = 2;");
  });

  it("handles escaped quotes inside console string arguments", () => {
    const source = 'console.log("say \\"(\\"");\nconst x = 1;';
    const r = removeConsole(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.edits).toBe(1);
    expect(r.output).toBe("const x = 1;");
  });
});

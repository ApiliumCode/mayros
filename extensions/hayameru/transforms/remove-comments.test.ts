import { describe, it, expect } from "vitest";
import { removeComments } from "./remove-comments.js";

describe("removeComments", () => {
  it("removes single-line comments", () => {
    const r = removeComments("const x = 1; // inline\n// full line", "test.ts");
    expect(r.changed).toBe(true);
    expect(r.edits).toBe(2);
    expect(r.output).toBe("const x = 1;");
  });

  it("removes block comments", () => {
    const r = removeComments("/* block */\nconst x = 1;", "test.ts");
    expect(r.changed).toBe(true);
    expect(r.output.trim()).toBe("const x = 1;");
  });

  it("preserves JSDoc comments", () => {
    const source = "/** @param x */\nfunction f(x) {}";
    const r = removeComments(source, "test.ts");
    expect(r.output).toContain("/** @param x */");
  });

  // --- H4 fixes ---

  it("preserves URL in double-quoted string (// is not a comment)", () => {
    const source = 'const url = "http://example.com";';
    const r = removeComments(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe(source);
  });

  it("preserves URL in single-quoted string", () => {
    const source = "const url = 'http://example.com';";
    const r = removeComments(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe(source);
  });

  it("handles escaped single quote inside string", () => {
    const source = "const s = 'it\\'s fine';";
    const r = removeComments(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe(source);
  });

  it("handles escaped double quote inside string", () => {
    const source = 'const s = "say \\"hello\\"";';
    const r = removeComments(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe(source);
  });

  it("preserves template literal with // inside", () => {
    const source = "const s = `http://example.com`;";
    const r = removeComments(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe(source);
  });

  it("preserves template literal with // and removes trailing comment", () => {
    const source = "const s = `http://example.com`; // real comment";
    const r = removeComments(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.output).toBe("const s = `http://example.com`;");
  });

  it("handles string with /* inside (not a block comment)", () => {
    const source = 'const s = "/* not a comment */";';
    const r = removeComments(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe(source);
  });
});

import { describe, it, expect } from "vitest";
import { varToConst } from "./var-to-const.js";

describe("varToConst", () => {
  it("converts var to const", () => {
    const r = varToConst("var x = 1;\nvar y = 'hello';", "test.ts");
    expect(r.changed).toBe(true);
    expect(r.edits).toBe(2);
    expect(r.output).toContain("const x = 1;");
    expect(r.output).toContain("const y = 'hello';");
  });

  it("uses let for reassigned variables", () => {
    const source = "var x = 1;\nx = 2;";
    const r = varToConst(source, "test.ts");
    expect(r.output).toContain("let x = 1;");
  });

  it("leaves const/let unchanged", () => {
    const source = "const x = 1;\nlet y = 2;";
    const r = varToConst(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.edits).toBe(0);
  });

  it("preserves indentation", () => {
    const source = "  var x = 1;";
    const r = varToConst(source, "test.ts");
    expect(r.output).toBe("  const x = 1;");
  });

  // --- H6 fixes ---

  it("detects array destructuring reassignment -> uses let", () => {
    const source = "var a = 1;\nvar b = 2;\n[a, b] = [b, a];";
    const r = varToConst(source, "test.ts");
    expect(r.output).toContain("let a = 1;");
    expect(r.output).toContain("let b = 2;");
  });

  it("detects object destructuring reassignment -> uses let", () => {
    const source = "var x = 0;\nvar y = 0;\n({x, y} = getCoords());";
    const r = varToConst(source, "test.ts");
    expect(r.output).toContain("let x = 0;");
    expect(r.output).toContain("let y = 0;");
  });

  it("non-reassigned vars still become const with destructuring elsewhere", () => {
    const source = "var a = 1;\nvar b = 2;\nvar c = 3;\n[a, b] = [b, a];";
    const r = varToConst(source, "test.ts");
    // a and b are reassigned -> let
    expect(r.output).toContain("let a = 1;");
    expect(r.output).toContain("let b = 2;");
    // c is not reassigned -> const
    expect(r.output).toContain("const c = 3;");
  });

  it("detects object destructuring with renaming", () => {
    const source = "var name = '';\n({label: name} = obj);";
    const r = varToConst(source, "test.ts");
    expect(r.output).toContain("let name = '';");
  });

  it("detects array destructuring with rest", () => {
    const source = "var first = 0;\nvar rest = [];\n[first, ...rest] = arr;";
    const r = varToConst(source, "test.ts");
    expect(r.output).toContain("let first = 0;");
    expect(r.output).toContain("let rest = [];");
  });
});

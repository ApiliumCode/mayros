import { describe, it, expect } from "vitest";
import { addSemicolons } from "./add-semicolons.js";

describe("addSemicolons", () => {
  it("adds semicolons to statements missing them", () => {
    const source = "const x = 1\nconst y = 2";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(true);
    expect(r.edits).toBe(2);
    expect(r.output).toBe("const x = 1;\nconst y = 2;");
  });

  it("does not double-add semicolons", () => {
    const source = "const x = 1;";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
  });

  it("skips lines ending with brackets", () => {
    const source = "if (x) {\n  return 1\n}";
    const r = addSemicolons(source, "test.ts");
    // Only "return 1" gets a semicolon
    expect(r.output).toContain("return 1;");
    expect(r.output).toContain("if (x) {");
  });

  // --- H8 fixes ---

  it("does not add semicolon to object property lines ending with :", () => {
    const source = "const obj = {\n  key:\n    value\n}";
    const r = addSemicolons(source, "test.ts");
    const lines = r.output.split("\n");
    // "  key:" should NOT get a semicolon
    expect(lines[1]).toBe("  key:");
  });

  it("does not add semicolon to standalone return", () => {
    const source = "  return";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe("  return");
  });

  it("does not add semicolon to standalone throw", () => {
    const source = "  throw";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe("  throw");
  });

  it("does not add semicolon to standalone break", () => {
    const source = "    break";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
  });

  it("does not add semicolon to standalone continue", () => {
    const source = "    continue";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
  });

  it("does not add semicolon to standalone yield", () => {
    const source = "    yield";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
  });

  it("does not add semicolon to case label", () => {
    const source = '  case "foo":';
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
    expect(r.output).toBe('  case "foo":');
  });

  it("does not add semicolon to default label", () => {
    const source = "  default:";
    const r = addSemicolons(source, "test.ts");
    expect(r.changed).toBe(false);
  });

  it("does not add semicolon to decorators", () => {
    const source = "@Component\nclass Foo {}";
    const r = addSemicolons(source, "test.ts");
    const lines = r.output.split("\n");
    expect(lines[0]).toBe("@Component");
  });

  it("does not add semicolon to decorator with args", () => {
    const source = "@Injectable()";
    const r = addSemicolons(source, "test.ts");
    // Ends with `)`, the pattern `[{}\[\](,]\s*$` includes `)`
    // Actually `)` is matched by the bracket pattern already
    expect(r.output).toBe("@Injectable()");
  });

  it("does not add semicolon to chained method lines starting with .", () => {
    const source = "promise\n  .then(fn)\n  .catch(err)";
    const r = addSemicolons(source, "test.ts");
    const lines = r.output.split("\n");
    // Lines starting with `.` should be skipped
    expect(lines[1]).toBe("  .then(fn)");
    expect(lines[2]).toBe("  .catch(err)");
  });

  it("still adds semicolons to regular statements", () => {
    const source = "const x = 1\nlet y = 'hello'\nreturn x + y";
    const r = addSemicolons(source, "test.ts");
    expect(r.output).toBe("const x = 1;\nlet y = 'hello';\nreturn x + y;");
  });
});

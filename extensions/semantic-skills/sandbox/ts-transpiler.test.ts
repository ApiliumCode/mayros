import { describe, it, expect } from "vitest";
import { transpileSkillToJS, stripTypeAnnotations } from "./ts-transpiler.js";

describe("transpileSkillToJS", () => {
  it("returns .js source unchanged", async () => {
    const source = "const x = 42;";
    const result = await transpileSkillToJS(source, "skill.js");
    expect(result).toBe(source);
  });

  it("returns .mjs source unchanged", async () => {
    const source = "export default { name: 'test' };";
    const result = await transpileSkillToJS(source, "helper.mjs");
    expect(result).toBe(source);
  });

  it("returns .cjs source unchanged", async () => {
    const source = "module.exports = {};";
    const result = await transpileSkillToJS(source, "lib.cjs");
    expect(result).toBe(source);
  });

  it("transpiles TypeScript to JavaScript via esbuild", async () => {
    const tsSource = `
      import type { SkillRuntime } from "./types.js";
      const runtime: SkillRuntime = {
        name: "test",
        async onQuery(ctx: { results: Array<{ subject: string }> }) {
          return { results: ctx.results };
        },
      };
      export default runtime;
    `;
    const result = await transpileSkillToJS(tsSource, "skill.ts");
    // Should not contain type annotations
    expect(result).not.toContain("SkillRuntime");
    expect(result).not.toContain("import type");
    // Should preserve runtime code
    expect(result).toContain("name:");
    expect(result).toContain('"test"');
    expect(result).toContain("onQuery");
    expect(result).toContain("export default");
  });

  it("preserves export default for skill modules", async () => {
    const tsSource = `
      const runtime = { name: "simple" };
      export default runtime;
    `;
    const result = await transpileSkillToJS(tsSource, "skill.ts");
    expect(result).toContain("export default");
  });
});

describe("stripTypeAnnotations", () => {
  it("removes import type statements", () => {
    const source = `import type { Foo } from "./types.js";\nconst x = 1;`;
    const result = stripTypeAnnotations(source);
    expect(result).not.toContain("import type");
    expect(result).toContain("const x = 1;");
  });

  it("removes as Type casts", () => {
    const source = `const x = obj as Record<string, unknown>;`;
    const result = stripTypeAnnotations(source);
    expect(result).not.toContain("as Record");
  });

  it("preserves non-type code", () => {
    const source = `const x = { name: "test", value: 42 };`;
    const result = stripTypeAnnotations(source);
    expect(result).toContain('name: "test"');
    expect(result).toContain("value: 42");
  });
});

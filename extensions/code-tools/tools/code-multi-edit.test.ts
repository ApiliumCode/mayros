import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

vi.mock("../../../src/agents/tools/common.js", () => ({
  ToolInputError: class ToolInputError extends Error {
    constructor(msg: string) {
      super(msg);
      this.name = "ToolInputError";
    }
  },
}));

describe("code_multi_edit", () => {
  let executeFn: (
    id: string,
    params: Record<string, unknown>,
  ) => Promise<{
    content: Array<{ type: string; text: string }>;
    details: Record<string, unknown>;
  }>;
  let workspace: string;

  beforeEach(async () => {
    workspace = mkdtempSync(join(tmpdir(), "multi-edit-test-"));
    vi.resetModules();
    const mockApi = {
      registerTool: vi.fn((toolDef: { execute: typeof executeFn }) => {
        executeFn = toolDef.execute;
      }),
      logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    };
    const cfg = { workspaceRoot: workspace, shellEnabled: true, shellTimeout: 120000 };
    const { registerCodeMultiEdit } = await import("./code-multi-edit.js");
    registerCodeMultiEdit(mockApi as never, cfg as never);
  });

  afterEach(() => {
    try {
      rmSync(workspace, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("rejects empty edits array", async () => {
    await expect(executeFn("t1", { edits: [] })).rejects.toThrow("edits array required");
    await expect(executeFn("t2", {})).rejects.toThrow("edits array required");
  });

  it("applies a single edit", async () => {
    writeFileSync(join(workspace, "a.ts"), "const x = 1;\nconst y = 2;\n");
    const result = await executeFn("t3", {
      edits: [{ path: "a.ts", old_string: "const x = 1;", new_string: "const x = 42;" }],
    });
    expect(result.details.totalReplacements).toBe(1);
    expect(readFileSync(join(workspace, "a.ts"), "utf-8")).toContain("const x = 42;");
  });

  it("applies multiple edits across files", async () => {
    writeFileSync(join(workspace, "a.ts"), "hello world");
    writeFileSync(join(workspace, "b.ts"), "foo bar");
    const result = await executeFn("t4", {
      edits: [
        { path: "a.ts", old_string: "hello", new_string: "goodbye" },
        { path: "b.ts", old_string: "foo", new_string: "baz" },
      ],
    });
    expect(result.details.totalFiles).toBe(2);
    expect(result.details.totalReplacements).toBe(2);
    expect(readFileSync(join(workspace, "a.ts"), "utf-8")).toBe("goodbye world");
    expect(readFileSync(join(workspace, "b.ts"), "utf-8")).toBe("baz bar");
  });

  it("is atomic — no changes on validation failure", async () => {
    writeFileSync(join(workspace, "a.ts"), "hello world");
    const result = await executeFn("t5", {
      edits: [
        { path: "a.ts", old_string: "hello", new_string: "goodbye" },
        { path: "a.ts", old_string: "NONEXISTENT", new_string: "fail" },
      ],
    });
    expect(result.content[0].text).toContain("Validation failed");
    // File should be unchanged
    expect(readFileSync(join(workspace, "a.ts"), "utf-8")).toBe("hello world");
  });

  it("rejects non-unique old_string without replace_all", async () => {
    writeFileSync(join(workspace, "a.ts"), "aaa bbb aaa");
    const result = await executeFn("t6", {
      edits: [{ path: "a.ts", old_string: "aaa", new_string: "ccc" }],
    });
    expect(result.content[0].text).toContain("not unique");
  });

  it("handles replace_all correctly", async () => {
    writeFileSync(join(workspace, "a.ts"), "aaa bbb aaa");
    const result = await executeFn("t7", {
      edits: [{ path: "a.ts", old_string: "aaa", new_string: "ccc", replace_all: true }],
    });
    expect(result.details.totalReplacements).toBe(2);
    expect(readFileSync(join(workspace, "a.ts"), "utf-8")).toBe("ccc bbb ccc");
  });

  it("rejects path outside workspace", async () => {
    const result = await executeFn("t8", {
      edits: [{ path: "../../etc/passwd", old_string: "root", new_string: "hacked" }],
    });
    expect(result.content[0].text).toContain("path outside workspace");
  });

  it("rejects identical old_string and new_string", async () => {
    writeFileSync(join(workspace, "a.ts"), "hello");
    const result = await executeFn("t9", {
      edits: [{ path: "a.ts", old_string: "hello", new_string: "hello" }],
    });
    expect(result.content[0].text).toContain("identical");
  });

  it("rejects missing file", async () => {
    const result = await executeFn("t10", {
      edits: [{ path: "nonexistent.ts", old_string: "a", new_string: "b" }],
    });
    expect(result.content[0].text).toContain("cannot read file");
  });

  it("handles multiple edits in the same file", async () => {
    writeFileSync(join(workspace, "a.ts"), "const a = 1;\nconst b = 2;\nconst c = 3;\n");
    const result = await executeFn("t11", {
      edits: [
        { path: "a.ts", old_string: "const a = 1;", new_string: "const a = 10;" },
        { path: "a.ts", old_string: "const b = 2;", new_string: "const b = 20;" },
      ],
    });
    expect(result.details.totalReplacements).toBe(2);
    const content = readFileSync(join(workspace, "a.ts"), "utf-8");
    expect(content).toContain("const a = 10;");
    expect(content).toContain("const b = 20;");
    expect(content).toContain("const c = 3;");
  });

  it("rejects more than 50 edits", async () => {
    const edits = Array.from({ length: 51 }, (_, i) => ({
      path: "a.ts",
      old_string: `old${i}`,
      new_string: `new${i}`,
    }));
    await expect(executeFn("t12", { edits })).rejects.toThrow("Maximum 50 edits");
  });

  it("shows diff snippets in results", async () => {
    writeFileSync(join(workspace, "a.ts"), "const old = true;");
    const result = await executeFn("t13", {
      edits: [
        { path: "a.ts", old_string: "const old = true;", new_string: "const updated = false;" },
      ],
    });
    const text = result.content[0].text;
    expect(text).toContain("- const old = true;");
    expect(text).toContain("+ const updated = false;");
  });

  it("handles subdirectory paths", async () => {
    mkdirSync(join(workspace, "src"), { recursive: true });
    writeFileSync(join(workspace, "src/main.ts"), "export default 1;");
    const result = await executeFn("t14", {
      edits: [
        { path: "src/main.ts", old_string: "export default 1;", new_string: "export default 2;" },
      ],
    });
    expect(result.details.totalReplacements).toBe(1);
    expect(readFileSync(join(workspace, "src/main.ts"), "utf-8")).toBe("export default 2;");
  });
});

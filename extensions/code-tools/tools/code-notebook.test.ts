import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

const SAMPLE_NOTEBOOK = {
  cells: [
    {
      cell_type: "markdown",
      source: ["# Hello Notebook\n", "This is a test."],
      metadata: {},
    },
    {
      cell_type: "code",
      source: ["print('hello')\n"],
      outputs: [{ output_type: "stream", name: "stdout", text: ["hello\n"] }],
      execution_count: 1,
      metadata: {},
    },
    {
      cell_type: "code",
      source: ["1 + 1"],
      outputs: [
        {
          output_type: "execute_result",
          data: { "text/plain": ["2"] },
          metadata: {},
          execution_count: 2,
        },
      ],
      execution_count: 2,
      metadata: {},
    },
  ],
  metadata: {
    kernelspec: { display_name: "Python 3", language: "python", name: "python3" },
  },
  nbformat: 4,
  nbformat_minor: 5,
};

describe("code_notebook", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "notebook-test-"));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  describe("reading", () => {
    it("parses notebook structure", async () => {
      const nbPath = path.join(tmpDir, "test.ipynb");
      await fs.writeFile(nbPath, JSON.stringify(SAMPLE_NOTEBOOK));
      const content = await fs.readFile(nbPath, "utf-8");
      const nb = JSON.parse(content);
      expect(nb.cells).toHaveLength(3);
      expect(nb.cells[0].cell_type).toBe("markdown");
    });

    it("formats code cell with output", () => {
      const cell = SAMPLE_NOTEBOOK.cells[1];
      const source = cell.source.join("");
      expect(source).toContain("print");
      const output = (cell.outputs![0] as { text: string[] }).text.join("");
      expect(output).toContain("hello");
    });

    it("formats execute_result output", () => {
      const cell = SAMPLE_NOTEBOOK.cells[2];
      const data = (cell.outputs![0] as { data: Record<string, string[]> }).data;
      expect(data["text/plain"][0]).toBe("2");
    });

    it("reads specific cell by index", () => {
      const cell = SAMPLE_NOTEBOOK.cells[0];
      expect(cell.cell_type).toBe("markdown");
      expect(cell.source.join("")).toContain("Hello Notebook");
    });
  });

  describe("editing", () => {
    it("replaces cell source", async () => {
      const nbPath = path.join(tmpDir, "edit.ipynb");
      await fs.writeFile(nbPath, JSON.stringify(SAMPLE_NOTEBOOK));
      const raw = await fs.readFile(nbPath, "utf-8");
      const nb = JSON.parse(raw);
      nb.cells[1].source = ["print('updated')\n"];
      nb.cells[1].outputs = [];
      nb.cells[1].execution_count = null;
      await fs.writeFile(nbPath, JSON.stringify(nb, null, 1));
      const updated = JSON.parse(await fs.readFile(nbPath, "utf-8"));
      expect(updated.cells[1].source[0]).toContain("updated");
    });

    it("inserts a new cell", async () => {
      const nbPath = path.join(tmpDir, "insert.ipynb");
      await fs.writeFile(nbPath, JSON.stringify(SAMPLE_NOTEBOOK));
      const raw = await fs.readFile(nbPath, "utf-8");
      const nb = JSON.parse(raw);
      const newCell = {
        cell_type: "code",
        source: ["x = 42\n"],
        outputs: [],
        execution_count: null,
        metadata: {},
      };
      nb.cells.splice(1, 0, newCell);
      await fs.writeFile(nbPath, JSON.stringify(nb, null, 1));
      const updated = JSON.parse(await fs.readFile(nbPath, "utf-8"));
      expect(updated.cells).toHaveLength(4);
      expect(updated.cells[1].source[0]).toContain("42");
    });

    it("deletes a cell", async () => {
      const nbPath = path.join(tmpDir, "delete.ipynb");
      await fs.writeFile(nbPath, JSON.stringify(SAMPLE_NOTEBOOK));
      const raw = await fs.readFile(nbPath, "utf-8");
      const nb = JSON.parse(raw);
      nb.cells.splice(0, 1); // Remove first cell
      await fs.writeFile(nbPath, JSON.stringify(nb, null, 1));
      const updated = JSON.parse(await fs.readFile(nbPath, "utf-8"));
      expect(updated.cells).toHaveLength(2);
      expect(updated.cells[0].cell_type).toBe("code");
    });
  });
});

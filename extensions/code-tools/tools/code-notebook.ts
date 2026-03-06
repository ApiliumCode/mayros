/**
 * Jupyter Notebook Tools
 *
 * Reads and edits .ipynb files at the cell level.
 */

import fs from "node:fs/promises";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError, jsonResult } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath } from "../path-utils.js";

type NotebookCell = {
  cell_type: "code" | "markdown" | "raw";
  source: string[];
  outputs?: unknown[];
  metadata?: Record<string, unknown>;
  execution_count?: number | null;
  id?: string;
};

type NotebookJson = {
  cells: NotebookCell[];
  metadata?: Record<string, unknown>;
  nbformat: number;
  nbformat_minor: number;
};

function parseNotebook(raw: string): NotebookJson {
  let parsed: NotebookJson;
  try {
    parsed = JSON.parse(raw) as NotebookJson;
  } catch (err) {
    throw new ToolInputError(
      `Invalid notebook JSON: ${err instanceof SyntaxError ? err.message : "parse error"}`,
    );
  }
  if (!parsed.cells || !Array.isArray(parsed.cells)) {
    throw new ToolInputError("Invalid notebook: missing cells array");
  }
  if (typeof parsed.nbformat !== "number") {
    throw new ToolInputError("Invalid notebook: missing nbformat");
  }
  return parsed;
}

function formatCell(cell: NotebookCell, index: number): string {
  const source = Array.isArray(cell.source) ? cell.source.join("") : String(cell.source);
  const header = `[${index}] ${cell.cell_type}`;

  const parts = [header, source];

  // Include text outputs for code cells
  if (cell.cell_type === "code" && cell.outputs && Array.isArray(cell.outputs)) {
    for (const output of cell.outputs) {
      const out = output as Record<string, unknown>;
      if (out.output_type === "stream" && out.text) {
        const text = Array.isArray(out.text) ? out.text.join("") : String(out.text);
        parts.push(`[output] ${text}`);
      } else if (out.output_type === "execute_result" && out.data) {
        const data = out.data as Record<string, unknown>;
        if (data["text/plain"]) {
          const text = Array.isArray(data["text/plain"])
            ? (data["text/plain"] as string[]).join("")
            : String(data["text/plain"]);
          parts.push(`[result] ${text}`);
        }
      } else if (out.output_type === "error") {
        const ename = String(out.ename ?? "Error");
        const evalue = String(out.evalue ?? "");
        parts.push(`[error] ${ename}: ${evalue}`);
      }
    }
  }

  return parts.join("\n");
}

export function registerCodeNotebook(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  // code_notebook_read
  api.registerTool(
    {
      name: "code_notebook_read",
      label: "Read Notebook",
      description:
        "Read a Jupyter notebook (.ipynb) file. Returns all cells with their outputs, combining code, text, and visualizations.",
      parameters: Type.Object({
        path: Type.String({ description: "Path to .ipynb file" }),
        cell: Type.Optional(
          Type.Number({ description: "Specific cell number to read (0-indexed)" }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as { path?: string; cell?: number };
        if (typeof p.path !== "string" || !p.path.trim()) {
          throw new ToolInputError("path required");
        }

        const filePath = resolveSafePath(p.path.trim(), cfg.workspaceRoot);

        let raw: string;
        try {
          raw = await fs.readFile(filePath, "utf-8");
        } catch {
          throw new ToolInputError(`File not found: ${p.path}`);
        }

        const notebook = parseNotebook(raw);
        const cells = notebook.cells;

        if (typeof p.cell === "number") {
          const idx = Math.trunc(p.cell);
          if (idx < 0 || idx >= cells.length) {
            throw new ToolInputError(
              `Cell ${idx} out of range (notebook has ${cells.length} cells, 0-${cells.length - 1})`,
            );
          }
          return {
            content: [{ type: "text" as const, text: formatCell(cells[idx], idx) }],
            details: {
              path: p.path.trim(),
              cellIndex: idx,
              cellType: cells[idx].cell_type,
              totalCells: cells.length,
            },
          };
        }

        // Return all cells
        const formatted = cells.map((cell, i) => formatCell(cell, i));
        const text = formatted.join("\n\n---\n\n");

        return {
          content: [{ type: "text" as const, text }],
          details: {
            path: p.path.trim(),
            totalCells: cells.length,
            cellTypes: {
              code: cells.filter((c) => c.cell_type === "code").length,
              markdown: cells.filter((c) => c.cell_type === "markdown").length,
              raw: cells.filter((c) => c.cell_type === "raw").length,
            },
          },
        };
      },
    },
    { name: "code_notebook_read" },
  );

  // code_notebook_edit
  api.registerTool(
    {
      name: "code_notebook_edit",
      label: "Edit Notebook",
      description:
        "Edit a Jupyter notebook at the cell level. Can replace, insert, or delete cells.",
      parameters: Type.Object({
        path: Type.String({ description: "Path to .ipynb file" }),
        cell: Type.Number({ description: "Cell number (0-indexed)" }),
        action: Type.Optional(
          Type.String({
            description: 'Action: "replace" (default), "insert", or "delete"',
          }),
        ),
        source: Type.Optional(Type.String({ description: "New cell source content" })),
        cell_type: Type.Optional(
          Type.String({ description: 'Cell type: "code", "markdown", or "raw"' }),
        ),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          path?: string;
          cell?: number;
          action?: string;
          source?: string;
          cell_type?: string;
        };
        if (typeof p.path !== "string" || !p.path.trim()) {
          throw new ToolInputError("path required");
        }
        if (typeof p.cell !== "number") {
          throw new ToolInputError("cell number required");
        }

        const filePath = resolveSafePath(p.path.trim(), cfg.workspaceRoot);
        const action = p.action ?? "replace";
        const cellIdx = Math.trunc(p.cell);

        let raw: string;
        try {
          raw = await fs.readFile(filePath, "utf-8");
        } catch {
          throw new ToolInputError(`File not found: ${p.path}`);
        }

        const notebook = parseNotebook(raw);

        if (action === "delete") {
          if (cellIdx < 0 || cellIdx >= notebook.cells.length) {
            throw new ToolInputError(`Cell ${cellIdx} out of range`);
          }
          notebook.cells.splice(cellIdx, 1);
        } else if (action === "insert") {
          if (typeof p.source !== "string") {
            throw new ToolInputError("source required for insert");
          }
          const cellType = (p.cell_type as "code" | "markdown" | "raw") ?? "code";
          const newCell: NotebookCell = {
            cell_type: cellType,
            source: p.source.split("\n").map((l, i, arr) => (i < arr.length - 1 ? l + "\n" : l)),
            metadata: {},
            ...(cellType === "code" ? { outputs: [], execution_count: null } : {}),
          };
          const insertIdx = Math.min(cellIdx, notebook.cells.length);
          notebook.cells.splice(insertIdx, 0, newCell);
        } else {
          // replace
          if (cellIdx < 0 || cellIdx >= notebook.cells.length) {
            throw new ToolInputError(`Cell ${cellIdx} out of range`);
          }
          if (typeof p.source !== "string") {
            throw new ToolInputError("source required for replace");
          }
          const cell = notebook.cells[cellIdx];
          cell.source = p.source
            .split("\n")
            .map((l, i, arr) => (i < arr.length - 1 ? l + "\n" : l));
          if (p.cell_type) {
            cell.cell_type = p.cell_type as "code" | "markdown" | "raw";
          }
          // Clear outputs on code cell modification
          if (cell.cell_type === "code") {
            cell.outputs = [];
            cell.execution_count = null;
          }
        }

        await fs.writeFile(filePath, JSON.stringify(notebook, null, 1) + "\n", "utf-8");

        return jsonResult({
          path: p.path.trim(),
          action,
          cell: cellIdx,
          totalCells: notebook.cells.length,
        });
      },
    },
    { name: "code_notebook_edit" },
  );
}

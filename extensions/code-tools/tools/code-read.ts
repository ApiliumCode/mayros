/**
 * code_read tool — Read a file from the local filesystem.
 *
 * Returns text content with line numbers, or image content for image files.
 * Binary files are detected and reported without attempting text conversion.
 */

import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError, imageResultFromFile } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath, isImageFile, isBinaryBuffer } from "../path-utils.js";

const PDF_EXTENSIONS = new Set([".pdf"]);

function isPdfFile(filePath: string): boolean {
  return PDF_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

/**
 * Basic PDF text extraction using pdf-parse if available,
 * otherwise return metadata only.
 */
async function readPdfFile(
  filePath: string,
  pages?: string,
): Promise<{ text: string; pages: number }> {
  try {
    // Try dynamic import of pdf-parse (optional dependency)
    const pdfParse = await import("pdf-parse");
    const buffer = await fs.readFile(filePath);
    const data = await pdfParse.default(buffer);

    let text = data.text;
    const totalPages = data.numpages;

    // If pages parameter provided, try to extract just those pages
    // pdf-parse doesn't support page ranges natively, so we do best-effort truncation
    if (pages && totalPages > 0) {
      const { start, end } = parsePageRange(pages, totalPages);
      // Rough page-based truncation (divide text by page count)
      const avgCharsPerPage = Math.ceil(text.length / totalPages);
      text = text.slice((start - 1) * avgCharsPerPage, end * avgCharsPerPage);
    }

    return { text, pages: totalPages };
  } catch {
    // pdf-parse not available — return basic info
    const stat = await fs.stat(filePath);
    return {
      text: `[PDF file: ${stat.size} bytes. Install 'pdf-parse' for text extraction]`,
      pages: 0,
    };
  }
}

function parsePageRange(range: string, totalPages: number): { start: number; end: number } {
  const match = range.match(/^(\d+)(?:-(\d+))?$/);
  if (!match) return { start: 1, end: totalPages };
  const start = Math.max(1, parseInt(match[1], 10));
  const end = match[2] ? Math.min(totalPages, parseInt(match[2], 10)) : start;
  return { start, end };
}

export function registerCodeRead(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_read",
      label: "Read File",
      description:
        "Read a file from the local filesystem. Returns text content with line numbers, or image content for image files.",
      parameters: Type.Object({
        path: Type.String({ description: "File path (absolute or relative to workspace)" }),
        offset: Type.Optional(Type.Number({ description: "Starting line number (1-based)" })),
        limit: Type.Optional(Type.Number({ description: "Maximum number of lines to read" })),
        pages: Type.Optional(Type.String({ description: "Page range for PDF files (e.g. '1-5')" })),
      }),
      async execute(_toolCallId, params) {
        const rawPath = (params as Record<string, unknown>).path;
        if (typeof rawPath !== "string" || !rawPath.trim()) {
          throw new ToolInputError("path required");
        }
        const filePath = resolveSafePath(rawPath.trim(), cfg.workspaceRoot);

        // Check file exists and size
        let stat;
        try {
          stat = await fs.stat(filePath);
        } catch {
          throw new ToolInputError(`File not found: ${rawPath}`);
        }

        if (stat.isDirectory()) {
          throw new ToolInputError(`Path is a directory, not a file: ${rawPath}`);
        }

        if (stat.size > cfg.maxFileSizeBytes) {
          throw new ToolInputError(
            `File too large: ${stat.size} bytes (max ${cfg.maxFileSizeBytes})`,
          );
        }

        // PDF files
        if (isPdfFile(filePath)) {
          const pagesParam =
            typeof (params as Record<string, unknown>).pages === "string"
              ? ((params as Record<string, unknown>).pages as string).trim()
              : undefined;
          const pdf = await readPdfFile(filePath, pagesParam);
          return {
            content: [{ type: "text" as const, text: pdf.text }],
            details: {
              path: rawPath,
              format: "pdf",
              pages: pdf.pages,
            },
          };
        }

        // Image files
        if (isImageFile(filePath)) {
          return await imageResultFromFile({
            label: "code_read",
            path: filePath,
            extraText: `Image file: ${rawPath} (${stat.size} bytes)`,
          });
        }

        // Read file
        const buffer = await fs.readFile(filePath);

        // Binary detection
        if (isBinaryBuffer(buffer)) {
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    path: rawPath,
                    binary: true,
                    size: stat.size,
                    message: `[binary file, ${stat.size} bytes]`,
                  },
                  null,
                  2,
                ),
              },
            ],
            details: {
              path: rawPath,
              binary: true,
              size: stat.size,
            },
          };
        }

        // Text: apply offset/limit and add line numbers
        const text = buffer.toString("utf-8");
        const allLines = text.split("\n");
        const offset =
          typeof (params as Record<string, unknown>).offset === "number"
            ? Math.max(1, Math.trunc((params as Record<string, unknown>).offset as number))
            : 1;
        const limit =
          typeof (params as Record<string, unknown>).limit === "number"
            ? Math.max(1, Math.trunc((params as Record<string, unknown>).limit as number))
            : allLines.length;

        const startIdx = offset - 1;
        const slice = allLines.slice(startIdx, startIdx + limit);
        const maxLineNo = startIdx + slice.length;
        const padWidth = String(maxLineNo).length;

        const numbered = slice.map((line, i) => {
          const lineNo = String(startIdx + i + 1).padStart(padWidth, " ");
          return `${lineNo}\t${line}`;
        });

        const resultText = numbered.join("\n");
        const truncated = slice.length < allLines.length;

        return {
          content: [{ type: "text" as const, text: resultText }],
          details: {
            path: rawPath,
            totalLines: allLines.length,
            linesShown: slice.length,
            offset,
            truncated,
          },
        };
      },
    },
    { name: "code_read" },
  );
}

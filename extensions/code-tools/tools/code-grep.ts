import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs/promises";
import path from "node:path";
import { Type } from "@sinclair/typebox";
import type { MayrosPluginApi } from "mayros/plugin-sdk";
import { ToolInputError } from "../../../src/agents/tools/common.js";
import type { CodeToolsConfig } from "../config.js";
import { resolveSafePath, isPathInside } from "../path-utils.js";

const execFileAsync = promisify(execFile);

type GrepMatch = {
  file: string;
  line: number;
  content: string;
};

/**
 * Try ripgrep first, fall back to built-in recursive grep.
 */
async function grepWithRg(
  pattern: string,
  searchPath: string,
  glob: string | undefined,
  contextLines: number,
  maxResults: number,
): Promise<{ matches: GrepMatch[]; usedRg: boolean }> {
  try {
    const args = [
      "--no-heading",
      "--line-number",
      "--color=never",
      "--max-count",
      String(maxResults),
    ];
    if (contextLines > 0) {
      args.push("-C", String(contextLines));
    }
    if (glob) {
      args.push("--glob", glob);
    }
    args.push("--", pattern, searchPath);

    const { stdout } = await execFileAsync("rg", args, {
      timeout: 30_000,
      maxBuffer: 10 * 1024 * 1024,
    });

    const matches: GrepMatch[] = [];
    for (const line of stdout.split("\n")) {
      if (!line.trim()) continue;
      // Format: file:line:content or file-line-content (context)
      const match = line.match(/^(.+?)[:-](\d+)[:-](.*)$/);
      if (match) {
        matches.push({
          file: path.relative(searchPath, match[1]),
          line: parseInt(match[2], 10),
          content: match[3],
        });
      }
    }

    return { matches: matches.slice(0, maxResults), usedRg: true };
  } catch (err) {
    // rg not found or failed — return empty to trigger fallback
    const error = err as { code?: string };
    if (error.code === "ENOENT") {
      return { matches: [], usedRg: false };
    }
    // rg found but no matches (exit code 1) or other error
    if ((err as { status?: number }).status === 1) {
      return { matches: [], usedRg: true };
    }
    return { matches: [], usedRg: false };
  }
}

/**
 * Built-in fallback grep using fs.readdir recursion.
 */
async function grepBuiltin(
  pattern: string,
  searchPath: string,
  glob: string | undefined,
  maxResults: number,
): Promise<GrepMatch[]> {
  const regex = new RegExp(pattern, "i");
  const matches: GrepMatch[] = [];
  const globRegex = glob ? new RegExp(glob.replace(/\*/g, ".*").replace(/\?/g, ".")) : undefined;

  async function walk(dir: string): Promise<void> {
    if (matches.length >= maxResults) return;

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (matches.length >= maxResults) return;
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        if (entry.name === "node_modules" || entry.name === ".git") continue;
        await walk(fullPath);
      } else if (entry.isFile()) {
        const relPath = path.relative(searchPath, fullPath);
        if (globRegex && !globRegex.test(relPath)) continue;

        try {
          const content = await fs.readFile(fullPath, "utf-8");
          const lines = content.split("\n");
          for (let i = 0; i < lines.length && matches.length < maxResults; i++) {
            if (regex.test(lines[i])) {
              matches.push({
                file: relPath,
                line: i + 1,
                content: lines[i],
              });
            }
          }
        } catch {
          // Skip unreadable files
        }
      }
    }
  }

  await walk(searchPath);
  return matches;
}

export { grepBuiltin };

export function registerCodeGrep(api: MayrosPluginApi, cfg: CodeToolsConfig): void {
  api.registerTool(
    {
      name: "code_grep",
      label: "Search Code",
      description:
        "Search file contents using regex patterns. Uses ripgrep if available, otherwise falls back to built-in search. Respects .gitignore.",
      parameters: Type.Object({
        pattern: Type.String({ description: "Regex pattern to search for" }),
        path: Type.Optional(
          Type.String({ description: "Directory to search in (defaults to workspace root)" }),
        ),
        glob: Type.Optional(
          Type.String({ description: 'File glob filter (e.g. "*.ts", "*.{ts,tsx}")' }),
        ),
        context: Type.Optional(
          Type.Number({ description: "Lines of context around matches (default: 0)" }),
        ),
        max_results: Type.Optional(Type.Number({ description: "Maximum results (default: 50)" })),
      }),
      async execute(_toolCallId, params) {
        const p = params as {
          pattern?: string;
          path?: string;
          glob?: string;
          context?: number;
          max_results?: number;
        };
        if (typeof p.pattern !== "string" || !p.pattern.trim()) {
          throw new ToolInputError("pattern required");
        }

        const searchPath = p.path?.trim()
          ? resolveSafePath(p.path.trim(), cfg.workspaceRoot)
          : cfg.workspaceRoot;

        if (!isPathInside(searchPath, cfg.workspaceRoot) && searchPath !== cfg.workspaceRoot) {
          throw new ToolInputError("path is outside workspace root");
        }

        const contextLines = typeof p.context === "number" ? Math.max(0, Math.trunc(p.context)) : 0;
        const maxResults =
          typeof p.max_results === "number"
            ? Math.max(1, Math.min(Math.trunc(p.max_results), cfg.maxGrepResults))
            : cfg.maxGrepResults;

        // Try ripgrep first
        let { matches, usedRg } = await grepWithRg(
          p.pattern.trim(),
          searchPath,
          p.glob,
          contextLines,
          maxResults,
        );

        // Fallback to built-in if rg not available
        if (!usedRg && matches.length === 0) {
          matches = await grepBuiltin(p.pattern.trim(), searchPath, p.glob, maxResults);
        }

        if (matches.length === 0) {
          return {
            content: [{ type: "text" as const, text: "No matches found." }],
            details: {
              pattern: p.pattern.trim(),
              matches: 0,
              engine: usedRg ? "ripgrep" : "builtin",
            },
          };
        }

        const lines = matches.map((m) => `${m.file}:${m.line}: ${m.content}`);

        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details: {
            pattern: p.pattern.trim(),
            matches: matches.length,
            engine: usedRg ? "ripgrep" : "builtin",
          },
        };
      },
    },
    { name: "code_grep" },
  );
}

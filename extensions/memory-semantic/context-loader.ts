/**
 * Context Loader
 *
 * Loads project instructions from `.mayros/context.md` (global + project)
 * and `MAYROS.md` at project root. Indexes content into Cortex as triples
 * and returns formatted text for prompt injection.
 */

import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { findGitRoot } from "../../src/infra/git-root.js";

export type ContextSource = {
  path: string;
  content: string;
  scope: "global" | "project";
};

export type LoadedContext = {
  sources: ContextSource[];
  combinedText: string;
};

/**
 * Load context files from standard locations.
 *
 * Search order:
 * 1. ~/.mayros/context.md (global)
 * 2. <project-root>/.mayros/context.md (project)
 * 3. <project-root>/MAYROS.md (fallback)
 */
export async function loadContextFiles(cwd?: string): Promise<LoadedContext> {
  const sources: ContextSource[] = [];
  const workDir = cwd ?? process.cwd();

  // 1. Global context
  const globalPath = join(homedir(), ".mayros", "context.md");
  const globalContent = await safeReadFile(globalPath);
  if (globalContent) {
    sources.push({ path: globalPath, content: globalContent, scope: "global" });
  }

  // 2. Project context
  const projectRoot = findGitRoot(workDir) ?? workDir;

  const projectContextPath = join(projectRoot, ".mayros", "context.md");
  const projectContent = await safeReadFile(projectContextPath);
  if (projectContent) {
    sources.push({ path: projectContextPath, content: projectContent, scope: "project" });
  }

  // 3. MAYROS.md fallback (only if no project context.md found)
  if (!projectContent) {
    const mayrosMdPath = join(projectRoot, "MAYROS.md");
    const mayrosContent = await safeReadFile(mayrosMdPath);
    if (mayrosContent) {
      sources.push({ path: mayrosMdPath, content: mayrosContent, scope: "project" });
    }
  }

  const combinedText = sources.map((s) => s.content).join("\n\n---\n\n");

  return { sources, combinedText };
}

/**
 * Format loaded context for prompt injection.
 */
export function formatContextForPrompt(ctx: LoadedContext): string {
  if (ctx.sources.length === 0) return "";

  const parts: string[] = [];
  for (const source of ctx.sources) {
    const label = source.scope === "global" ? "Global Instructions" : "Project Instructions";
    parts.push(`[${label}: ${source.path}]\n${source.content}`);
  }

  return `<project-instructions>\n${parts.join("\n\n")}\n</project-instructions>`;
}

/**
 * Generate Cortex triples for context indexing.
 */
export function contextToTriples(
  ns: string,
  ctx: LoadedContext,
): Array<{ subject: string; predicate: string; object: string }> {
  const triples: Array<{ subject: string; predicate: string; object: string }> = [];

  for (const source of ctx.sources) {
    const subject = `${ns}:context:${source.scope}`;
    triples.push(
      { subject, predicate: `${ns}:context:path`, object: source.path },
      { subject, predicate: `${ns}:context:content`, object: source.content.slice(0, 4096) },
      { subject, predicate: `${ns}:context:scope`, object: source.scope },
      { subject, predicate: `${ns}:context:loadedAt`, object: new Date().toISOString() },
    );
  }

  return triples;
}

async function safeReadFile(filePath: string): Promise<string | null> {
  try {
    const content = await readFile(filePath, "utf-8");
    return content.trim() || null;
  } catch {
    return null;
  }
}

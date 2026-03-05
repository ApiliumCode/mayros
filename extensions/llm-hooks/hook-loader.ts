/**
 * LLM Hook Loader
 *
 * Discovers and parses markdown hook definitions from project and user
 * directories. Each .md file defines a hook with frontmatter metadata
 * and a body containing the LLM evaluation prompt.
 */

import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { CacheScope } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type PluginHookName =
  | "before_tool_call"
  | "before_prompt_build"
  | "message_sending"
  | "before_agent_start"
  | "after_tool_call"
  | "session_start"
  | "session_end";

export type LlmHookDefinition = {
  name: string;
  description: string;
  events: string[];
  condition?: string;
  model?: string;
  timeoutMs: number;
  cache: CacheScope;
  priority: number;
  enabled: boolean;
  body: string;
  sourcePath: string;
  origin: "project" | "user";
};

const VALID_EVENTS = new Set<string>([
  "before_tool_call",
  "before_prompt_build",
  "message_sending",
  "before_agent_start",
  "after_tool_call",
  "session_start",
  "session_end",
]);

const VALID_CACHE_SCOPES = new Set<string>(["none", "session", "global"]);

const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CACHE: CacheScope = "session";
const DEFAULT_PRIORITY = 100;

// ============================================================================
// Frontmatter Parsing
// ============================================================================

function parseFrontmatterValue(raw: string): string {
  const trimmed = raw.trim();
  // Strip surrounding quotes
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseFrontmatter(content: string): { meta: Record<string, string>; body: string } {
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  if (!normalized.startsWith("---")) {
    return { meta: {}, body: normalized.trim() };
  }

  const endIndex = normalized.indexOf("\n---", 3);
  if (endIndex === -1) {
    return { meta: {}, body: normalized.trim() };
  }

  const frontmatterBlock = normalized.slice(4, endIndex);
  const bodyContent = normalized.slice(endIndex + 4).trim();

  const meta: Record<string, string> = {};
  const lines = frontmatterBlock.split("\n");

  for (const line of lines) {
    const match = line.match(/^([\w-]+):\s*(.*)$/);
    if (!match) continue;

    const key = match[1];
    const value = parseFrontmatterValue(match[2]);
    if (key && value) {
      meta[key] = value;
    }
  }

  return { meta, body: bodyContent };
}

// ============================================================================
// Hook Parsing
// ============================================================================

export function parseHookMarkdown(
  content: string,
  sourcePath: string,
  origin: "project" | "user",
): LlmHookDefinition {
  const { meta, body } = parseFrontmatter(content);

  // Required: name
  const name = meta.name;
  if (!name) {
    throw new Error(`Hook file ${sourcePath} is missing required field: name`);
  }

  // Required: events
  const eventsRaw = meta.events;
  if (!eventsRaw) {
    throw new Error(`Hook file ${sourcePath} is missing required field: events`);
  }

  // Parse events — comma-separated or single value
  const events = eventsRaw
    .split(",")
    .map((e) => e.trim())
    .filter((e) => e.length > 0);

  if (events.length === 0) {
    throw new Error(`Hook file ${sourcePath} has empty events list`);
  }

  // Validate event names
  for (const event of events) {
    if (!VALID_EVENTS.has(event)) {
      throw new Error(`Hook file ${sourcePath} has invalid event: ${event}`);
    }
  }

  // Optional fields with defaults
  const description = meta.description ?? "";

  const condition = meta.condition ?? undefined;

  const model = meta.model ?? undefined;

  const timeoutMs = meta.timeout !== undefined ? parseInt(meta.timeout, 10) : DEFAULT_TIMEOUT_MS;
  if (Number.isNaN(timeoutMs) || timeoutMs < 100) {
    throw new Error(`Hook file ${sourcePath} has invalid timeout: ${meta.timeout}`);
  }

  const cacheRaw = meta.cache ?? DEFAULT_CACHE;
  if (!VALID_CACHE_SCOPES.has(cacheRaw)) {
    throw new Error(`Hook file ${sourcePath} has invalid cache scope: ${cacheRaw}`);
  }
  const cache = cacheRaw as CacheScope;

  const priority = meta.priority !== undefined ? parseInt(meta.priority, 10) : DEFAULT_PRIORITY;
  if (Number.isNaN(priority)) {
    throw new Error(`Hook file ${sourcePath} has invalid priority: ${meta.priority}`);
  }

  const enabledRaw = meta.enabled;
  const enabled = enabledRaw === undefined || enabledRaw === "true";

  if (!body) {
    throw new Error(`Hook file ${sourcePath} has no prompt body`);
  }

  return {
    name,
    description,
    events,
    condition,
    model,
    timeoutMs,
    cache,
    priority,
    enabled,
    body,
    sourcePath,
    origin,
  };
}

// ============================================================================
// File Discovery
// ============================================================================

function expandTilde(dir: string): string {
  if (dir.startsWith("~/") || dir === "~") {
    return join(homedir(), dir.slice(1));
  }
  return dir;
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    const s = await stat(path);
    return s.isDirectory();
  } catch {
    return false;
  }
}

async function listMarkdownFiles(dir: string): Promise<string[]> {
  const expanded = expandTilde(dir);
  const resolved = resolve(expanded);

  if (!(await isDirectory(resolved))) {
    return [];
  }

  try {
    const entries = await readdir(resolved);
    return entries
      .filter((entry) => entry.endsWith(".md"))
      .sort()
      .map((entry) => join(resolved, entry));
  } catch {
    return [];
  }
}

export async function discoverHookFiles(projectDir: string, userDir: string): Promise<string[]> {
  const [projectFiles, userFiles] = await Promise.all([
    listMarkdownFiles(projectDir),
    listMarkdownFiles(userDir),
  ]);

  // Project hooks first, then user hooks
  return [...projectFiles, ...userFiles];
}

export async function loadAllHooks(
  projectDir: string,
  userDir: string,
): Promise<LlmHookDefinition[]> {
  const projectExpanded = expandTilde(projectDir);
  const userExpanded = expandTilde(userDir);

  const [projectFiles, userFiles] = await Promise.all([
    listMarkdownFiles(projectExpanded),
    listMarkdownFiles(userExpanded),
  ]);

  const hooks: LlmHookDefinition[] = [];
  const errors: string[] = [];

  // Load project hooks
  for (const filePath of projectFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const hook = parseHookMarkdown(content, filePath, "project");
      hooks.push(hook);
    } catch (err) {
      errors.push(
        `Failed to load ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // Load user hooks
  for (const filePath of userFiles) {
    try {
      const content = await readFile(filePath, "utf-8");
      const hook = parseHookMarkdown(content, filePath, "user");
      hooks.push(hook);
    } catch (err) {
      errors.push(
        `Failed to load ${filePath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  if (errors.length > 0) {
    console.warn(`llm-hooks: ${errors.length} hook(s) failed to load:\n  ${errors.join("\n  ")}`);
  }

  // Sort by priority (higher priority = earlier execution)
  hooks.sort((a, b) => b.priority - a.priority);

  return hooks;
}

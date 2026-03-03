/**
 * Markdown Agent Loader
 *
 * Discovers lightweight agent definitions from .md files in:
 *   - `.mayros/agents/` (project-level, relative to cwd)
 *   - `~/.mayros/agents/` (user-level, home directory)
 *
 * Each .md file represents one agent. The filename (without extension)
 * becomes the agent id. YAML frontmatter provides configuration, and the
 * body contains the agent's identity instructions / system prompt.
 *
 * Frontmatter fields:
 *   - name: Display name for the agent (optional, defaults to id)
 *   - model: Model id (e.g. "anthropic/claude-sonnet-4-20250514") (optional)
 *   - allowed-tools: Comma-separated tool names (optional)
 *   - workspace: Workspace directory path (optional)
 *   - default: "true" to mark as default agent (optional)
 *
 * These markdown agents complement the config-based agents (agents.list).
 * Config agents take priority over markdown agents with the same id.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";
import { normalizeAgentId } from "../routing/session-key.js";

export type MarkdownAgent = {
  /** Agent id (filename without .md extension, lowercased). */
  id: string;
  /** Display name from frontmatter or derived from id. */
  name: string;
  /** Model id (e.g. "anthropic/claude-sonnet-4-20250514"). */
  model?: string;
  /** Allowed tool names from frontmatter. */
  allowedTools?: string[];
  /** Workspace directory path. */
  workspace?: string;
  /** Whether this is the default agent. */
  isDefault: boolean;
  /** Whether persistent agent memory is enabled. */
  memory: boolean;
  /** The agent identity / system prompt (body after frontmatter). */
  identity: string;
  /** Absolute path to the source .md file. */
  sourcePath: string;
  /** "project" or "user" origin. */
  origin: "project" | "user";
};

type CacheEntry = {
  agents: MarkdownAgent[];
  mtimeMs: number;
};

const directoryCache = new Map<string, CacheEntry>();

/**
 * Parse a single .md agent file into a MarkdownAgent.
 * Returns null if the file is invalid (missing identity body, etc.).
 */
export function parseMarkdownAgentFile(
  filePath: string,
  content: string,
  origin: "project" | "user",
): MarkdownAgent | null {
  const basename = path.basename(filePath, ".md");
  const rawId = basename.toLowerCase().trim();

  // Validate agent id: must be a valid identifier
  if (!rawId || !/^[a-z][a-z0-9_-]*$/.test(rawId)) {
    return null;
  }

  const id = normalizeAgentId(rawId);
  const frontmatter = parseFrontmatterBlock(content);

  // Extract body: everything after the closing --- of frontmatter
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let identity: string;
  if (normalized.startsWith("---")) {
    const endIndex = normalized.indexOf("\n---", 3);
    if (endIndex !== -1) {
      identity = normalized.slice(endIndex + 4).trim();
    } else {
      identity = "";
    }
  } else {
    identity = normalized.trim();
  }

  // Agent must have either identity body or explicit configuration
  const hasConfig = Boolean(frontmatter.model || frontmatter.name || frontmatter["allowed-tools"]);
  if (!identity && !hasConfig) {
    return null;
  }

  const name = frontmatter.name?.trim() || rawId;
  const model = frontmatter.model?.trim() || undefined;
  const workspace = frontmatter.workspace?.trim() || undefined;
  const isDefault = frontmatter.default?.trim().toLowerCase() === "true";
  const memory = frontmatter.memory?.trim().toLowerCase() === "true";

  let allowedTools: string[] | undefined;
  const toolsRaw = frontmatter["allowed-tools"]?.trim();
  if (toolsRaw) {
    allowedTools = toolsRaw
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    if (allowedTools.length === 0) {
      allowedTools = undefined;
    }
  }

  return {
    id,
    name,
    model,
    allowedTools,
    workspace,
    isDefault,
    memory,
    identity: identity || "",
    sourcePath: filePath,
    origin,
  };
}

/**
 * Scan a single directory for .md agent files.
 */
function scanDirectory(dirPath: string, origin: "project" | "user"): MarkdownAgent[] {
  if (!fs.existsSync(dirPath)) {
    return [];
  }

  let stat: fs.Stats;
  try {
    stat = fs.statSync(dirPath);
  } catch {
    return [];
  }
  if (!stat.isDirectory()) {
    return [];
  }

  // Check cache
  const cached = directoryCache.get(dirPath);
  if (cached && cached.mtimeMs === stat.mtimeMs) {
    return cached.agents;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const agents: MarkdownAgent[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const agent = parseMarkdownAgentFile(filePath, content, origin);
      if (agent) {
        agents.push(agent);
      }
    } catch {
      // Skip unreadable files
    }
  }

  directoryCache.set(dirPath, { agents, mtimeMs: stat.mtimeMs });
  return agents;
}

/**
 * Resolve the project-level agents directory.
 */
export function resolveProjectAgentsDir(projectRoot: string): string {
  return path.join(projectRoot, ".mayros", "agents");
}

/**
 * Resolve the user-level agents directory.
 */
export function resolveUserAgentsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) {
    return "";
  }
  return path.join(home, ".mayros", "agents");
}

/**
 * Discover all markdown agents from both project and user directories.
 * Project agents take priority over user agents with the same id.
 */
export function discoverMarkdownAgents(projectRoot?: string): MarkdownAgent[] {
  const root = projectRoot ?? process.cwd();
  const projectDir = resolveProjectAgentsDir(root);
  const userDir = resolveUserAgentsDir();

  const projectAgents = scanDirectory(projectDir, "project");
  const userAgents = scanDirectory(userDir, "user");

  // Merge: project agents override user agents with the same id
  const byId = new Map<string, MarkdownAgent>();
  for (const agent of userAgents) {
    byId.set(agent.id, agent);
  }
  for (const agent of projectAgents) {
    byId.set(agent.id, agent);
  }

  return Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Find a specific markdown agent by id.
 */
export function findMarkdownAgent(
  agentId: string,
  projectRoot?: string,
): MarkdownAgent | undefined {
  const id = normalizeAgentId(agentId);
  const agents = discoverMarkdownAgents(projectRoot);
  return agents.find((a) => a.id === id);
}

/**
 * Clear the directory cache. Useful for testing or after known file changes.
 */
export function clearMarkdownAgentCache(): void {
  directoryCache.clear();
}

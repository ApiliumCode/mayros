/**
 * Markdown Command Loader
 *
 * Discovers and loads slash commands defined as .md files in:
 *   - `.mayros/commands/` (project-level, relative to cwd)
 *   - `~/.mayros/commands/` (user-level, home directory)
 *
 * Each .md file represents one command. The filename (without extension)
 * becomes the command name. YAML frontmatter provides metadata, and the
 * body contains the prompt template sent to the agent.
 *
 * Frontmatter fields:
 *   - description: Short description shown in /help (required)
 *   - argument-hint: Placeholder shown in autocomplete (e.g. "<file> [options]")
 *   - allowed-tools: Comma-separated tool names (optional)
 *
 * The body supports `$ARGUMENTS` interpolation — replaced with the text
 * after the command name when the user invokes the command.
 */

import fs from "node:fs";
import path from "node:path";
import { parseFrontmatterBlock } from "../markdown/frontmatter.js";

export type MarkdownCommand = {
  /** Command name (filename without .md extension, lowercased). */
  name: string;
  /** Short description from frontmatter. */
  description: string;
  /** Argument hint for autocomplete (e.g. "<file> [options]"). */
  argumentHint?: string;
  /** Allowed tool names from frontmatter (comma-separated → array). */
  allowedTools?: string[];
  /** The prompt template body (everything after frontmatter). */
  body: string;
  /** Absolute path to the source .md file. */
  sourcePath: string;
  /** "project" or "user" origin. */
  origin: "project" | "user";
};

type CacheEntry = {
  commands: MarkdownCommand[];
  mtimeMs: number;
};

const directoryCache = new Map<string, CacheEntry>();

/**
 * Parse a single .md command file into a MarkdownCommand.
 * Returns null if the file is invalid (missing description, empty body, etc.).
 */
export function parseMarkdownCommandFile(
  filePath: string,
  content: string,
  origin: "project" | "user",
): MarkdownCommand | null {
  const basename = path.basename(filePath, ".md");
  const name = basename.toLowerCase().trim();

  // Validate command name: must start with a letter, contain only letters/numbers/hyphens/underscores
  if (!name || !/^[a-z][a-z0-9_-]*$/.test(name)) {
    return null;
  }

  const frontmatter = parseFrontmatterBlock(content);
  const description = frontmatter.description?.trim();
  if (!description) {
    return null;
  }

  // Extract body: everything after the closing --- of frontmatter
  const normalized = content.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  let body: string;
  if (normalized.startsWith("---")) {
    const endIndex = normalized.indexOf("\n---", 3);
    if (endIndex !== -1) {
      body = normalized.slice(endIndex + 4).trim();
    } else {
      body = "";
    }
  } else {
    body = normalized.trim();
  }

  if (!body) {
    return null;
  }

  const argumentHint = frontmatter["argument-hint"]?.trim() || undefined;

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
    name,
    description,
    argumentHint,
    allowedTools,
    body,
    sourcePath: filePath,
    origin,
  };
}

/**
 * Expand a markdown command body by interpolating `$ARGUMENTS`.
 */
export function expandMarkdownCommand(command: MarkdownCommand, args: string): string {
  return command.body.replace(/\$ARGUMENTS/g, args);
}

/**
 * Scan a single directory for .md command files.
 * Returns an array of valid commands. Invalid files are silently skipped.
 */
function scanDirectory(dirPath: string, origin: "project" | "user"): MarkdownCommand[] {
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
    return cached.commands;
  }

  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dirPath, { withFileTypes: true });
  } catch {
    return [];
  }

  const commands: MarkdownCommand[] = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) {
      continue;
    }

    const filePath = path.join(dirPath, entry.name);
    try {
      const content = fs.readFileSync(filePath, "utf-8");
      const command = parseMarkdownCommandFile(filePath, content, origin);
      if (command) {
        commands.push(command);
      }
    } catch {
      // Skip unreadable files
    }
  }

  directoryCache.set(dirPath, { commands, mtimeMs: stat.mtimeMs });
  return commands;
}

/**
 * Resolve the project-level commands directory.
 * Returns `.mayros/commands/` relative to the given root directory.
 */
export function resolveProjectCommandsDir(projectRoot: string): string {
  return path.join(projectRoot, ".mayros", "commands");
}

/**
 * Resolve the user-level commands directory.
 * Returns `~/.mayros/commands/`.
 */
export function resolveUserCommandsDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
  if (!home) {
    return "";
  }
  return path.join(home, ".mayros", "commands");
}

/**
 * Discover all markdown commands from both project and user directories.
 * Project commands take priority over user commands with the same name.
 */
export function discoverMarkdownCommands(projectRoot?: string): MarkdownCommand[] {
  const root = projectRoot ?? process.cwd();
  const projectDir = resolveProjectCommandsDir(root);
  const userDir = resolveUserCommandsDir();

  const projectCommands = scanDirectory(projectDir, "project");
  const userCommands = scanDirectory(userDir, "user");

  // Merge: project commands override user commands with the same name
  const byName = new Map<string, MarkdownCommand>();
  for (const cmd of userCommands) {
    byName.set(cmd.name, cmd);
  }
  for (const cmd of projectCommands) {
    byName.set(cmd.name, cmd);
  }

  return Array.from(byName.values()).sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Find a specific markdown command by name.
 */
export function findMarkdownCommand(
  name: string,
  projectRoot?: string,
): MarkdownCommand | undefined {
  const commands = discoverMarkdownCommands(projectRoot);
  return commands.find((cmd) => cmd.name === name.toLowerCase());
}

/**
 * Clear the directory cache. Useful for testing or after known file changes.
 */
export function clearMarkdownCommandCache(): void {
  directoryCache.clear();
}

/**
 * Auto-configure Claude to use Mayros MCP server.
 *
 * Targets:
 *   --desktop  → Claude Desktop (writes claude_desktop_config.json)
 *   (default)  → Claude Code CLI (`claude mcp add`)
 *
 * Resolves absolute paths to node and mayros.mjs so Claude Desktop
 * can find the binary regardless of shell PATH.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { homedir, platform } from "node:os";

// ── Types ──────────────────────────────────────────────────────────

export type SetupTarget = "code" | "desktop";

export type SetupClaudeOpts = {
  port: number;
  host: string;
  transport?: "stdio" | "http";
  target?: SetupTarget;
};

// ── Public API ─────────────────────────────────────────────────────

export async function setupClaudeCodeMcp(opts: SetupClaudeOpts): Promise<void> {
  const target = opts.target ?? "code";

  if (target === "desktop") {
    setupDesktop();
  } else {
    setupCode(opts);
  }
}

// ── Claude Code ────────────────────────────────────────────────────

function validateHost(host: string): boolean {
  return /^[a-zA-Z0-9._-]+$/.test(host);
}

function setupCode(opts: SetupClaudeOpts): void {
  const transport = opts.transport ?? "stdio";

  if (!validateHost(opts.host)) {
    console.error(
      `Invalid host: "${opts.host}". Must contain only alphanumeric, dots, hyphens, or underscores.`,
    );
    return;
  }

  try {
    if (transport === "stdio") {
      execSync("claude mcp add mayros -- mayros serve --stdio", { stdio: "inherit" });
    } else {
      const url = `http://${opts.host}:${opts.port}/mcp`;
      execSync(`claude mcp add mayros -s http --url ${JSON.stringify(url)}`, { stdio: "inherit" });
    }
    console.log("Mayros registered with Claude Code.");
  } catch {
    console.log("\nTo connect Mayros to Claude Code manually:\n");
    console.log("  claude mcp add mayros -- mayros serve --stdio\n");
  }
}

// ── Claude Desktop ─────────────────────────────────────────────────

function setupDesktop(): void {
  const configPath = getDesktopConfigPath();
  if (!configPath) {
    console.error("Could not determine Claude Desktop config path for this platform.");
    return;
  }

  const nodePath = resolveNodePath();
  const mayrosPath = resolveMayrosEntryPath();

  if (!nodePath || !mayrosPath) {
    console.error("Could not resolve paths to node or mayros.");
    console.log("\nManual setup — add to", configPath, ":\n");
    printManualDesktopConfig();
    return;
  }

  // Read existing config or create new
  let config: Record<string, unknown> = {};
  if (existsSync(configPath)) {
    try {
      config = JSON.parse(readFileSync(configPath, "utf-8")) as Record<string, unknown>;
    } catch {
      // Corrupt file — start fresh but preserve what we can
    }
  }

  // Merge mcpServers
  const mcpServers = (config.mcpServers ?? {}) as Record<string, unknown>;
  mcpServers.mayros = {
    command: nodePath,
    args: [mayrosPath, "serve", "--stdio"],
  };
  config.mcpServers = mcpServers;

  // Write
  const dir = dirname(configPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n", "utf-8");

  console.log(`Mayros registered in Claude Desktop config.`);
  console.log(`  Config: ${configPath}`);
  console.log(`  Node:   ${nodePath}`);
  console.log(`  Entry:  ${mayrosPath}`);
  console.log(`\nRestart Claude Desktop to activate.`);
}

// ── Helpers ────────────────────────────────────────────────────────

function getDesktopConfigPath(): string | null {
  const home = homedir();
  const os = platform();

  if (os === "darwin") {
    return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  }
  if (os === "win32") {
    return join(home, "AppData", "Roaming", "Claude", "claude_desktop_config.json");
  }
  if (os === "linux") {
    return join(home, ".config", "Claude", "claude_desktop_config.json");
  }
  return null;
}

function resolveNodePath(): string | null {
  const os = platform();
  try {
    const cmd = os === "win32" ? "where node" : "which node";
    return execSync(cmd, { encoding: "utf-8" }).trim().split("\n")[0];
  } catch {
    const candidates =
      os === "win32"
        ? ["C:\\Program Files\\nodejs\\node.exe", "C:\\Program Files (x86)\\nodejs\\node.exe"]
        : ["/opt/homebrew/bin/node", "/usr/local/bin/node", "/usr/bin/node"];
    return candidates.find((p) => existsSync(p)) ?? null;
  }
}

function resolveMayrosEntryPath(): string | null {
  // 1. Check global npm install
  try {
    const globalDir = execSync("npm root -g", { encoding: "utf-8" }).trim();
    const globalEntry = join(globalDir, "@apilium", "mayros", "mayros.mjs");
    if (existsSync(globalEntry)) return globalEntry;
  } catch {
    // npm not available
  }

  // 2. Check relative to this file (running from source)
  const localEntry = join(dirname(dirname(__dirname)), "mayros.mjs");
  if (existsSync(localEntry)) return localEntry;

  return null;
}

function printManualDesktopConfig(): void {
  console.log(`{
  "mcpServers": {
    "mayros": {
      "command": "/path/to/node",
      "args": ["/path/to/mayros.mjs", "serve", "--stdio"]
    }
  }
}`);
}

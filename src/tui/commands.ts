import type { SlashCommand } from "@earendil-works/pi-tui";
import { listChatCommands, listChatCommandsForConfig } from "../auto-reply/commands-registry.js";
import { formatThinkingLevels, listThinkingLevelLabels } from "../auto-reply/thinking.js";
import { discoverMarkdownCommands } from "../commands/markdown-commands.js";
import type { MayrosConfig } from "../config/types.js";

const VERBOSE_LEVELS = ["on", "off"];
const REASONING_LEVELS = ["on", "off"];
const ELEVATED_LEVELS = ["on", "off", "ask", "full"];
const ACTIVATION_LEVELS = ["mention", "always"];
const USAGE_FOOTER_LEVELS = ["off", "tokens", "full"];
const THEME_PRESETS = [
  "dark",
  "light",
  "high-contrast",
  "dracula",
  "github-dark",
  "github-light",
  "solarized-dark",
  "solarized-light",
  "atom-one-dark",
  "ayu-dark",
];
const OUTPUT_STYLES = ["standard", "explanatory", "learning"];
const PERMISSION_MODES = ["auto", "ask", "deny"];

export type ParsedCommand = {
  name: string;
  args: string;
};

export type SlashCommandOptions = {
  cfg?: MayrosConfig;
  provider?: string;
  model?: string;
};

const COMMAND_ALIASES: Record<string, string> = {
  elev: "elevated",
};

export function parseCommand(input: string): ParsedCommand {
  const trimmed = input.replace(/^\//, "").trim();
  if (!trimmed) {
    return { name: "", args: "" };
  }
  const [name, ...rest] = trimmed.split(/\s+/);
  const normalized = name.toLowerCase();
  return {
    name: COMMAND_ALIASES[normalized] ?? normalized,
    args: rest.join(" ").trim(),
  };
}

export function getSlashCommands(options: SlashCommandOptions = {}): SlashCommand[] {
  const thinkLevels = listThinkingLevelLabels(options.provider, options.model);
  const commands: SlashCommand[] = [
    { name: "help", description: "Show slash command help" },
    { name: "status", description: "Show gateway status summary" },
    { name: "agent", description: "Switch agent or open picker" },
    {
      name: "session",
      description: "Switch, list, rename, or delete sessions",
      getArgumentCompletions: (prefix) =>
        ["list", "rename", "delete"]
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({ value, label: value })),
    },
    { name: "model", description: "Set model or open picker" },
    {
      name: "think",
      description: "Set thinking level",
      getArgumentCompletions: (prefix) =>
        thinkLevels
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({ value, label: value })),
    },
    {
      name: "verbose",
      description: "Set verbose on/off",
      getArgumentCompletions: (prefix) =>
        VERBOSE_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "reasoning",
      description: "Set reasoning on/off",
      getArgumentCompletions: (prefix) =>
        REASONING_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "usage",
      description: "Toggle per-response usage line",
      getArgumentCompletions: (prefix) =>
        USAGE_FOOTER_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "elevated",
      description: "Set elevated on/off/ask/full",
      getArgumentCompletions: (prefix) =>
        ELEVATED_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "activation",
      description: "Set group activation",
      getArgumentCompletions: (prefix) =>
        ACTIVATION_LEVELS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "theme",
      description: "Set TUI color theme",
      getArgumentCompletions: (prefix) =>
        THEME_PRESETS.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "diff",
      description: "Show git diff (optionally for a file)",
    },
    {
      name: "context",
      description: "Show context window usage",
    },
    {
      name: "style",
      description: "Set output style",
      getArgumentCompletions: (prefix) =>
        OUTPUT_STYLES.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "vim",
      description: "Toggle vim editing mode",
    },
    {
      name: "permission",
      description: "Set permission mode",
      getArgumentCompletions: (prefix) =>
        PERMISSION_MODES.filter((v) => v.startsWith(prefix.toLowerCase())).map((value) => ({
          value,
          label: value,
        })),
    },
    {
      name: "fast",
      description: "Toggle fast mode (minimal thinking)",
    },
    {
      name: "compact",
      description: "Compact conversation history",
    },
    {
      name: "copy",
      description: "Copy last response to clipboard",
    },
    {
      name: "export",
      description: "Export session to file",
    },
    {
      name: "undo",
      description: "Undo last file change",
      getArgumentCompletions: (prefix) =>
        ["list"]
          .filter((v) => v.startsWith(prefix.toLowerCase()))
          .map((value) => ({
            value,
            label: value,
          })),
    },
    { name: "abort", description: "Abort active run" },
    { name: "new", description: "Reset the session" },
    { name: "settings", description: "Open settings" },
    // Mayros ecosystem
    { name: "plan", description: "Start or show semantic plan" },
    { name: "kg", description: "Search or browse the knowledge graph" },
    { name: "mouse", description: "Toggle mouse reporting (off enables text selection)" },
    { name: "tools", description: "List tools available to the model" },
    { name: "trace", description: "Show agent trace events" },
    { name: "team", description: "Show team dashboard" },
    { name: "tasks", description: "Show background tasks" },
    { name: "workflow", description: "Run or list workflows" },
    { name: "rules", description: "Show active rules" },
    { name: "mailbox", description: "Check agent mailbox" },
    { name: "search", description: "Search conversation history across sessions" },
    { name: "batch", description: "Run batch prompt processing" },
    { name: "teleport", description: "Export/import session between devices" },
    { name: "sync", description: "Cortex peer sync status" },
    { name: "onboard", description: "Run onboarding wizard" },
    { name: "bug", description: "Report a bug or give feedback" },
    { name: "init", description: "Generate mayros.json project config" },
    { name: "exit", description: "Exit the TUI" },
  ];

  const seen = new Set(commands.map((command) => command.name));
  const gatewayCommands = options.cfg ? listChatCommandsForConfig(options.cfg) : listChatCommands();
  for (const command of gatewayCommands) {
    const aliases = command.textAliases.length > 0 ? command.textAliases : [`/${command.key}`];
    for (const alias of aliases) {
      const name = alias.replace(/^\//, "").trim();
      if (!name || seen.has(name)) {
        continue;
      }
      seen.add(name);
      commands.push({ name, description: command.description });
    }
  }

  // Discover user-defined markdown commands from .mayros/commands/
  for (const mdCmd of discoverMarkdownCommands()) {
    if (seen.has(mdCmd.name)) {
      continue;
    }
    seen.add(mdCmd.name);
    const desc = mdCmd.argumentHint
      ? `${mdCmd.description} (${mdCmd.argumentHint})`
      : mdCmd.description;
    commands.push({ name: mdCmd.name, description: desc });
  }

  return commands;
}

export function helpText(options: SlashCommandOptions = {}): string {
  const thinkLevels = formatThinkingLevels(options.provider, options.model, "|");
  const lines = [
    "Slash commands:",
    "/help",
    "/commands",
    "/status",
    "/agent [id]",
    "/session [key|list|rename <name>|delete <key>]",
    "/model [provider/model]",
    `/think <${thinkLevels}>`,
    "/verbose <on|off>",
    "/reasoning <on|off>",
    "/usage <off|tokens|full>",
    "/elevated <on|off|ask|full>",
    "/activation <mention|always>",
    "/theme <dark|light|high-contrast|dracula|github-dark|github-light|solarized-dark|solarized-light|atom-one-dark|ayu-dark>",
    "/diff [file]",
    "/context",
    "/style <standard|explanatory|learning>",
    "/vim",
    "/permission <auto|ask|deny>",
    "/fast",
    "/compact",
    "/copy",
    "/export [file]",
    "/undo [list]",
    "/new",
    "/abort",
    "/settings",
    "",
    "Mayros ecosystem:",
    "/plan [start|show|list]",
    "/kg <query>",
    "/trace [events|stats]",
    "/team",
    "/tasks",
    "/workflow [run|list] [name]",
    "/rules [list|add]",
    "/mailbox [list|send]",
    "/search <query>",
    "/batch <file>",
    "/teleport [export|import]",
    "/sync [status|pair]",
    "/onboard",
    "/bug",
    "/init",
    "",
    "/exit",
  ];

  // Append user-defined markdown commands
  const mdCommands = discoverMarkdownCommands();
  if (mdCommands.length > 0) {
    lines.push("", "Custom commands (.mayros/commands/):");
    for (const cmd of mdCommands) {
      const hint = cmd.argumentHint ? ` ${cmd.argumentHint}` : "";
      lines.push(`/${cmd.name}${hint} — ${cmd.description}`);
    }
  }

  return lines.join("\n");
}

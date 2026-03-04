import { formatCliCommand } from "../cli/command-format.js";
import type { MayrosConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";

// ============================================================================
// Presets
// ============================================================================

type McpPreset = {
  id: string;
  label: string;
  hint: string;
  command: string;
  baseArgs: string[];
  requiresInput?: {
    envVar: string;
    prompt: string;
    placeholder: string;
    argPosition: "append";
  };
};

const MCP_PRESETS: McpPreset[] = [
  {
    id: "filesystem",
    label: "Filesystem",
    hint: "Read and write files in a directory",
    command: "npx",
    baseArgs: ["-y", "@modelcontextprotocol/server-filesystem"],
    requiresInput: {
      envVar: "MCP_FILESYSTEM_DIR",
      prompt: "Filesystem: Directory to share with Mayros",
      placeholder: "~/projects",
      argPosition: "append",
    },
  },
  {
    id: "github",
    label: "GitHub",
    hint: "Issues, PRs, repos, and code search",
    command: "npx",
    baseArgs: ["-y", "@modelcontextprotocol/server-github"],
    requiresInput: {
      envVar: "GITHUB_TOKEN",
      prompt: "GitHub: Personal access token (or set GITHUB_TOKEN)",
      placeholder: "ghp_...",
      argPosition: "append",
    },
  },
  {
    id: "memory",
    label: "Memory",
    hint: "Persistent key-value storage",
    command: "npx",
    baseArgs: ["-y", "@modelcontextprotocol/server-memory"],
  },
  {
    id: "fetch",
    label: "Fetch",
    hint: "HTTP requests and web scraping",
    command: "npx",
    baseArgs: ["-y", "@modelcontextprotocol/server-fetch"],
  },
];

const CUSTOM_OPTION_VALUE = "__custom__";

// ============================================================================
// Setup
// ============================================================================

export async function setupMcpServers(
  cfg: MayrosConfig,
  _runtime: RuntimeEnv,
  prompter: WizardPrompter,
): Promise<MayrosConfig> {
  await prompter.note(
    [
      "MCP servers extend Mayros with external tools — file access,",
      "GitHub, databases, and more.",
    ].join("\n"),
    "MCP Servers",
  );

  const shouldConnect = await prompter.confirm({
    message: "Connect external tool servers? (recommended)",
    initialValue: true,
  });
  if (!shouldConnect) {
    return cfg;
  }

  const selected = await prompter.multiselect({
    message: "Select servers to connect",
    options: [
      ...MCP_PRESETS.map((p) => ({
        value: p.id,
        label: p.label,
        hint: p.hint,
      })),
      { value: CUSTOM_OPTION_VALUE, label: "Custom server...", hint: "Provide id and command" },
    ],
  });

  const servers: Array<{
    id: string;
    transport: { type: "stdio"; command: string; args: string[] };
    autoConnect: boolean;
  }> = [];

  for (const id of selected) {
    if (id === CUSTOM_OPTION_VALUE) {
      continue;
    }
    const preset = MCP_PRESETS.find((p) => p.id === id);
    if (!preset) {
      continue;
    }
    const args = [...preset.baseArgs];
    if (preset.requiresInput) {
      const envValue = process.env[preset.requiresInput.envVar];
      if (envValue) {
        args.push(envValue);
      } else {
        const input = await prompter.text({
          message: preset.requiresInput.prompt,
          placeholder: preset.requiresInput.placeholder,
          validate: (v) => (v?.trim() ? undefined : "Required"),
        });
        args.push(input.trim());
      }
    }
    servers.push({
      id: preset.id,
      transport: { type: "stdio", command: preset.command, args },
      autoConnect: true,
    });
  }

  if (selected.includes(CUSTOM_OPTION_VALUE)) {
    const customId = await prompter.text({
      message: "Custom server id",
      validate: (v) =>
        v?.trim() && /^[a-zA-Z][a-zA-Z0-9_-]*$/.test(v.trim())
          ? undefined
          : "Must start with a letter (letters, digits, hyphens, underscores)",
    });
    const customCommand = await prompter.text({
      message: "Custom server command (e.g. npx -y @scope/server)",
      validate: (v) => (v?.trim() ? undefined : "Required"),
    });
    const parts = customCommand.trim().split(/\s+/);
    servers.push({
      id: customId.trim(),
      transport: { type: "stdio", command: parts[0]!, args: parts.slice(1) },
      autoConnect: true,
    });
  }

  if (servers.length === 0) {
    return cfg;
  }

  const existingEntries = { ...cfg.plugins?.entries };
  const existingMcpConfig = (existingEntries["mcp-client"]?.config ?? {}) as Record<
    string,
    unknown
  >;
  const existingServers = Array.isArray(existingMcpConfig.servers)
    ? (existingMcpConfig.servers as Array<{ id?: string }>)
    : [];

  // Merge: keep existing servers that don't conflict, append new ones
  const merged = [
    ...existingServers.filter((s) => !servers.some((ns) => ns.id === s.id)),
    ...servers,
  ];

  existingEntries["mcp-client"] = {
    ...existingEntries["mcp-client"],
    enabled: true,
    config: {
      ...existingMcpConfig,
      registerInCortex: existingMcpConfig.registerInCortex ?? false,
      servers: merged,
    },
  };

  const next: MayrosConfig = {
    ...cfg,
    plugins: {
      ...cfg.plugins,
      entries: existingEntries,
    },
  };

  const names = servers.map((s) => s.id).join(", ");
  await prompter.note(
    [
      `${servers.length} server${servers.length > 1 ? "s" : ""} configured: ${names}`,
      "Auto-connect: enabled",
      "",
      "Manage later with:",
      `  ${formatCliCommand("mayros mcp list")}`,
      `  ${formatCliCommand("mayros mcp connect <id>")}`,
    ].join("\n"),
    "MCP Servers Configured",
  );

  return next;
}

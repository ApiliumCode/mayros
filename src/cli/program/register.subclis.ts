import type { Command } from "commander";
import type { MayrosConfig } from "../../config/config.js";
import { isTruthyEnvValue } from "../../infra/env.js";
import { defaultRuntime } from "../../runtime.js";
import { getPrimaryCommand, hasHelpOrVersion } from "../argv.js";
import { reparseProgramFromActionArgs } from "./action-reparse.js";

type SubCliRegistrar = (program: Command) => Promise<void> | void;

type SubCliEntry = {
  name: string;
  description: string;
  hasSubcommands: boolean;
  register: SubCliRegistrar;
};

const shouldRegisterPrimaryOnly = (argv: string[]) => {
  if (isTruthyEnvValue(process.env.MAYROS_DISABLE_LAZY_SUBCOMMANDS)) {
    return false;
  }
  if (hasHelpOrVersion(argv)) {
    return false;
  }
  return true;
};

const shouldEagerRegisterSubcommands = () => {
  return isTruthyEnvValue(process.env.MAYROS_DISABLE_LAZY_SUBCOMMANDS);
};

const loadConfig = async (): Promise<MayrosConfig> => {
  const mod = await import("../../config/config.js");
  return mod.loadConfig();
};

// Note for humans and agents:
// If you update the list of commands, also check whether they have subcommands
// and set the flag accordingly.
const entries: SubCliEntry[] = [
  {
    name: "code",
    description: "Start interactive coding session",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../code-cli.js");
      mod.registerCodeCli(program);
    },
  },
  {
    name: "acp",
    description: "Agent Control Protocol tools",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../acp-cli.js");
      mod.registerAcpCli(program);
    },
  },
  {
    name: "gateway",
    description: "Run, inspect, and query the WebSocket Gateway",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../gateway-cli.js");
      mod.registerGatewayCli(program);
    },
  },
  {
    name: "daemon",
    description: "Gateway service (legacy alias)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../daemon-cli.js");
      mod.registerDaemonCli(program);
    },
  },
  {
    name: "logs",
    description: "Tail gateway file logs via RPC",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../logs-cli.js");
      mod.registerLogsCli(program);
    },
  },
  {
    name: "system",
    description: "System events, heartbeat, and presence",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../system-cli.js");
      mod.registerSystemCli(program);
    },
  },
  {
    name: "models",
    description: "Discover, scan, and configure models",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../models-cli.js");
      mod.registerModelsCli(program);
    },
  },
  {
    name: "approvals",
    description: "Manage exec approvals (gateway or node host)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../exec-approvals-cli.js");
      mod.registerExecApprovalsCli(program);
    },
  },
  {
    name: "nodes",
    description: "Manage gateway-owned node pairing and node commands",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../nodes-cli.js");
      mod.registerNodesCli(program);
    },
  },
  {
    name: "devices",
    description: "Device pairing + token management",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../devices-cli.js");
      mod.registerDevicesCli(program);
    },
  },
  {
    name: "node",
    description: "Run and manage the headless node host service",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../node-cli.js");
      mod.registerNodeCli(program);
    },
  },
  {
    name: "sandbox",
    description: "Manage sandbox containers for agent isolation",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../sandbox-cli.js");
      mod.registerSandboxCli(program);
    },
  },
  {
    name: "tui",
    description: "Open a terminal UI connected to the Gateway",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../tui-cli.js");
      mod.registerTuiCli(program);
    },
  },
  {
    name: "cron",
    description: "Manage cron jobs via the Gateway scheduler",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../cron-cli.js");
      mod.registerCronCli(program);
    },
  },
  {
    name: "dns",
    description: "DNS helpers for wide-area discovery (Tailscale + CoreDNS)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../dns-cli.js");
      mod.registerDnsCli(program);
    },
  },
  {
    name: "docs",
    description: "Search the live Mayros docs",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../docs-cli.js");
      mod.registerDocsCli(program);
    },
  },
  {
    name: "hooks",
    description: "Manage internal agent hooks",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../hooks-cli.js");
      mod.registerHooksCli(program);
    },
  },
  {
    name: "webhooks",
    description: "Webhook helpers and integrations",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../webhooks-cli.js");
      mod.registerWebhooksCli(program);
    },
  },
  {
    name: "qr",
    description: "Generate iOS pairing QR/setup code",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../qr-cli.js");
      mod.registerQrCli(program);
    },
  },
  {
    name: "pairing",
    description: "Secure DM pairing (approve inbound requests)",
    hasSubcommands: true,
    register: async (program) => {
      // Initialize plugins before registering pairing CLI.
      // The pairing CLI calls listPairingChannels() at registration time,
      // which requires the plugin registry to be populated with channel plugins.
      const { registerPluginCliCommands } = await import("../../plugins/cli.js");
      registerPluginCliCommands(program, await loadConfig());
      const mod = await import("../pairing-cli.js");
      mod.registerPairingCli(program);
    },
  },
  {
    name: "plugins",
    description: "Manage Mayros plugins and extensions",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../plugins-cli.js");
      mod.registerPluginsCli(program);
      const { registerPluginCliCommands } = await import("../../plugins/cli.js");
      registerPluginCliCommands(program, await loadConfig());
    },
  },
  {
    name: "channels",
    description: "Manage connected chat channels (Telegram, Discord, etc.)",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../channels-cli.js");
      mod.registerChannelsCli(program);
    },
  },
  {
    name: "directory",
    description: "Lookup contact and group IDs (self, peers, groups) for supported chat channels",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../directory-cli.js");
      mod.registerDirectoryCli(program);
    },
  },
  {
    name: "security",
    description: "Security tools and local config audits",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../security-cli.js");
      mod.registerSecurityCli(program);
    },
  },
  {
    name: "skills",
    description: "List and inspect available skills",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../skills-cli.js");
      mod.registerSkillsCli(program);
    },
  },
  {
    name: "update",
    description: "Update Mayros and inspect update channel status",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../update-cli.js");
      mod.registerUpdateCli(program);
    },
  },
  {
    name: "completion",
    description: "Generate shell completion script",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../completion-cli.js");
      mod.registerCompletionCli(program);
    },
  },
  {
    name: "trace",
    description: "Inspect agent trace events — query, explain, stats, session trees",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../trace-cli.js");
      mod.registerTraceCli(program);
    },
  },
  {
    name: "plan",
    description: "Semantic plan mode — explore, assert, approve, execute with Cortex",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../plan-cli.js");
      mod.registerPlanCli(program);
    },
  },
  {
    name: "kg",
    description: "Knowledge graph — search, explore, and query project memory",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../kg-cli.js");
      mod.registerKgCli(program);
    },
  },
  {
    name: "workflow",
    description: "Multi-agent workflows — run, list, and track workflow execution",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../workflow-cli.js");
      mod.registerWorkflowCli(program);
    },
  },
  {
    name: "rules",
    description: "Rules engine — manage Cortex-backed hierarchical rules",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../rules-cli.js");
      mod.registerRulesCli(program);
    },
  },
  {
    name: "mailbox",
    description: "Agent mailbox — persistent messaging between agents",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../mailbox-cli.js");
      mod.registerMailboxCli(program);
    },
  },
  {
    name: "team-dashboard",
    description: "Team dashboard — real-time agent status and activity",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../dashboard-cli.js");
      mod.registerDashboardCli(program);
    },
  },
  {
    name: "session",
    description: "Session fork/rewind — checkpoint, fork, and rewind agent sessions",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../fork-cli.js");
      mod.registerSessionCli(program);
    },
  },
  {
    name: "tasks",
    description: "Background tasks — list, inspect, and manage background agent tasks",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../tasks-cli.js");
      mod.registerTasksCli(program);
    },
  },
  {
    name: "cortex",
    description: "Cortex sidecar — status, reconnect, and diagnostics",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../cortex-cli.js");
      mod.registerCortexCli(program);
    },
  },
  {
    name: "diagnose",
    description: "Diagnostic checks — runtime, Cortex, plugins, security, config",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../doctor-cli.js");
      mod.registerDoctorCli(program);
    },
  },
  {
    name: "lsp",
    description: "LSP bridge — query language diagnostics and definitions from Cortex",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../lsp-cli.js");
      mod.registerLspCli(program);
    },
  },
  {
    name: "batch",
    description: "Batch prompt processing — run multiple prompts in parallel",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../batch-cli.js");
      mod.registerBatchCli(program);
    },
  },
  {
    name: "teleport",
    description: "Session teleport — export/import sessions between devices",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../teleport-cli.js");
      mod.registerTeleportCli(program);
    },
  },
  {
    name: "sync",
    description: "Cortex sync — peer management and cross-device synchronization",
    hasSubcommands: true,
    register: async (program) => {
      const mod = await import("../sync-cli.js");
      mod.registerSyncCli(program);
    },
  },
  {
    name: "remote-control",
    description: "Start remote control server for mobile/web access",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../remote-cli.js");
      mod.registerRemoteCli(program);
    },
  },
  {
    name: "serve",
    description: "Start MCP server to expose Mayros tools, resources, and prompts",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../serve-cli.js");
      mod.registerServeCli(program);
    },
  },
  {
    name: "search",
    description: "Search conversation history across sessions",
    hasSubcommands: false,
    register: async (program) => {
      const mod = await import("../search-cli.js");
      mod.registerSearchCli(program);
    },
  },
];

export function getSubCliEntries(): SubCliEntry[] {
  return entries;
}

export function getSubCliCommandsWithSubcommands(): string[] {
  return entries.filter((entry) => entry.hasSubcommands).map((entry) => entry.name);
}

function removeCommand(program: Command, command: Command) {
  const commands = program.commands as Command[];
  const index = commands.indexOf(command);
  if (index >= 0) {
    commands.splice(index, 1);
  }
}

export async function registerSubCliByName(program: Command, name: string): Promise<boolean> {
  const entry = entries.find((candidate) => candidate.name === name);
  if (!entry) {
    return false;
  }
  const existing = program.commands.find((cmd) => cmd.name() === entry.name);
  if (existing) {
    removeCommand(program, existing);
  }
  await entry.register(program);
  return true;
}

function registerLazyCommand(program: Command, entry: SubCliEntry) {
  const placeholder = program.command(entry.name).description(entry.description);
  placeholder.allowUnknownOption(true);
  placeholder.allowExcessArguments(true);
  placeholder.action(async (...actionArgs) => {
    removeCommand(program, placeholder);
    await entry.register(program);
    await reparseProgramFromActionArgs(program, actionArgs);
  });
}

export function registerSubCliCommands(program: Command, argv: string[] = process.argv) {
  if (shouldEagerRegisterSubcommands()) {
    void Promise.allSettled(entries.map((entry) => entry.register(program))).then((results) => {
      for (const result of results) {
        if (result.status === "rejected") {
          defaultRuntime.error(`[mayros] subcli registration failed: ${String(result.reason)}`);
        }
      }
    });
    return;
  }
  const primary = getPrimaryCommand(argv);
  if (primary && shouldRegisterPrimaryOnly(argv)) {
    const entry = entries.find((candidate) => candidate.name === primary);
    if (entry) {
      registerLazyCommand(program, entry);
      return;
    }
  }
  for (const candidate of entries) {
    registerLazyCommand(program, candidate);
  }
}

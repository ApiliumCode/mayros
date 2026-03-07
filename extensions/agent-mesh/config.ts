import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";
import type { MergeStrategy } from "./mesh-protocol.js";

export type { CortexConfig };

export type MeshConfig = {
  maxSharedNamespaces: number;
  delegationTimeout: number;
  autoMerge: boolean;
};

export type TeamsConfig = {
  maxTeamSize: number;
  defaultStrategy: MergeStrategy;
  workflowTimeout: number;
};

export type WorktreeConfig = {
  enabled: boolean;
  basePath: string;
};

export type MailboxConfig = {
  maxMessagesPerAgent: number;
  retentionDays: number;
};

export type BackgroundConfig = {
  maxConcurrentTasks: number;
  taskTimeoutSeconds: number;
};

export type AgentMeshConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  mesh: MeshConfig;
  teams: TeamsConfig;
  worktree: WorktreeConfig;
  mailbox: MailboxConfig;
  background: BackgroundConfig;
};

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_MAX_SHARED_NAMESPACES = 50;
const DEFAULT_DELEGATION_TIMEOUT = 300;
const DEFAULT_AUTO_MERGE = true;
const DEFAULT_MAX_TEAM_SIZE = 8;
const DEFAULT_TEAM_STRATEGY: MergeStrategy = "additive";
const DEFAULT_WORKFLOW_TIMEOUT = 600;
const DEFAULT_WORKTREE_ENABLED = false;
const DEFAULT_WORKTREE_BASE_PATH = ".mayros/worktrees";
const DEFAULT_MAILBOX_MAX_MESSAGES = 1000;
const DEFAULT_MAILBOX_RETENTION_DAYS = 30;
const DEFAULT_BG_MAX_CONCURRENT = 5;
const DEFAULT_BG_TASK_TIMEOUT = 3600;

const VALID_STRATEGIES: MergeStrategy[] = [
  "additive",
  "replace",
  "conflict-flag",
  "newest-wins",
  "majority-wins",
];

function parseMeshConfig(raw: unknown): MeshConfig {
  const mesh = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      mesh,
      ["maxSharedNamespaces", "delegationTimeout", "autoMerge"],
      "mesh config",
    );
  }

  const maxSharedNamespaces =
    typeof mesh.maxSharedNamespaces === "number"
      ? Math.floor(mesh.maxSharedNamespaces)
      : DEFAULT_MAX_SHARED_NAMESPACES;
  if (maxSharedNamespaces < 1) {
    throw new Error("mesh.maxSharedNamespaces must be at least 1");
  }

  const delegationTimeout =
    typeof mesh.delegationTimeout === "number"
      ? Math.floor(mesh.delegationTimeout)
      : DEFAULT_DELEGATION_TIMEOUT;
  if (delegationTimeout < 1) {
    throw new Error("mesh.delegationTimeout must be at least 1");
  }

  const autoMerge = mesh.autoMerge !== false ? DEFAULT_AUTO_MERGE : false;

  return { maxSharedNamespaces, delegationTimeout, autoMerge };
}

export function parseTeamsConfig(raw: unknown): TeamsConfig {
  const teams = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(teams, ["maxTeamSize", "defaultStrategy", "workflowTimeout"], "teams config");
  }

  const maxTeamSize =
    typeof teams.maxTeamSize === "number" ? Math.floor(teams.maxTeamSize) : DEFAULT_MAX_TEAM_SIZE;
  if (maxTeamSize < 1) {
    throw new Error("teams.maxTeamSize must be at least 1");
  }

  const defaultStrategy =
    typeof teams.defaultStrategy === "string" &&
    VALID_STRATEGIES.includes(teams.defaultStrategy as MergeStrategy)
      ? (teams.defaultStrategy as MergeStrategy)
      : DEFAULT_TEAM_STRATEGY;

  const workflowTimeout =
    typeof teams.workflowTimeout === "number"
      ? Math.floor(teams.workflowTimeout)
      : DEFAULT_WORKFLOW_TIMEOUT;
  if (workflowTimeout < 1) {
    throw new Error("teams.workflowTimeout must be at least 1");
  }

  return { maxTeamSize, defaultStrategy, workflowTimeout };
}

export function parseWorktreeConfig(raw: unknown): WorktreeConfig {
  const wt = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(wt, ["enabled", "basePath"], "worktree config");
  }

  const enabled = wt.enabled === true ? true : DEFAULT_WORKTREE_ENABLED;
  const basePath = typeof wt.basePath === "string" ? wt.basePath : DEFAULT_WORKTREE_BASE_PATH;

  return { enabled, basePath };
}

export function parseMailboxConfig(raw: unknown): MailboxConfig {
  const mb = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(mb, ["maxMessagesPerAgent", "retentionDays"], "mailbox config");
  }

  const maxMessagesPerAgent =
    typeof mb.maxMessagesPerAgent === "number"
      ? Math.floor(mb.maxMessagesPerAgent)
      : DEFAULT_MAILBOX_MAX_MESSAGES;
  if (maxMessagesPerAgent < 1) {
    throw new Error("mailbox.maxMessagesPerAgent must be at least 1");
  }

  const retentionDays =
    typeof mb.retentionDays === "number"
      ? Math.floor(mb.retentionDays)
      : DEFAULT_MAILBOX_RETENTION_DAYS;
  if (retentionDays < 1) {
    throw new Error("mailbox.retentionDays must be at least 1");
  }

  return { maxMessagesPerAgent, retentionDays };
}

export function parseBackgroundConfig(raw: unknown): BackgroundConfig {
  const bg = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(bg, ["maxConcurrentTasks", "taskTimeoutSeconds"], "background config");
  }

  const maxConcurrentTasks =
    typeof bg.maxConcurrentTasks === "number"
      ? Math.floor(bg.maxConcurrentTasks)
      : DEFAULT_BG_MAX_CONCURRENT;
  if (maxConcurrentTasks < 1) {
    throw new Error("background.maxConcurrentTasks must be at least 1");
  }

  const taskTimeoutSeconds =
    typeof bg.taskTimeoutSeconds === "number"
      ? Math.floor(bg.taskTimeoutSeconds)
      : DEFAULT_BG_TASK_TIMEOUT;
  if (taskTimeoutSeconds < 1) {
    throw new Error("background.taskTimeoutSeconds must be at least 1");
  }

  return { maxConcurrentTasks, taskTimeoutSeconds };
}

export const agentMeshConfigSchema = {
  parse(value: unknown): AgentMeshConfig {
    if (value === null || value === undefined) {
      value = {};
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("agent mesh config must be an object");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["cortex", "agentNamespace", "mesh", "teams", "worktree", "mailbox", "background"],
      "agent mesh config",
    );

    const cortex = parseCortexConfig(cfg.cortex);
    const mesh = parseMeshConfig(cfg.mesh);
    const teams = parseTeamsConfig(cfg.teams);
    const worktree = parseWorktreeConfig(cfg.worktree);
    const mailbox = parseMailboxConfig(cfg.mailbox);
    const background = parseBackgroundConfig(cfg.background);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    return { cortex, agentNamespace, mesh, teams, worktree, mailbox, background };
  },
  uiHints: {
    "cortex.host": {
      label: "Cortex Host",
      placeholder: DEFAULT_HOST,
      advanced: true,
      help: "Hostname where AIngle Cortex is listening",
    },
    "cortex.port": {
      label: "Cortex Port",
      placeholder: String(DEFAULT_PORT),
      advanced: true,
      help: "Port for Cortex REST API",
    },
    "cortex.authToken": {
      label: "Cortex Auth Token",
      sensitive: true,
      placeholder: "Bearer ...",
      help: "Optional authentication token for Cortex API (or use ${CORTEX_AUTH_TOKEN})",
    },
    agentNamespace: {
      label: "Agent Namespace",
      placeholder: DEFAULT_NAMESPACE,
      advanced: true,
      help: "RDF namespace prefix for agent data",
    },
    "mesh.maxSharedNamespaces": {
      label: "Max Shared Namespaces",
      placeholder: String(DEFAULT_MAX_SHARED_NAMESPACES),
      advanced: true,
      help: "Maximum number of shared namespaces per mesh",
    },
    "mesh.delegationTimeout": {
      label: "Delegation Timeout",
      placeholder: String(DEFAULT_DELEGATION_TIMEOUT),
      advanced: true,
      help: "Timeout in seconds for delegated tasks",
    },
    "mesh.autoMerge": {
      label: "Auto-Merge",
      help: "Automatically merge child agent results back into parent namespace",
    },
    "teams.maxTeamSize": {
      label: "Max Team Size",
      placeholder: String(DEFAULT_MAX_TEAM_SIZE),
      advanced: true,
      help: "Maximum number of agents per team",
    },
    "teams.defaultStrategy": {
      label: "Default Merge Strategy",
      placeholder: DEFAULT_TEAM_STRATEGY,
      advanced: true,
      help: "Default merge strategy for team results (additive, replace, conflict-flag, newest-wins, majority-wins)",
    },
    "teams.workflowTimeout": {
      label: "Workflow Timeout",
      placeholder: String(DEFAULT_WORKFLOW_TIMEOUT),
      advanced: true,
      help: "Timeout in seconds for workflow execution",
    },
    "worktree.enabled": {
      label: "Worktree Isolation",
      help: "Enable git worktree isolation for parallel agent work",
    },
    "worktree.basePath": {
      label: "Worktree Base Path",
      placeholder: DEFAULT_WORKTREE_BASE_PATH,
      advanced: true,
      help: "Base path for git worktrees relative to repo root",
    },
    "mailbox.maxMessagesPerAgent": {
      label: "Max Messages Per Agent",
      placeholder: String(DEFAULT_MAILBOX_MAX_MESSAGES),
      advanced: true,
      help: "Maximum number of messages stored per agent mailbox",
    },
    "mailbox.retentionDays": {
      label: "Retention Days",
      placeholder: String(DEFAULT_MAILBOX_RETENTION_DAYS),
      advanced: true,
      help: "Number of days to retain mailbox messages",
    },
    "background.maxConcurrentTasks": {
      label: "Max Concurrent Tasks",
      placeholder: String(DEFAULT_BG_MAX_CONCURRENT),
      advanced: true,
      help: "Maximum number of background tasks running simultaneously",
    },
    "background.taskTimeoutSeconds": {
      label: "Task Timeout (seconds)",
      placeholder: String(DEFAULT_BG_TASK_TIMEOUT),
      advanced: true,
      help: "Timeout in seconds before a background task is considered stale",
    },
  },
};

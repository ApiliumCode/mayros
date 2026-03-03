import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";

export type { CortexConfig };

export type ProjectMemoryConfig = {
  enabled: boolean;
  autoDetect: boolean;
  maxConventions: number;
};

export type RulesConfig = {
  enabled: boolean;
  maxRules: number;
  injectIntoPrompt: boolean;
  autoLearn: boolean;
};

export type AgentMemoryConfig = {
  enabled: boolean;
  maxMemoriesPerAgent: number;
  autoCapture: boolean;
  pruneMinConfidence: number;
};

export type ContextualAwarenessConfig = {
  enabled: boolean;
  maxNotifications: number;
  showOnSessionStart: boolean;
};

export type SemanticMemoryConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  fallbackToMarkdown: boolean;
  autoConsolidate: boolean;
  projectMemory: ProjectMemoryConfig;
  rules: RulesConfig;
  agentMemory: AgentMemoryConfig;
  contextualAwareness: ContextualAwarenessConfig;
};

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;

export const semanticMemoryConfigSchema = {
  parse(value: unknown): SemanticMemoryConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("semantic memory config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      [
        "cortex",
        "agentNamespace",
        "fallbackToMarkdown",
        "autoConsolidate",
        "projectMemory",
        "rules",
        "agentMemory",
        "contextualAwareness",
      ],
      "semantic memory config",
    );

    const cortex = parseCortexConfig(cfg.cortex);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    // Parse projectMemory sub-config
    const pmRaw = cfg.projectMemory as Record<string, unknown> | undefined;
    const projectMemory: ProjectMemoryConfig = {
      enabled: pmRaw?.enabled !== false,
      autoDetect: pmRaw?.autoDetect !== false,
      maxConventions:
        typeof pmRaw?.maxConventions === "number" &&
        pmRaw.maxConventions > 0 &&
        pmRaw.maxConventions <= 1000
          ? pmRaw.maxConventions
          : 200,
    };

    // Parse rules sub-config
    const rulesRaw = cfg.rules as Record<string, unknown> | undefined;
    const rules: RulesConfig = {
      enabled: rulesRaw?.enabled !== false,
      maxRules:
        typeof rulesRaw?.maxRules === "number" && rulesRaw.maxRules > 0 && rulesRaw.maxRules <= 5000
          ? rulesRaw.maxRules
          : 500,
      injectIntoPrompt: rulesRaw?.injectIntoPrompt !== false,
      autoLearn: rulesRaw?.autoLearn === true,
    };

    // Parse agentMemory sub-config
    const amRaw = cfg.agentMemory as Record<string, unknown> | undefined;
    const agentMemory: AgentMemoryConfig = {
      enabled: amRaw?.enabled !== false,
      maxMemoriesPerAgent:
        typeof amRaw?.maxMemoriesPerAgent === "number" &&
        amRaw.maxMemoriesPerAgent > 0 &&
        amRaw.maxMemoriesPerAgent <= 5000
          ? amRaw.maxMemoriesPerAgent
          : 200,
      autoCapture: amRaw?.autoCapture !== false,
      pruneMinConfidence:
        typeof amRaw?.pruneMinConfidence === "number" &&
        amRaw.pruneMinConfidence >= 0 &&
        amRaw.pruneMinConfidence <= 1.0
          ? amRaw.pruneMinConfidence
          : 0.3,
    };

    // Parse contextualAwareness sub-config
    const caRaw = cfg.contextualAwareness as Record<string, unknown> | undefined;
    const contextualAwareness: ContextualAwarenessConfig = {
      enabled: caRaw?.enabled !== false,
      maxNotifications:
        typeof caRaw?.maxNotifications === "number" &&
        caRaw.maxNotifications > 0 &&
        caRaw.maxNotifications <= 50
          ? caRaw.maxNotifications
          : 5,
      showOnSessionStart: caRaw?.showOnSessionStart !== false,
    };

    return {
      cortex,
      agentNamespace,
      fallbackToMarkdown: cfg.fallbackToMarkdown !== false,
      autoConsolidate: cfg.autoConsolidate !== false,
      projectMemory,
      rules,
      agentMemory,
      contextualAwareness,
    };
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
    "cortex.binaryPath": {
      label: "Cortex Binary Path",
      placeholder: "/usr/local/bin/aingle-cortex",
      advanced: true,
      help: "Path to the aingle-cortex executable",
    },
    "cortex.autoStart": {
      label: "Auto-Start Cortex",
      help: "Automatically start the Cortex sidecar process",
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
    fallbackToMarkdown: {
      label: "Fallback to Markdown",
      help: "Use markdown memory files when Cortex is unavailable",
    },
    autoConsolidate: {
      label: "Auto-Consolidate",
      help: "Automatically consolidate short-term to long-term memory on compaction",
    },
    "projectMemory.enabled": {
      label: "Project Memory",
      help: "Enable project-level convention and decision tracking",
    },
    "projectMemory.autoDetect": {
      label: "Auto-Detect Conventions",
      help: "Automatically detect conventions and decisions from conversation",
    },
    "projectMemory.maxConventions": {
      label: "Max Conventions",
      help: "Maximum number of project conventions to store (default: 200)",
      advanced: true,
    },
    "rules.enabled": {
      label: "Rules Engine",
      help: "Enable Cortex-backed hierarchical rules engine",
    },
    "rules.maxRules": {
      label: "Max Rules",
      help: "Maximum number of rules to store (default: 500)",
      advanced: true,
    },
    "rules.injectIntoPrompt": {
      label: "Inject Rules into Prompt",
      help: "Automatically inject resolved rules into the system prompt",
    },
    "rules.autoLearn": {
      label: "Auto-Learn Rules",
      help: "Automatically propose rules from agent interactions (user must confirm)",
    },
    "agentMemory.enabled": {
      label: "Agent Memory",
      help: "Enable persistent per-agent memory via Cortex triples",
    },
    "agentMemory.maxMemoriesPerAgent": {
      label: "Max Memories per Agent",
      help: "Maximum number of memories per agent (default: 200)",
      advanced: true,
    },
    "agentMemory.autoCapture": {
      label: "Auto-Capture Memories",
      help: "Automatically store key learnings when agent sessions end",
    },
    "agentMemory.pruneMinConfidence": {
      label: "Prune Min Confidence",
      help: "Remove memories below this confidence threshold (default: 0.3)",
      advanced: true,
    },
    "contextualAwareness.enabled": {
      label: "Contextual Awareness",
      help: "Enable proactive Cortex-driven session notifications",
    },
    "contextualAwareness.maxNotifications": {
      label: "Max Notifications",
      help: "Maximum notifications per session start (default: 5)",
      advanced: true,
    },
    "contextualAwareness.showOnSessionStart": {
      label: "Show on Session Start",
      help: "Display notifications when a new session begins",
    },
  },
};

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

export type SemanticMemoryConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  fallbackToMarkdown: boolean;
  autoConsolidate: boolean;
  projectMemory: ProjectMemoryConfig;
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
      ["cortex", "agentNamespace", "fallbackToMarkdown", "autoConsolidate", "projectMemory"],
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

    return {
      cortex,
      agentNamespace,
      fallbackToMarkdown: cfg.fallbackToMarkdown !== false,
      autoConsolidate: cfg.autoConsolidate !== false,
      projectMemory,
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
  },
};

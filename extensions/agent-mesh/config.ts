import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";

export type { CortexConfig };

export type MeshConfig = {
  maxSharedNamespaces: number;
  delegationTimeout: number;
  autoMerge: boolean;
};

export type AgentMeshConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  mesh: MeshConfig;
};

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_MAX_SHARED_NAMESPACES = 50;
const DEFAULT_DELEGATION_TIMEOUT = 300;
const DEFAULT_AUTO_MERGE = true;

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

export const agentMeshConfigSchema = {
  parse(value: unknown): AgentMeshConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("agent mesh config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ["cortex", "agentNamespace", "mesh"], "agent mesh config");

    const cortex = parseCortexConfig(cfg.cortex);
    const mesh = parseMeshConfig(cfg.mesh);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    return { cortex, agentNamespace, mesh };
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
  },
};

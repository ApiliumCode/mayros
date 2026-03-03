/**
 * Interactive Permissions Configuration.
 *
 * Provides typed config parsing with manual validation (no Zod),
 * following the same pattern as other Mayros extensions.
 */

import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";

export type { CortexConfig };

// ============================================================================
// Types
// ============================================================================

export type InteractivePermissionsConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  autoApproveSafe: boolean;
  defaultDeny: boolean;
  maxStoredDecisions: number;
  policyEnabled: boolean;
};

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_AUTO_APPROVE_SAFE = true;
const DEFAULT_DENY = false;
const DEFAULT_MAX_STORED_DECISIONS = 500;
const DEFAULT_POLICY_ENABLED = true;

// ============================================================================
// Config Schema
// ============================================================================

export const interactivePermissionsConfigSchema = {
  parse(value: unknown): InteractivePermissionsConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) value = {};
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      [
        "cortex",
        "agentNamespace",
        "autoApproveSafe",
        "defaultDeny",
        "maxStoredDecisions",
        "policyEnabled",
      ],
      "interactive-permissions config",
    );

    const cortex = parseCortexConfig(cfg.cortex);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const autoApproveSafe =
      typeof cfg.autoApproveSafe === "boolean" ? cfg.autoApproveSafe : DEFAULT_AUTO_APPROVE_SAFE;

    const defaultDeny = typeof cfg.defaultDeny === "boolean" ? cfg.defaultDeny : DEFAULT_DENY;

    const maxStoredDecisions =
      typeof cfg.maxStoredDecisions === "number"
        ? Math.floor(cfg.maxStoredDecisions)
        : DEFAULT_MAX_STORED_DECISIONS;
    if (maxStoredDecisions < 1) {
      throw new Error("maxStoredDecisions must be at least 1");
    }
    if (maxStoredDecisions > 10000) {
      throw new Error("maxStoredDecisions must be at most 10000");
    }

    const policyEnabled =
      typeof cfg.policyEnabled === "boolean" ? cfg.policyEnabled : DEFAULT_POLICY_ENABLED;

    return {
      cortex,
      agentNamespace,
      autoApproveSafe,
      defaultDeny,
      maxStoredDecisions,
      policyEnabled,
    };
  },
  uiHints: {
    "cortex.host": {
      label: "Cortex Host",
      placeholder: "127.0.0.1",
      advanced: true,
      help: "Hostname where AIngle Cortex is listening",
    },
    "cortex.port": {
      label: "Cortex Port",
      placeholder: "8080",
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
      help: "RDF namespace prefix for permission data",
    },
    autoApproveSafe: {
      label: "Auto-Approve Safe Commands",
      help: "Automatically allow commands classified as safe risk level (ls, cat, grep, etc.)",
    },
    defaultDeny: {
      label: "Default Deny",
      help: "Deny unmatched tool calls when no policy applies and prompt is unavailable",
    },
    maxStoredDecisions: {
      label: "Max Stored Decisions",
      placeholder: String(DEFAULT_MAX_STORED_DECISIONS),
      advanced: true,
      help: "Maximum number of audit decisions stored in Cortex (1-10000)",
    },
    policyEnabled: {
      label: "Policy Persistence",
      help: "Enable persistent permission policies in Cortex",
    },
  },
};

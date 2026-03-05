/**
 * LSP Bridge Configuration.
 *
 * Manual parse(), assertAllowedKeys pattern.
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

export type LspServerConfig = {
  language: string;
  command: string;
  args: string[];
  rootUri?: string;
};

export type LspBridgeConfig = {
  cortex: CortexConfig;
  namespace: string;
  servers: LspServerConfig[];
  diagnosticSyncIntervalMs: number;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_DIAGNOSTIC_SYNC_INTERVAL_MS = 10_000;

// ============================================================================
// Parsers
// ============================================================================

function parseServerConfig(raw: unknown, index: number): LspServerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`servers[${index}] must be an object`);
  }
  const s = raw as Record<string, unknown>;
  assertAllowedKeys(s, ["language", "command", "args", "rootUri"], `servers[${index}]`);

  const language = typeof s.language === "string" ? s.language : "";
  if (!language) {
    throw new Error(`servers[${index}].language is required`);
  }

  const command = typeof s.command === "string" ? s.command : "";
  if (!command) {
    throw new Error(`servers[${index}].command is required`);
  }

  const args: string[] = [];
  if (Array.isArray(s.args)) {
    for (const a of s.args) {
      if (typeof a === "string") args.push(a);
    }
  }

  const server: LspServerConfig = { language, command, args };
  if (typeof s.rootUri === "string") server.rootUri = s.rootUri;

  return server;
}

// ============================================================================
// Schema
// ============================================================================

export const lspBridgeConfigSchema = {
  parse(value: unknown): LspBridgeConfig {
    const cfg = (value ?? {}) as Record<string, unknown>;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertAllowedKeys(
        cfg,
        ["cortex", "namespace", "servers", "diagnosticSyncIntervalMs"],
        "lsp-bridge config",
      );
    }

    const cortex = parseCortexConfig(cfg.cortex);

    const namespace = typeof cfg.namespace === "string" ? cfg.namespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(namespace)) {
      throw new Error(
        "namespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const servers: LspServerConfig[] = [];
    if (Array.isArray(cfg.servers)) {
      for (let i = 0; i < cfg.servers.length; i++) {
        servers.push(parseServerConfig(cfg.servers[i], i));
      }
    }

    const diagnosticSyncIntervalMs =
      typeof cfg.diagnosticSyncIntervalMs === "number"
        ? Math.floor(cfg.diagnosticSyncIntervalMs)
        : DEFAULT_DIAGNOSTIC_SYNC_INTERVAL_MS;

    return { cortex, namespace, servers, diagnosticSyncIntervalMs };
  },
};

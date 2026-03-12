/**
 * MCP Server Configuration.
 *
 * Manual parse(), assertAllowedKeys pattern — same as mcp-client/config.ts.
 * Defines transport, auth, and capability exposure settings.
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

export type McpServerTransportMode = "stdio" | "http";

export type McpServerAuthConfig = {
  /** Bearer token for HTTP transport. Empty = no auth. */
  token?: string;
  /** Allowed origin hosts for CORS (HTTP only). */
  allowedOrigins: string[];
};

export type McpServerCapabilities = {
  tools: boolean;
  resources: boolean;
  prompts: boolean;
};

export type McpServerConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  transport: McpServerTransportMode;
  port: number;
  host: string;
  auth: McpServerAuthConfig;
  capabilities: McpServerCapabilities;
  serverName: string;
  serverVersion: string;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_TRANSPORT: McpServerTransportMode = "stdio";
const DEFAULT_PORT = 19100;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SERVER_NAME = "mayros";
const DEFAULT_SERVER_VERSION = "0.1.0";

const VALID_TRANSPORTS = new Set<McpServerTransportMode>(["stdio", "http"]);

// ============================================================================
// Parser
// ============================================================================

function parseAuthConfig(raw: unknown): McpServerAuthConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { allowedOrigins: [] };
  }
  const a = raw as Record<string, unknown>;
  assertAllowedKeys(a, ["token", "allowedOrigins"], "auth config");

  const auth: McpServerAuthConfig = { allowedOrigins: [] };
  if (typeof a.token === "string" && a.token.length > 0) {
    auth.token = a.token;
  }
  if (Array.isArray(a.allowedOrigins)) {
    auth.allowedOrigins = a.allowedOrigins.filter((o): o is string => typeof o === "string");
  }
  return auth;
}

function parseCapabilities(raw: unknown): McpServerCapabilities {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { tools: true, resources: true, prompts: true };
  }
  const c = raw as Record<string, unknown>;
  assertAllowedKeys(c, ["tools", "resources", "prompts"], "capabilities config");

  return {
    tools: c.tools !== false,
    resources: c.resources !== false,
    prompts: c.prompts !== false,
  };
}

export const mcpServerConfigSchema = {
  parse(value: unknown): McpServerConfig {
    const cfg = (value ?? {}) as Record<string, unknown>;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertAllowedKeys(
        cfg,
        [
          "cortex",
          "agentNamespace",
          "transport",
          "port",
          "host",
          "auth",
          "capabilities",
          "serverName",
          "serverVersion",
        ],
        "mcp-server config",
      );
    }

    const cortex = parseCortexConfig(cfg.cortex);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const transport =
      typeof cfg.transport === "string" &&
      VALID_TRANSPORTS.has(cfg.transport as McpServerTransportMode)
        ? (cfg.transport as McpServerTransportMode)
        : DEFAULT_TRANSPORT;

    const port = typeof cfg.port === "number" ? Math.floor(cfg.port) : DEFAULT_PORT;
    if (port < 1 || port > 65535) {
      throw new Error("port must be between 1 and 65535");
    }

    const host = typeof cfg.host === "string" ? cfg.host : DEFAULT_HOST;
    if (!/^[a-zA-Z0-9._-]+$/.test(host)) {
      throw new Error(
        `Invalid host: "${host}". Must contain only alphanumeric, dots, hyphens, or underscores.`,
      );
    }

    const auth = parseAuthConfig(cfg.auth);
    const capabilities = parseCapabilities(cfg.capabilities);

    const serverName = typeof cfg.serverName === "string" ? cfg.serverName : DEFAULT_SERVER_NAME;
    const serverVersion =
      typeof cfg.serverVersion === "string" ? cfg.serverVersion : DEFAULT_SERVER_VERSION;

    return {
      cortex,
      agentNamespace,
      transport,
      port,
      host,
      auth,
      capabilities,
      serverName,
      serverVersion,
    };
  },
};

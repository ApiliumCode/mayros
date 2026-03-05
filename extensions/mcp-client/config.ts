/**
 * MCP Client Configuration.
 *
 * Manual parse(), assertAllowedKeys pattern — same as agent-mesh/config.ts.
 * Defines server connection configs, transport types, and top-level settings.
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

export type McpTransportType = "stdio" | "sse" | "http" | "websocket";

export type McpTransportConfig = {
  type: McpTransportType;
  command?: string;
  args?: string[];
  url?: string;
  authToken?: string;
  oauthClientId?: string;
};

export type McpServerConfig = {
  id: string;
  name?: string;
  transport: McpTransportConfig;
  autoConnect: boolean;
  toolPrefix?: string;
  defaultToolKind?: string;
};

export type McpClientConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  servers: McpServerConfig[];
  registerInCortex: boolean;
  maxReconnectAttempts: number;
  reconnectDelayMs: number;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_REGISTER_IN_CORTEX = true;
const DEFAULT_MAX_RECONNECT_ATTEMPTS = 5;
const DEFAULT_RECONNECT_DELAY_MS = 3000;

const VALID_TRANSPORT_TYPES = new Set<McpTransportType>(["stdio", "sse", "http", "websocket"]);

// ============================================================================
// Parsers
// ============================================================================

function parseTransportConfig(raw: unknown): McpTransportConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error("transport config must be an object");
  }
  const t = raw as Record<string, unknown>;
  assertAllowedKeys(
    t,
    ["type", "command", "args", "url", "authToken", "oauthClientId"],
    "transport config",
  );

  const type = typeof t.type === "string" ? t.type : "";
  if (!VALID_TRANSPORT_TYPES.has(type as McpTransportType)) {
    throw new Error(
      `transport.type must be one of: ${[...VALID_TRANSPORT_TYPES].join(", ")} (got "${type}")`,
    );
  }

  const transport: McpTransportConfig = { type: type as McpTransportType };

  if (typeof t.command === "string") transport.command = t.command;
  if (Array.isArray(t.args)) {
    transport.args = t.args.filter((a): a is string => typeof a === "string");
  }
  if (typeof t.url === "string") transport.url = t.url;
  if (typeof t.authToken === "string") transport.authToken = t.authToken;
  if (typeof t.oauthClientId === "string") transport.oauthClientId = t.oauthClientId;

  // Validate transport-specific requirements
  if (type === "stdio" && !transport.command) {
    throw new Error("stdio transport requires a command");
  }
  if ((type === "sse" || type === "http" || type === "websocket") && !transport.url) {
    throw new Error(`${type} transport requires a url`);
  }

  return transport;
}

function parseServerConfig(raw: unknown, index: number): McpServerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new Error(`servers[${index}] must be an object`);
  }
  const s = raw as Record<string, unknown>;
  assertAllowedKeys(
    s,
    ["id", "name", "transport", "autoConnect", "toolPrefix", "defaultToolKind"],
    `servers[${index}]`,
  );

  const id = typeof s.id === "string" ? s.id : "";
  if (!id) {
    throw new Error(`servers[${index}].id is required`);
  }
  if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(id)) {
    throw new Error(
      `servers[${index}].id must start with a letter and contain only letters, digits, hyphens, or underscores`,
    );
  }

  const transport = parseTransportConfig(s.transport);
  const autoConnect = s.autoConnect === true;

  const server: McpServerConfig = { id, transport, autoConnect };
  if (typeof s.name === "string") server.name = s.name;
  if (typeof s.toolPrefix === "string") server.toolPrefix = s.toolPrefix;
  if (typeof s.defaultToolKind === "string") server.defaultToolKind = s.defaultToolKind;

  return server;
}

// ============================================================================
// Schema
// ============================================================================

export const mcpClientConfigSchema = {
  parse(value: unknown): McpClientConfig {
    const cfg = (value ?? {}) as Record<string, unknown>;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertAllowedKeys(
        cfg,
        [
          "cortex",
          "agentNamespace",
          "servers",
          "registerInCortex",
          "maxReconnectAttempts",
          "reconnectDelayMs",
        ],
        "mcp-client config",
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

    const servers: McpServerConfig[] = [];
    if (Array.isArray(cfg.servers)) {
      for (let i = 0; i < cfg.servers.length; i++) {
        servers.push(parseServerConfig(cfg.servers[i], i));
      }
    }

    const registerInCortex =
      typeof cfg.registerInCortex === "boolean" ? cfg.registerInCortex : DEFAULT_REGISTER_IN_CORTEX;

    const maxReconnectAttempts =
      typeof cfg.maxReconnectAttempts === "number"
        ? Math.floor(cfg.maxReconnectAttempts)
        : DEFAULT_MAX_RECONNECT_ATTEMPTS;
    if (maxReconnectAttempts < 0) {
      throw new Error("maxReconnectAttempts must be >= 0");
    }

    const reconnectDelayMs =
      typeof cfg.reconnectDelayMs === "number"
        ? Math.floor(cfg.reconnectDelayMs)
        : DEFAULT_RECONNECT_DELAY_MS;
    if (reconnectDelayMs < 100) {
      throw new Error("reconnectDelayMs must be >= 100");
    }

    return {
      cortex,
      agentNamespace,
      servers,
      registerInCortex,
      maxReconnectAttempts,
      reconnectDelayMs,
    };
  },
};

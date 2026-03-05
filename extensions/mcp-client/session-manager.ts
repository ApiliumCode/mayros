/**
 * MCP Session Manager.
 *
 * Manages server lifecycle: connect, disconnect, reconnect, health tracking.
 * Supports exponential backoff reconnection and Cortex registry integration.
 */

import type { McpClientConfig, McpServerConfig, McpTransportType } from "./config.js";
import type { McpCortexRegistry } from "./cortex-registry.js";
import { createTransport, type McpToolDescriptor, type McpTransport } from "./transport.js";

// ============================================================================
// Types
// ============================================================================

export type McpConnectionStatus = "connecting" | "connected" | "disconnected" | "error";

export type McpConnection = {
  serverId: string;
  transport: McpTransportType;
  status: McpConnectionStatus;
  tools: McpToolDescriptor[];
  lastError?: string;
  connectedAt?: string;
  reconnectAttempts: number;
};

export type SessionLogger = {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
};

// ============================================================================
// SessionManager
// ============================================================================

export class SessionManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly transports = new Map<string, McpTransport>();

  constructor(
    private readonly config: McpClientConfig,
    private readonly registry?: McpCortexRegistry,
    private readonly logger?: SessionLogger,
  ) {}

  /**
   * Connect to an MCP server by ID. Returns the connection state.
   */
  async connect(serverId: string): Promise<McpConnection> {
    const serverConfig = this.findServerConfig(serverId);
    if (!serverConfig) {
      throw new Error(`Server "${serverId}" not found in configuration`);
    }

    // Check for existing connection
    const existing = this.connections.get(serverId);
    if (existing?.status === "connected") {
      return existing;
    }

    const connection: McpConnection = {
      serverId,
      transport: serverConfig.transport.type,
      status: "connecting",
      tools: [],
      reconnectAttempts: 0,
    };
    this.connections.set(serverId, connection);

    try {
      const transport = createTransport(serverConfig.transport);
      this.transports.set(serverId, transport);

      await transport.connect();

      // List available tools
      const tools = await transport.listTools();

      connection.status = "connected";
      connection.tools = tools;
      connection.connectedAt = new Date().toISOString();
      connection.reconnectAttempts = 0;
      connection.lastError = undefined;

      this.logger?.info(`mcp-client: connected to ${serverId} (${tools.length} tools available)`);

      // Register in Cortex if enabled
      if (this.registry) {
        try {
          await this.registry.registerServer(serverId, {
            name: serverConfig.name,
            transport: serverConfig.transport.type,
            toolCount: tools.length,
          });
        } catch (err) {
          this.logger?.warn(`mcp-client: failed to register server in Cortex: ${String(err)}`);
        }
      }

      return connection;
    } catch (err) {
      connection.status = "error";
      connection.lastError = String(err);
      this.logger?.error(`mcp-client: failed to connect to ${serverId}: ${String(err)}`);
      throw err;
    }
  }

  /**
   * Disconnect from an MCP server.
   */
  async disconnect(serverId: string): Promise<void> {
    const transport = this.transports.get(serverId);
    if (transport) {
      try {
        await transport.disconnect();
      } catch (err) {
        this.logger?.warn(`mcp-client: error disconnecting ${serverId}: ${String(err)}`);
      }
      this.transports.delete(serverId);
    }

    const connection = this.connections.get(serverId);
    if (connection) {
      connection.status = "disconnected";
      connection.tools = [];
    }

    // Unregister from Cortex
    if (this.registry) {
      try {
        await this.registry.unregisterServer(serverId);
      } catch (err) {
        this.logger?.warn(`mcp-client: failed to unregister server from Cortex: ${String(err)}`);
      }
    }

    this.logger?.info(`mcp-client: disconnected from ${serverId}`);
  }

  /**
   * Disconnect all connected servers.
   */
  async disconnectAll(): Promise<void> {
    const serverIds = [...this.connections.keys()];
    for (const serverId of serverIds) {
      await this.disconnect(serverId);
    }
  }

  /**
   * Attempt to reconnect to a server with exponential backoff.
   */
  async reconnect(serverId: string): Promise<McpConnection> {
    const connection = this.connections.get(serverId);
    const attempts = connection?.reconnectAttempts ?? 0;

    if (attempts >= this.config.maxReconnectAttempts) {
      const msg = `mcp-client: max reconnect attempts (${this.config.maxReconnectAttempts}) reached for ${serverId}`;
      this.logger?.error(msg);
      if (connection) {
        connection.status = "error";
        connection.lastError = msg;
      }
      throw new Error(msg);
    }

    // Exponential backoff
    const delay = this.config.reconnectDelayMs * Math.pow(2, attempts);
    this.logger?.info(
      `mcp-client: reconnecting to ${serverId} in ${delay}ms (attempt ${attempts + 1}/${this.config.maxReconnectAttempts})`,
    );

    await new Promise((resolve) => setTimeout(resolve, delay));

    // Clean up old transport
    const oldTransport = this.transports.get(serverId);
    if (oldTransport) {
      try {
        await oldTransport.disconnect();
      } catch {
        // Ignore disconnect errors during reconnection
      }
      this.transports.delete(serverId);
    }

    // Update attempt counter before connecting
    if (connection) {
      connection.reconnectAttempts = attempts + 1;
    }

    try {
      return await this.connect(serverId);
    } catch (err) {
      if (connection) {
        connection.reconnectAttempts = attempts + 1;
      }
      throw err;
    }
  }

  /**
   * Get connection state for a server.
   */
  getConnection(serverId: string): McpConnection | undefined {
    return this.connections.get(serverId);
  }

  /**
   * List all connections.
   */
  listConnections(): McpConnection[] {
    return [...this.connections.values()];
  }

  /**
   * Get the transport instance for a server.
   */
  getTransport(serverId: string): McpTransport | undefined {
    return this.transports.get(serverId);
  }

  /**
   * Auto-connect to all servers marked with autoConnect: true.
   */
  async autoConnectAll(): Promise<void> {
    const autoServers = this.config.servers.filter((s) => s.autoConnect);
    for (const server of autoServers) {
      try {
        await this.connect(server.id);
      } catch (err) {
        this.logger?.warn(`mcp-client: auto-connect failed for ${server.id}: ${String(err)}`);
      }
    }
  }

  // ---------- internal helpers ----------

  private findServerConfig(serverId: string): McpServerConfig | undefined {
    return this.config.servers.find((s) => s.id === serverId);
  }
}

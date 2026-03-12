/**
 * MCP Server Core.
 *
 * Orchestrates the protocol dispatcher, tool adapter, resource provider,
 * and prompt provider into a unified MCP server that can be started
 * with either stdio or HTTP transport.
 */

import type { McpServerConfig } from "./config.js";
import { McpProtocolDispatcher, type McpCapabilities, type McpHandlers } from "./protocol.js";
import { McpToolAdapter, type AdaptableTool } from "./tool-adapter.js";
import { McpResourceProvider, type ResourceDataSources } from "./resource-provider.js";
import { McpPromptProvider, type PromptDataSources } from "./prompt-provider.js";
import { McpStdioTransport } from "./transport-stdio.js";
import { McpHttpTransport } from "./transport-http.js";

// ============================================================================
// Types
// ============================================================================

export type McpServerOptions = {
  config: McpServerConfig;
  tools: AdaptableTool[];
  resourceSources: ResourceDataSources;
  promptSources: PromptDataSources;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
    error: (msg: string) => void;
  };
};

export type McpServerStatus = {
  running: boolean;
  transport: "stdio" | "http";
  address?: string;
  toolCount: number;
  initialized: boolean;
};

// ============================================================================
// Server
// ============================================================================

export class McpServer {
  private readonly config: McpServerConfig;
  private readonly toolAdapter: McpToolAdapter;
  private readonly resourceProvider: McpResourceProvider;
  private readonly promptProvider: McpPromptProvider;
  private readonly dispatcher: McpProtocolDispatcher;
  private readonly logger: NonNullable<McpServerOptions["logger"]>;

  private stdioTransport: McpStdioTransport | null = null;
  private httpTransport: McpHttpTransport | null = null;

  constructor(options: McpServerOptions) {
    this.config = options.config;
    this.logger = options.logger ?? {
      info: () => {},
      warn: () => {},
      error: () => {},
    };

    // Initialize providers
    this.toolAdapter = new McpToolAdapter();
    this.toolAdapter.registerTools(options.tools);

    this.resourceProvider = new McpResourceProvider(options.resourceSources);
    this.promptProvider = new McpPromptProvider(options.promptSources);

    // Build capabilities
    const capabilities: McpCapabilities = {};
    if (this.config.capabilities.tools) {
      capabilities.tools = {};
    }
    if (this.config.capabilities.resources) {
      capabilities.resources = {};
    }
    if (this.config.capabilities.prompts) {
      capabilities.prompts = {};
    }

    // Build handlers
    const handlers: McpHandlers = {
      listTools: () => Promise.resolve(this.toolAdapter.listTools()),
      callTool: (name, args) => this.toolAdapter.callTool(name, args),
      listResources: () => this.resourceProvider.listResources(),
      readResource: (uri) => this.resourceProvider.readResource(uri),
      listPrompts: () => Promise.resolve(this.promptProvider.listPrompts()),
      getPrompt: (name, args) => this.promptProvider.getPrompt(name, args),
    };

    // Create dispatcher
    this.dispatcher = new McpProtocolDispatcher({
      serverInfo: {
        name: this.config.serverName,
        version: this.config.serverVersion,
      },
      capabilities,
      handlers,
    });
  }

  /** Start the server with the configured transport. */
  async start(): Promise<void> {
    if (this.config.transport === "stdio") {
      await this.startStdio();
    } else {
      await this.startHttp();
    }
  }

  /** Stop the server. */
  async stop(): Promise<void> {
    if (this.stdioTransport) {
      this.stdioTransport.stop();
      this.stdioTransport = null;
    }
    if (this.httpTransport) {
      await this.httpTransport.stop();
      this.httpTransport = null;
    }
  }

  /** Get current server status. */
  status(): McpServerStatus {
    const running = this.isRunning();
    return {
      running,
      transport: this.config.transport,
      address: this.httpTransport?.getAddress(),
      toolCount: this.toolAdapter.listToolNames().length,
      initialized: this.dispatcher.isInitialized(),
    };
  }

  /** Check if server is running. */
  isRunning(): boolean {
    if (this.stdioTransport) return this.stdioTransport.isRunning();
    if (this.httpTransport) return this.httpTransport.isRunning();
    return false;
  }

  /** Get the tool adapter for dynamic tool registration. */
  getToolAdapter(): McpToolAdapter {
    return this.toolAdapter;
  }

  /** Get the resource provider for dynamic source updates. */
  getResourceProvider(): McpResourceProvider {
    return this.resourceProvider;
  }

  /** Get the prompt provider for dynamic source updates. */
  getPromptProvider(): McpPromptProvider {
    return this.promptProvider;
  }

  /** Get the protocol dispatcher (for testing). */
  getDispatcher(): McpProtocolDispatcher {
    return this.dispatcher;
  }

  // ── Transport starters ──────────────────────────────────────────────

  private async startStdio(): Promise<void> {
    this.stdioTransport = new McpStdioTransport({
      dispatcher: this.dispatcher,
      onError: (err) => {
        this.logger.error(`[mcp-server:stdio] ${err.message}`);
      },
      onClose: () => {
        this.logger.info("[mcp-server:stdio] Connection closed");
      },
    });

    this.stdioTransport.start();
    this.logger.info(
      `[mcp-server] Stdio transport started (${this.toolAdapter.listToolNames().length} tools)`,
    );
  }

  private async startHttp(): Promise<void> {
    const cortexHealthUrl = `http://${this.config.cortex.host}:${this.config.cortex.port}/api/v1/health`;
    this.httpTransport = new McpHttpTransport({
      dispatcher: this.dispatcher,
      port: this.config.port,
      host: this.config.host,
      authToken: this.config.auth.token,
      allowedOrigins: this.config.auth.allowedOrigins,
      cortexHealthUrl,
      onError: (err) => {
        this.logger.error(`[mcp-server:http] ${err.message}`);
      },
      onRequest: (method, path) => {
        this.logger.info(`[mcp-server:http] ${method} ${path}`);
      },
    });

    await this.httpTransport.start();
    this.logger.info(
      `[mcp-server] HTTP transport started at ${this.httpTransport.getAddress()}/mcp (${this.toolAdapter.listToolNames().length} tools)`,
    );
  }
}

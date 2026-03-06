/**
 * MCP Protocol — Server-side JSON-RPC 2.0 dispatcher.
 *
 * Implements the MCP specification:
 *   - initialize / initialized handshake
 *   - tools/list, tools/call
 *   - resources/list, resources/read
 *   - prompts/list, prompts/get
 *   - ping
 *   - notifications/initialized (client → server)
 *
 * Protocol version: 2025-03-26 (latest MCP spec)
 */

// ============================================================================
// JSON-RPC 2.0 Types
// ============================================================================

export type JsonRpcRequest = {
  jsonrpc: "2.0";
  id?: string | number;
  method: string;
  params?: Record<string, unknown>;
};

export type JsonRpcResponse = {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
};

export type JsonRpcError = {
  code: number;
  message: string;
  data?: unknown;
};

export type JsonRpcNotification = {
  jsonrpc: "2.0";
  method: string;
  params?: Record<string, unknown>;
};

// ============================================================================
// MCP Types
// ============================================================================

export const MCP_PROTOCOL_VERSION = "2025-03-26";

export type McpServerInfo = {
  name: string;
  version: string;
};

export type McpCapabilities = {
  tools?: Record<string, never>;
  resources?: Record<string, never>;
  prompts?: Record<string, never>;
};

export type McpToolDef = {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
};

export type McpResourceDef = {
  uri: string;
  name: string;
  description?: string;
  mimeType?: string;
};

export type McpResourceContents = {
  uri: string;
  mimeType?: string;
  text?: string;
  blob?: string;
};

export type McpPromptDef = {
  name: string;
  description?: string;
  arguments?: McpPromptArgument[];
};

export type McpPromptArgument = {
  name: string;
  description?: string;
  required?: boolean;
};

export type McpPromptMessage = {
  role: "user" | "assistant";
  content: { type: "text"; text: string };
};

export type McpToolResult = {
  content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
  isError?: boolean;
};

// ============================================================================
// Error Codes (JSON-RPC 2.0 + MCP)
// ============================================================================

export const ErrorCodes = {
  PARSE_ERROR: -32700,
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  // MCP-specific
  RESOURCE_NOT_FOUND: -32002,
  TOOL_NOT_FOUND: -32003,
  PROMPT_NOT_FOUND: -32004,
} as const;

// ============================================================================
// Handler Types
// ============================================================================

export type ToolListHandler = () => Promise<McpToolDef[]>;
export type ToolCallHandler = (
  name: string,
  args: Record<string, unknown>,
) => Promise<McpToolResult>;
export type ResourceListHandler = () => Promise<McpResourceDef[]>;
export type ResourceReadHandler = (uri: string) => Promise<McpResourceContents>;
export type PromptListHandler = () => Promise<McpPromptDef[]>;
export type PromptGetHandler = (
  name: string,
  args: Record<string, string>,
) => Promise<McpPromptMessage[]>;

export type McpHandlers = {
  listTools: ToolListHandler;
  callTool: ToolCallHandler;
  listResources: ResourceListHandler;
  readResource: ResourceReadHandler;
  listPrompts: PromptListHandler;
  getPrompt: PromptGetHandler;
};

// ============================================================================
// Protocol Dispatcher
// ============================================================================

export type McpDispatcherOptions = {
  serverInfo: McpServerInfo;
  capabilities: McpCapabilities;
  handlers: McpHandlers;
};

export class McpProtocolDispatcher {
  private readonly serverInfo: McpServerInfo;
  private readonly capabilities: McpCapabilities;
  private readonly handlers: McpHandlers;
  private initialized = false;

  constructor(options: McpDispatcherOptions) {
    this.serverInfo = options.serverInfo;
    this.capabilities = options.capabilities;
    this.handlers = options.handlers;
  }

  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Parse and dispatch a raw JSON string. Returns the response to send,
   * or null for notifications that require no response.
   */
  async handleMessage(raw: string): Promise<string | null> {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return JSON.stringify(this.errorResponse(null, ErrorCodes.PARSE_ERROR, "Parse error"));
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return JSON.stringify(
        this.errorResponse(null, ErrorCodes.INVALID_REQUEST, "Invalid Request"),
      );
    }

    const msg = parsed as Record<string, unknown>;

    if (msg.jsonrpc !== "2.0") {
      return JSON.stringify(
        this.errorResponse(null, ErrorCodes.INVALID_REQUEST, "Missing jsonrpc 2.0"),
      );
    }

    const method = msg.method as string | undefined;
    const id = msg.id as string | number | undefined;
    const params = (msg.params ?? {}) as Record<string, unknown>;

    // Notifications (no id) — no response needed
    if (id === undefined || id === null) {
      if (method === "notifications/initialized") {
        // Client acknowledged initialization — nothing to do
      }
      return null;
    }

    if (typeof method !== "string") {
      return JSON.stringify(this.errorResponse(id, ErrorCodes.INVALID_REQUEST, "Missing method"));
    }

    try {
      const result = await this.dispatch(method, params);
      return JSON.stringify(this.successResponse(id, result));
    } catch (err) {
      if (err instanceof McpError) {
        return JSON.stringify(this.errorResponse(id, err.code, err.message, err.data));
      }
      return JSON.stringify(this.errorResponse(id, ErrorCodes.INTERNAL_ERROR, String(err)));
    }
  }

  // ── Internal dispatch ───────────────────────────────────────────────

  private async dispatch(method: string, params: Record<string, unknown>): Promise<unknown> {
    switch (method) {
      case "initialize":
        return this.handleInitialize();

      case "ping":
        return {};

      case "tools/list":
        this.requireInitialized();
        return this.handleToolsList();

      case "tools/call":
        this.requireInitialized();
        return this.handleToolsCall(params);

      case "resources/list":
        this.requireInitialized();
        return this.handleResourcesList();

      case "resources/read":
        this.requireInitialized();
        return this.handleResourcesRead(params);

      case "prompts/list":
        this.requireInitialized();
        return this.handlePromptsList();

      case "prompts/get":
        this.requireInitialized();
        return this.handlePromptsGet(params);

      default:
        throw new McpError(ErrorCodes.METHOD_NOT_FOUND, `Unknown method: ${method}`);
    }
  }

  private handleInitialize(): unknown {
    this.initialized = true;
    return {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: this.capabilities,
      serverInfo: this.serverInfo,
    };
  }

  private async handleToolsList(): Promise<unknown> {
    const tools = await this.handlers.listTools();
    return { tools };
  }

  private async handleToolsCall(params: Record<string, unknown>): Promise<unknown> {
    const name = params.name as string | undefined;
    if (!name || typeof name !== "string") {
      throw new McpError(ErrorCodes.INVALID_PARAMS, "Missing tool name");
    }
    const args = (params.arguments ?? {}) as Record<string, unknown>;
    return await this.handlers.callTool(name, args);
  }

  private async handleResourcesList(): Promise<unknown> {
    const resources = await this.handlers.listResources();
    return { resources };
  }

  private async handleResourcesRead(params: Record<string, unknown>): Promise<unknown> {
    const uri = params.uri as string | undefined;
    if (!uri || typeof uri !== "string") {
      throw new McpError(ErrorCodes.INVALID_PARAMS, "Missing resource uri");
    }
    const contents = await this.handlers.readResource(uri);
    return { contents: [contents] };
  }

  private async handlePromptsList(): Promise<unknown> {
    const prompts = await this.handlers.listPrompts();
    return { prompts };
  }

  private async handlePromptsGet(params: Record<string, unknown>): Promise<unknown> {
    const name = params.name as string | undefined;
    if (!name || typeof name !== "string") {
      throw new McpError(ErrorCodes.INVALID_PARAMS, "Missing prompt name");
    }
    const args = (params.arguments ?? {}) as Record<string, string>;
    const messages = await this.handlers.getPrompt(name, args);
    return { description: `Prompt: ${name}`, messages };
  }

  // ── Helpers ─────────────────────────────────────────────────────────

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new McpError(ErrorCodes.INTERNAL_ERROR, "Server not initialized");
    }
  }

  private successResponse(id: string | number, result: unknown): JsonRpcResponse {
    return { jsonrpc: "2.0", id, result };
  }

  private errorResponse(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcResponse {
    return { jsonrpc: "2.0", id, error: { code, message, data } };
  }
}

// ============================================================================
// Error class
// ============================================================================

export class McpError extends Error {
  readonly code: number;
  readonly data?: unknown;

  constructor(code: number, message: string, data?: unknown) {
    super(message);
    this.name = "McpError";
    this.code = code;
    this.data = data;
  }
}

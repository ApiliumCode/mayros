/**
 * MCP Tool Adapter.
 *
 * Bridges the Mayros tool registry (AnyAgentTool from pi-agent-core) into
 * MCP tool descriptors and handles tool call execution.
 *
 * The adapter discovers tools from the loaded plugin registry and converts
 * their TypeBox parameter schemas into JSON Schema for MCP clients.
 */

import type { McpToolDef, McpToolResult } from "./protocol.js";

// ============================================================================
// Types
// ============================================================================

/** Minimal tool interface matching AnyAgentTool from pi-agent-core. */
export type AdaptableTool = {
  name: string;
  label?: string;
  description?: string;
  parameters?: unknown;
  execute: (
    toolCallId: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ) => Promise<{ content: Array<{ type: string; text?: string }>; details?: unknown }>;
};

// ============================================================================
// Schema conversion
// ============================================================================

/**
 * Convert a TypeBox schema into a plain JSON Schema object.
 * TypeBox schemas are JSON Schema-compatible, so we strip internal
 * TypeBox symbols and keep the standard JSON Schema properties.
 */
export function typeBoxToJsonSchema(schema: unknown): Record<string, unknown> {
  if (!schema || typeof schema !== "object") {
    return { type: "object", properties: {} };
  }

  const raw = schema as Record<string, unknown>;
  const result: Record<string, unknown> = {};

  // Copy standard JSON Schema properties
  const STANDARD_KEYS = [
    "type",
    "properties",
    "required",
    "items",
    "description",
    "enum",
    "minimum",
    "maximum",
    "minLength",
    "maxLength",
    "default",
    "additionalProperties",
  ];

  for (const key of STANDARD_KEYS) {
    if (key in raw) {
      if (key === "properties" && typeof raw.properties === "object" && raw.properties !== null) {
        const props: Record<string, unknown> = {};
        for (const [propName, propSchema] of Object.entries(
          raw.properties as Record<string, unknown>,
        )) {
          props[propName] = typeBoxToJsonSchema(propSchema);
        }
        result.properties = props;
      } else if (key === "items" && raw.items) {
        result.items = typeBoxToJsonSchema(raw.items);
      } else {
        result[key] = raw[key];
      }
    }
  }

  // Ensure type: "object" for objects without explicit type
  if (!result.type && result.properties) {
    result.type = "object";
  }

  return result;
}

// ============================================================================
// Tool Adapter
// ============================================================================

/** Tool names to exclude from MCP exposure (internal-only tools). */
const EXCLUDED_TOOLS = new Set([
  "mcp_connect",
  "mcp_disconnect",
  "mcp_list_tools",
  "mcp_call_tool",
]);

export class McpToolAdapter {
  private tools = new Map<string, AdaptableTool>();

  /** Register tools from the Mayros plugin registry. */
  registerTools(tools: AdaptableTool[]): void {
    for (const tool of tools) {
      if (EXCLUDED_TOOLS.has(tool.name)) {
        continue;
      }
      this.tools.set(tool.name, tool);
    }
  }

  /** Clear all registered tools. */
  clear(): void {
    this.tools.clear();
  }

  /** List all registered tool names. */
  listToolNames(): string[] {
    return [...this.tools.keys()];
  }

  /** Convert registered tools to MCP tool definitions. */
  listTools(): McpToolDef[] {
    const result: McpToolDef[] = [];
    for (const tool of this.tools.values()) {
      result.push({
        name: tool.name,
        description: tool.description ?? tool.label ?? `Mayros tool: ${tool.name}`,
        inputSchema: typeBoxToJsonSchema(tool.parameters),
      });
    }
    return result;
  }

  /** Execute a tool call and return MCP-compatible result. */
  async callTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const tool = this.tools.get(name);
    if (!tool) {
      return {
        content: [{ type: "text", text: `Tool not found: ${name}` }],
        isError: true,
      };
    }

    try {
      const callId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const result = await tool.execute(callId, args);

      const content: McpToolResult["content"] = [];
      for (const item of result.content) {
        if (item.type === "text" && item.text) {
          content.push({ type: "text", text: item.text });
        } else if (item.type === "image" && "data" in item) {
          const img = item as { data: string; mimeType?: string };
          content.push({
            type: "image",
            data: img.data,
            mimeType: img.mimeType ?? "image/png",
          });
        } else {
          content.push({ type: "text", text: JSON.stringify(item) });
        }
      }

      if (content.length === 0) {
        content.push({ type: "text", text: "(empty result)" });
      }

      return { content };
    } catch (err) {
      return {
        content: [{ type: "text", text: `Tool execution failed: ${String(err)}` }],
        isError: true,
      };
    }
  }
}

/**
 * Tool definition utilities for the Mayros Agent SDK.
 */

import type { ToolResult } from "./types.js";

export type ToolExecuteContext = {
  callId: string;
  signal?: AbortSignal;
};

export type ToolDefinition = {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  execute: (args: Record<string, unknown>, ctx: ToolExecuteContext) => Promise<ToolResult>;
};

/**
 * Define a tool with typed parameters.
 *
 * @example
 * ```typescript
 * const readFile = defineTool({
 *   name: "read_file",
 *   description: "Read a file from disk",
 *   parameters: {
 *     type: "object",
 *     properties: {
 *       path: { type: "string", description: "File path" },
 *     },
 *     required: ["path"],
 *   },
 *   execute: async (args) => {
 *     const content = await fs.readFile(args.path as string, "utf-8");
 *     return { content: [{ type: "text", text: content }] };
 *   },
 * });
 * ```
 */
export function defineTool(def: ToolDefinition): ToolDefinition {
  return def;
}

/**
 * Create a text-only tool result.
 */
export function textResult(text: string): ToolResult {
  return { content: [{ type: "text", text }] };
}

/**
 * Create an error tool result.
 */
export function errorResult(message: string): ToolResult {
  return {
    content: [{ type: "text", text: `Error: ${message}` }],
    isError: true,
  };
}

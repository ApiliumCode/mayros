/**
 * @apilium/mayros-sdk
 *
 * Build custom AI agents with the Mayros runtime.
 *
 * @example
 * ```typescript
 * import { createAgent, defineTool } from "@apilium/mayros-sdk";
 *
 * const agent = createAgent({
 *   id: "my-agent",
 *   name: "My Agent",
 *   model: "anthropic/claude-sonnet-4-20250514",
 *   tools: [myTool],
 * });
 *
 * const result = await agent.run("Hello, agent!");
 * ```
 */

export { createAgent, type AgentConfig, type AgentRunResult } from "./agent.js";
export { defineTool, type ToolDefinition, type ToolExecuteContext } from "./tools.js";
export { type Message, type ToolCall, type ToolResult } from "./types.js";

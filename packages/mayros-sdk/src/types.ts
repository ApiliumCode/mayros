/**
 * Core types for the Mayros Agent SDK.
 */

export type Message = {
  role: "user" | "assistant" | "system" | "tool";
  content: string | ContentPart[];
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
};

export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

export type ToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
};

export type ToolResult = {
  content: ContentPart[];
  details?: unknown;
  isError?: boolean;
};

export type ModelConfig = {
  provider: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  thinking?: boolean;
};

export type AgentEvent =
  | { type: "message"; message: Message }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; callId: string; result: ToolResult }
  | { type: "error"; error: string }
  | { type: "done"; messages: Message[] };

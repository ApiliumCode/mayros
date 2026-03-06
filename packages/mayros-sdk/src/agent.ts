/**
 * Agent creation and execution for the Mayros Agent SDK.
 */

import type { Message, ModelConfig, AgentEvent, ToolResult } from "./types.js";
import type { ToolDefinition } from "./tools.js";

export type AgentConfig = {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** System prompt for the agent */
  systemPrompt?: string;
  /** Model configuration */
  model?: string | ModelConfig;
  /** Available tools */
  tools?: ToolDefinition[];
  /** Maximum agent loop iterations */
  maxIterations?: number;
  /** Event handler for streaming */
  onEvent?: (event: AgentEvent) => void;
  /** Function that sends messages to the LLM and returns the assistant response. */
  sendMessage?: (messages: Message[], tools?: ToolDefinition[]) => Promise<Message>;
};

export type AgentRunResult = {
  messages: Message[];
  iterations: number;
  toolCalls: number;
};

export type Agent = {
  readonly config: AgentConfig;
  run: (input: string, options?: { signal?: AbortSignal }) => Promise<AgentRunResult>;
};

/**
 * Build a map from tool name to tool definition for fast lookup.
 */
function buildToolMap(tools: ToolDefinition[]): Map<string, ToolDefinition> {
  const map = new Map<string, ToolDefinition>();
  for (const tool of tools) {
    map.set(tool.name, tool);
  }
  return map;
}

/**
 * Execute a single tool call and return the tool result message.
 */
async function executeToolCall(
  call: { id: string; name: string; arguments: Record<string, unknown> },
  toolMap: Map<string, ToolDefinition>,
  signal: AbortSignal | undefined,
  onEvent: ((event: AgentEvent) => void) | undefined,
): Promise<{ message: Message; result: ToolResult }> {
  const tool = toolMap.get(call.name);

  if (!tool) {
    const errorResult: ToolResult = {
      content: [{ type: "text", text: `Error: tool "${call.name}" not found` }],
      isError: true,
    };
    onEvent?.({ type: "tool_result", callId: call.id, result: errorResult });
    return {
      message: {
        role: "tool",
        content: errorResult.content,
        tool_call_id: call.id,
      },
      result: errorResult,
    };
  }

  let result: ToolResult;
  try {
    result = await tool.execute(call.arguments, { callId: call.id, signal });
  } catch (err: unknown) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    result = {
      content: [{ type: "text", text: `Error: ${errorMessage}` }],
      isError: true,
    };
  }

  onEvent?.({ type: "tool_result", callId: call.id, result });

  return {
    message: {
      role: "tool",
      content: result.content,
      tool_call_id: call.id,
    },
    result,
  };
}

/**
 * Create an agent instance.
 *
 * When `sendMessage` is provided, the agent runs a real agentic loop:
 * it calls the LLM, executes any tool calls from the response, sends
 * tool results back, and repeats until the LLM responds without tool
 * calls or `maxIterations` is reached.
 *
 * When `sendMessage` is omitted, the agent operates in dry-run mode:
 * it returns the initial messages without calling any LLM.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   id: "coder",
 *   name: "Code Assistant",
 *   systemPrompt: "You are a helpful coding assistant.",
 *   model: "anthropic/claude-sonnet-4-20250514",
 *   tools: [readFile, writeFile],
 *   sendMessage: async (messages, tools) => {
 *     // Call your OpenAI-compatible API here
 *     return response;
 *   },
 * });
 *
 * const result = await agent.run("Create a hello.ts file");
 * console.log(result.messages);
 * ```
 */
export function createAgent(config: AgentConfig): Agent {
  const maxIterations = config.maxIterations ?? 25;

  return {
    config,

    async run(input: string, options?: { signal?: AbortSignal }): Promise<AgentRunResult> {
      const messages: Message[] = [];
      let iterations = 0;
      let toolCallCount = 0;

      // Add system prompt
      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }

      // Add user input
      messages.push({ role: "user", content: input });
      config.onEvent?.({ type: "message", message: messages[messages.length - 1] });

      // Dry-run mode: no sendMessage provided, return immediately
      if (!config.sendMessage) {
        iterations = 1;
        return { messages, iterations, toolCalls: toolCallCount };
      }

      const toolMap = buildToolMap(config.tools ?? []);

      // Agentic loop
      while (iterations < maxIterations) {
        options?.signal?.throwIfAborted();
        iterations++;

        // Call the LLM
        const assistantMessage = await config.sendMessage(messages, config.tools);
        messages.push(assistantMessage);
        config.onEvent?.({ type: "message", message: assistantMessage });

        // If no tool calls, the assistant is done
        const calls = assistantMessage.tool_calls;
        if (!calls || calls.length === 0) {
          break;
        }

        // Execute each tool call
        for (const call of calls) {
          options?.signal?.throwIfAborted();
          config.onEvent?.({ type: "tool_call", call });
          toolCallCount++;

          const { message: toolMessage } = await executeToolCall(
            call,
            toolMap,
            options?.signal,
            config.onEvent,
          );
          messages.push(toolMessage);
        }
      }

      config.onEvent?.({ type: "done", messages });
      return { messages, iterations, toolCalls: toolCallCount };
    },
  };
}

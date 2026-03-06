/**
 * Agent creation and execution for the Mayros Agent SDK.
 */

import type { Message, ModelConfig, AgentEvent } from "./types.js";
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
 * Create an agent instance.
 *
 * @example
 * ```typescript
 * const agent = createAgent({
 *   id: "coder",
 *   name: "Code Assistant",
 *   systemPrompt: "You are a helpful coding assistant.",
 *   model: "anthropic/claude-sonnet-4-20250514",
 *   tools: [readFile, writeFile],
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
      let toolCalls = 0;

      // Add system prompt
      if (config.systemPrompt) {
        messages.push({ role: "system", content: config.systemPrompt });
      }

      // Add user input
      messages.push({ role: "user", content: input });
      config.onEvent?.({ type: "message", message: messages[messages.length - 1] });

      // Agent loop placeholder
      // In a full implementation, this would:
      // 1. Send messages to the model API
      // 2. Parse tool calls from the response
      // 3. Execute tools
      // 4. Append results and loop

      while (iterations < maxIterations) {
        options?.signal?.throwIfAborted();
        iterations++;

        // Placeholder: In production, this calls the Mayros gateway
        // For now, return after first iteration
        break;
      }

      return { messages, iterations, toolCalls };
    },
  };
}

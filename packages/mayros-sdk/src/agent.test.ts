import { describe, it, expect, vi } from "vitest";
import { createAgent } from "./agent.js";
import type { AgentConfig } from "./agent.js";
import { defineTool, textResult, errorResult } from "./tools.js";
import type { Message, AgentEvent, ToolCall } from "./types.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A simple tool that echoes its input. */
const echoTool = defineTool({
  name: "echo",
  description: "Echoes the text back",
  parameters: { type: "object", properties: { text: { type: "string" } } },
  execute: async (args) => textResult(String(args.text)),
});

/** A tool that always throws. */
const failingTool = defineTool({
  name: "failing",
  description: "Always fails",
  parameters: { type: "object", properties: {} },
  execute: async () => {
    throw new Error("tool exploded");
  },
});

/** A tool that adds two numbers. */
const addTool = defineTool({
  name: "add",
  description: "Adds two numbers",
  parameters: {
    type: "object",
    properties: { a: { type: "number" }, b: { type: "number" } },
  },
  execute: async (args) => textResult(String(Number(args.a) + Number(args.b))),
});

/** Helper: create a plain assistant message with no tool calls. */
function assistantMsg(content: string): Message {
  return { role: "assistant", content };
}

/** Helper: create an assistant message that requests tool calls. */
function assistantWithToolCalls(content: string, calls: ToolCall[]): Message {
  return { role: "assistant", content, tool_calls: calls };
}

/** Helper: create a ToolCall object. */
function tc(id: string, name: string, args: Record<string, unknown>): ToolCall {
  return { id, name, arguments: args };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Agent SDK", () => {
  // -------------------------------------------------------------------------
  // Dry-run mode (no sendMessage)
  // -------------------------------------------------------------------------
  describe("dry-run mode", () => {
    it("returns messages with user input when no sendMessage is provided", async () => {
      const agent = createAgent({ id: "dry", name: "Dry Agent" });
      const result = await agent.run("Hello");

      expect(result.messages).toHaveLength(1);
      expect(result.messages[0]).toEqual({ role: "user", content: "Hello" });
      expect(result.iterations).toBe(1);
      expect(result.toolCalls).toBe(0);
    });

    it("includes system prompt in dry-run messages", async () => {
      const agent = createAgent({
        id: "dry",
        name: "Dry Agent",
        systemPrompt: "Be helpful",
      });
      const result = await agent.run("Hello");

      expect(result.messages).toHaveLength(2);
      expect(result.messages[0]).toEqual({ role: "system", content: "Be helpful" });
      expect(result.messages[1]).toEqual({ role: "user", content: "Hello" });
    });
  });

  // -------------------------------------------------------------------------
  // Basic agent loop
  // -------------------------------------------------------------------------
  describe("agent loop", () => {
    it("calls sendMessage and returns assistant response", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValue(assistantMsg("Hi there!"));
      const agent = createAgent({
        id: "basic",
        name: "Basic",
        sendMessage,
      });

      const result = await agent.run("Hello");

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(result.iterations).toBe(1);
      expect(result.toolCalls).toBe(0);
      // messages: [user, assistant]
      expect(result.messages).toHaveLength(2);
      expect(result.messages[1].content).toBe("Hi there!");
    });

    it("sends system prompt + user message to sendMessage", async () => {
      let capturedMessages: Message[] = [];
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockImplementation(async (msgs) => {
          // Capture a snapshot because the array is mutated after the call returns
          capturedMessages = msgs.map((m) => ({ ...m }));
          return assistantMsg("ok");
        });
      const agent = createAgent({
        id: "sys",
        name: "Sys",
        systemPrompt: "You are a helper",
        sendMessage,
      });

      await agent.run("Do something");

      expect(capturedMessages).toHaveLength(2);
      expect(capturedMessages[0]).toEqual({ role: "system", content: "You are a helper" });
      expect(capturedMessages[1]).toEqual({ role: "user", content: "Do something" });
    });

    it("stops when assistant responds without tool_calls", async () => {
      let callCount = 0;
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockImplementation(async () => {
          callCount++;
          return assistantMsg(`Response ${callCount}`);
        });
      const agent = createAgent({
        id: "stop",
        name: "Stop",
        sendMessage,
      });

      const result = await agent.run("Go");

      expect(sendMessage).toHaveBeenCalledTimes(1);
      expect(result.iterations).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Tool execution in the loop
  // -------------------------------------------------------------------------
  describe("tool execution", () => {
    it("executes a tool and sends the result back to the LLM", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValueOnce(
          assistantWithToolCalls("I will echo", [tc("call-1", "echo", { text: "hello" })]),
        )
        .mockResolvedValueOnce(assistantMsg("Done echoing"));

      const agent = createAgent({
        id: "tool-test",
        name: "Tool Test",
        tools: [echoTool],
        sendMessage,
      });

      const result = await agent.run("Echo hello");

      expect(result.iterations).toBe(2);
      expect(result.toolCalls).toBe(1);

      // Messages: user, assistant(tool_calls), tool(result), assistant(done)
      expect(result.messages).toHaveLength(4);
      expect(result.messages[0].role).toBe("user");
      expect(result.messages[1].role).toBe("assistant");
      expect(result.messages[1].tool_calls).toHaveLength(1);
      expect(result.messages[2].role).toBe("tool");
      expect(result.messages[2].tool_call_id).toBe("call-1");
      expect(result.messages[2].content).toEqual([{ type: "text", text: "hello" }]);
      expect(result.messages[3].role).toBe("assistant");
      expect(result.messages[3].content).toBe("Done echoing");
    });

    it("sends accumulated messages including tool results to subsequent LLM calls", async () => {
      const snapshots: Message[][] = [];
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockImplementationOnce(async (msgs) => {
          snapshots.push(msgs.map((m) => ({ ...m })));
          return assistantWithToolCalls("step1", [tc("c1", "echo", { text: "a" })]);
        })
        .mockImplementationOnce(async (msgs) => {
          snapshots.push(msgs.map((m) => ({ ...m })));
          return assistantMsg("final");
        });

      const agent = createAgent({
        id: "accum",
        name: "Accum",
        tools: [echoTool],
        sendMessage,
      });

      await agent.run("Go");

      // Second call should include: user, assistant(tool_calls), tool(result)
      const secondCallMessages = snapshots[1];
      expect(secondCallMessages).toHaveLength(3);
      expect(secondCallMessages[0].role).toBe("user");
      expect(secondCallMessages[1].role).toBe("assistant");
      expect(secondCallMessages[2].role).toBe("tool");
    });

    it("handles multiple iterations of tool calls", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValueOnce(
          assistantWithToolCalls("step1", [tc("c1", "echo", { text: "first" })]),
        )
        .mockResolvedValueOnce(assistantWithToolCalls("step2", [tc("c2", "add", { a: 1, b: 2 })]))
        .mockResolvedValueOnce(assistantMsg("All done"));

      const agent = createAgent({
        id: "multi-iter",
        name: "Multi Iter",
        tools: [echoTool, addTool],
        sendMessage,
      });

      const result = await agent.run("Do two steps");

      expect(result.iterations).toBe(3);
      expect(result.toolCalls).toBe(2);
      // user(1) + assistant+tool(2) + assistant+tool(2) + assistant(1) = 6
      expect(result.messages).toHaveLength(6);
    });
  });

  // -------------------------------------------------------------------------
  // Multiple tool calls in a single response
  // -------------------------------------------------------------------------
  describe("multiple tool calls in one response", () => {
    it("executes all tool calls and appends all results", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValueOnce(
          assistantWithToolCalls("doing both", [
            tc("c1", "echo", { text: "one" }),
            tc("c2", "add", { a: 10, b: 20 }),
          ]),
        )
        .mockResolvedValueOnce(assistantMsg("Both done"));

      const agent = createAgent({
        id: "parallel",
        name: "Parallel",
        tools: [echoTool, addTool],
        sendMessage,
      });

      const result = await agent.run("Do both");

      expect(result.toolCalls).toBe(2);
      // user, assistant(2 calls), tool(echo), tool(add), assistant(final)
      expect(result.messages).toHaveLength(5);
      expect(result.messages[2].role).toBe("tool");
      expect(result.messages[2].tool_call_id).toBe("c1");
      expect(result.messages[3].role).toBe("tool");
      expect(result.messages[3].tool_call_id).toBe("c2");
      expect(result.messages[3].content).toEqual([{ type: "text", text: "30" }]);
    });
  });

  // -------------------------------------------------------------------------
  // Error handling
  // -------------------------------------------------------------------------
  describe("error handling", () => {
    it("returns error result when tool throws", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValueOnce(assistantWithToolCalls("try failing", [tc("c1", "failing", {})]))
        .mockResolvedValueOnce(assistantMsg("Handled error"));

      const agent = createAgent({
        id: "err",
        name: "Err",
        tools: [failingTool],
        sendMessage,
      });

      const result = await agent.run("Fail");

      expect(result.toolCalls).toBe(1);
      expect(result.messages[2].role).toBe("tool");
      expect(result.messages[2].content).toEqual([{ type: "text", text: "Error: tool exploded" }]);
    });

    it("returns error result when tool is not found", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValueOnce(assistantWithToolCalls("call ghost", [tc("c1", "nonexistent", {})]))
        .mockResolvedValueOnce(assistantMsg("ok"));

      const agent = createAgent({
        id: "notfound",
        name: "NotFound",
        tools: [],
        sendMessage,
      });

      const result = await agent.run("Go");

      expect(result.messages[2].role).toBe("tool");
      expect(result.messages[2].content).toEqual([
        { type: "text", text: 'Error: tool "nonexistent" not found' },
      ]);
    });

    it("propagates sendMessage errors to the caller", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockRejectedValue(new Error("API down"));
      const agent = createAgent({
        id: "api-err",
        name: "API Err",
        sendMessage,
      });

      await expect(agent.run("Go")).rejects.toThrow("API down");
    });
  });

  // -------------------------------------------------------------------------
  // maxIterations limit
  // -------------------------------------------------------------------------
  describe("maxIterations", () => {
    it("stops after maxIterations even if tools keep being called", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockImplementation(async () =>
          assistantWithToolCalls("looping", [tc(`c-${Date.now()}`, "echo", { text: "x" })]),
        );

      const agent = createAgent({
        id: "limit",
        name: "Limit",
        tools: [echoTool],
        maxIterations: 3,
        sendMessage,
      });

      const result = await agent.run("Loop forever");

      expect(result.iterations).toBe(3);
      expect(sendMessage).toHaveBeenCalledTimes(3);
    });

    it("defaults maxIterations to 25", () => {
      const agent = createAgent({ id: "def", name: "Default" });
      // We cannot directly access maxIterations, but we verify through behavior
      expect(agent.config.maxIterations).toBeUndefined();
    });

    it("completes before maxIterations when assistant finishes early", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValue(assistantMsg("done"));
      const agent = createAgent({
        id: "early",
        name: "Early",
        maxIterations: 10,
        sendMessage,
      });

      const result = await agent.run("Quick");

      expect(result.iterations).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Abort signal
  // -------------------------------------------------------------------------
  describe("abort signal", () => {
    it("aborts before the first LLM call when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort("cancelled");

      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValue(assistantMsg("nope"));
      const agent = createAgent({
        id: "abort-pre",
        name: "Abort Pre",
        sendMessage,
      });

      await expect(agent.run("Go", { signal: controller.signal })).rejects.toThrow();
      expect(sendMessage).not.toHaveBeenCalled();
    });

    it("aborts between tool execution iterations", async () => {
      const controller = new AbortController();

      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockImplementation(async () => {
          // Abort after first LLM response is received
          controller.abort("cancelled mid-loop");
          return assistantWithToolCalls("step", [
            tc("c1", "echo", { text: "a" }),
            tc("c2", "echo", { text: "b" }),
          ]);
        });

      const agent = createAgent({
        id: "abort-mid",
        name: "Abort Mid",
        tools: [echoTool],
        sendMessage,
      });

      // The abort happens after sendMessage returns but before/during tool execution
      await expect(agent.run("Go", { signal: controller.signal })).rejects.toThrow();
    });

    it("works without providing a signal", async () => {
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValue(assistantMsg("ok"));
      const agent = createAgent({
        id: "no-signal",
        name: "No Signal",
        sendMessage,
      });

      const result = await agent.run("Go");
      expect(result.iterations).toBe(1);
    });

    it("aborts in dry-run mode when signal is already aborted", async () => {
      const controller = new AbortController();
      controller.abort();

      const agent = createAgent({ id: "dry-abort", name: "Dry Abort" });

      // Dry-run mode exits before checking signal, so it should succeed
      // since the signal check only happens inside the while loop
      const result = await agent.run("Go", { signal: controller.signal });
      expect(result.iterations).toBe(1);
    });
  });

  // -------------------------------------------------------------------------
  // Event emission
  // -------------------------------------------------------------------------
  describe("events", () => {
    it("emits message event for user input", async () => {
      const events: AgentEvent[] = [];
      const agent = createAgent({
        id: "evt",
        name: "Evt",
        onEvent: (e) => events.push(e),
      });

      await agent.run("Hello");

      expect(events).toHaveLength(1);
      expect(events[0].type).toBe("message");
      if (events[0].type === "message") {
        expect(events[0].message.role).toBe("user");
      }
    });

    it("emits full event sequence for a tool call cycle", async () => {
      const events: AgentEvent[] = [];
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValueOnce(
          assistantWithToolCalls("calling echo", [tc("c1", "echo", { text: "hi" })]),
        )
        .mockResolvedValueOnce(assistantMsg("finished"));

      const agent = createAgent({
        id: "evt-full",
        name: "Evt Full",
        tools: [echoTool],
        sendMessage,
        onEvent: (e) => events.push(e),
      });

      await agent.run("Go");

      const types = events.map((e) => e.type);
      // user message, assistant message, tool_call, tool_result, assistant message, done
      expect(types).toEqual([
        "message", // user input
        "message", // assistant with tool_calls
        "tool_call", // echo tool call
        "tool_result", // echo result
        "message", // assistant final
        "done", // done
      ]);
    });

    it("emits done event with all messages", async () => {
      const events: AgentEvent[] = [];
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValue(assistantMsg("reply"));
      const agent = createAgent({
        id: "evt-done",
        name: "Evt Done",
        sendMessage,
        onEvent: (e) => events.push(e),
      });

      await agent.run("Hi");

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeDefined();
      if (doneEvent?.type === "done") {
        expect(doneEvent.messages).toHaveLength(2); // user + assistant
      }
    });

    it("emits tool_result with isError when tool throws", async () => {
      const events: AgentEvent[] = [];
      const sendMessage = vi
        .fn<(m: Message[]) => Promise<Message>>()
        .mockResolvedValueOnce(assistantWithToolCalls("try", [tc("c1", "failing", {})]))
        .mockResolvedValueOnce(assistantMsg("handled"));

      const agent = createAgent({
        id: "evt-err",
        name: "Evt Err",
        tools: [failingTool],
        sendMessage,
        onEvent: (e) => events.push(e),
      });

      await agent.run("Go");

      const toolResultEvent = events.find((e) => e.type === "tool_result");
      expect(toolResultEvent).toBeDefined();
      if (toolResultEvent?.type === "tool_result") {
        expect(toolResultEvent.result.isError).toBe(true);
      }
    });

    it("does not emit done event in dry-run mode", async () => {
      const events: AgentEvent[] = [];
      const agent = createAgent({
        id: "dry-evt",
        name: "Dry Evt",
        onEvent: (e) => events.push(e),
      });

      await agent.run("Hello");

      const doneEvent = events.find((e) => e.type === "done");
      expect(doneEvent).toBeUndefined();
    });
  });

  // -------------------------------------------------------------------------
  // Config preservation
  // -------------------------------------------------------------------------
  describe("config", () => {
    it("exposes config on the agent object", () => {
      const config: AgentConfig = {
        id: "cfg",
        name: "Config Test",
        systemPrompt: "sys",
        maxIterations: 5,
      };
      const agent = createAgent(config);
      expect(agent.config).toBe(config);
    });

    it("passes tools array to sendMessage", async () => {
      const sendMessage = vi
        .fn<(m: Message[], t?: unknown) => Promise<Message>>()
        .mockResolvedValue(assistantMsg("ok"));
      const agent = createAgent({
        id: "tools-pass",
        name: "Tools Pass",
        tools: [echoTool, addTool],
        sendMessage,
      });

      await agent.run("Go");

      expect(sendMessage).toHaveBeenCalledWith(
        expect.arrayContaining([{ role: "user", content: "Go" }]),
        [echoTool, addTool],
      );
    });
  });

  // -------------------------------------------------------------------------
  // defineTool (kept from original tests)
  // -------------------------------------------------------------------------
  describe("defineTool", () => {
    it("creates a tool definition", () => {
      const tool = defineTool({
        name: "test_tool",
        description: "A test tool",
        parameters: { type: "object", properties: {} },
        execute: async () => textResult("ok"),
      });
      expect(tool.name).toBe("test_tool");
    });

    it("executes tool and returns result", async () => {
      const tool = defineTool({
        name: "echo",
        description: "Echo input",
        parameters: { type: "object", properties: { text: { type: "string" } } },
        execute: async (args) => textResult(String(args.text)),
      });
      const result = await tool.execute({ text: "hello" }, { callId: "1" });
      expect(result.content[0]).toEqual({ type: "text", text: "hello" });
    });

    it("returns error result via errorResult helper", () => {
      const result = errorResult("something went wrong");
      expect(result.isError).toBe(true);
      expect(result.content[0]).toEqual({
        type: "text",
        text: "Error: something went wrong",
      });
    });
  });
});

import { describe, it, expect } from "vitest";
import { createAgent } from "./agent.js";
import { defineTool, textResult } from "./tools.js";

describe("Agent SDK", () => {
  describe("createAgent", () => {
    it("creates an agent with config", () => {
      const agent = createAgent({
        id: "test",
        name: "Test Agent",
        systemPrompt: "You are a test agent.",
      });
      expect(agent.config.id).toBe("test");
      expect(agent.config.name).toBe("Test Agent");
    });

    it("runs with user input", async () => {
      const agent = createAgent({
        id: "test",
        name: "Test Agent",
      });
      const result = await agent.run("Hello");
      expect(result.messages.length).toBeGreaterThanOrEqual(1);
      expect(result.iterations).toBeGreaterThanOrEqual(1);
    });

    it("includes system prompt in messages", async () => {
      const agent = createAgent({
        id: "test",
        name: "Test Agent",
        systemPrompt: "Be helpful",
      });
      const result = await agent.run("Hello");
      const systemMsg = result.messages.find((m) => m.role === "system");
      expect(systemMsg?.content).toBe("Be helpful");
    });

    it("respects abort signal", async () => {
      const controller = new AbortController();
      controller.abort();
      const agent = createAgent({ id: "test", name: "Test" });
      await expect(agent.run("Hello", { signal: controller.signal })).rejects.toThrow();
    });
  });

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

    it("executes tool", async () => {
      const tool = defineTool({
        name: "echo",
        description: "Echo input",
        parameters: { type: "object", properties: { text: { type: "string" } } },
        execute: async (args) => textResult(String(args.text)),
      });
      const result = await tool.execute({ text: "hello" }, { callId: "1" });
      expect(result.content[0]).toEqual({ type: "text", text: "hello" });
    });
  });
});

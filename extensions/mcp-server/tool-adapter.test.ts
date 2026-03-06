import { describe, it, expect, beforeEach } from "vitest";
import { McpToolAdapter, typeBoxToJsonSchema, type AdaptableTool } from "./tool-adapter.js";

// ── Mock tools ────────────────────────────────────────────────────────

function createMockTool(name: string, desc?: string): AdaptableTool {
  return {
    name,
    description: desc ?? `Tool: ${name}`,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path" },
        count: { type: "number", minimum: 0 },
      },
      required: ["path"],
    },
    execute: async (_callId, params) => ({
      content: [{ type: "text" as const, text: `Executed ${name}: ${JSON.stringify(params)}` }],
    }),
  };
}

describe("McpToolAdapter", () => {
  let adapter: McpToolAdapter;

  beforeEach(() => {
    adapter = new McpToolAdapter();
  });

  // 1
  it("registers and lists tools", () => {
    adapter.registerTools([createMockTool("code_read"), createMockTool("code_write")]);
    expect(adapter.listToolNames()).toEqual(["code_read", "code_write"]);
  });

  // 2
  it("excludes MCP client tools", () => {
    adapter.registerTools([
      createMockTool("code_read"),
      createMockTool("mcp_connect"),
      createMockTool("mcp_disconnect"),
      createMockTool("mcp_list_tools"),
      createMockTool("mcp_call_tool"),
    ]);
    expect(adapter.listToolNames()).toEqual(["code_read"]);
  });

  // 3
  it("listTools returns MCP tool definitions", () => {
    adapter.registerTools([createMockTool("code_read", "Read a file")]);
    const tools = adapter.listTools();
    expect(tools).toHaveLength(1);
    expect(tools[0]!.name).toBe("code_read");
    expect(tools[0]!.description).toBe("Read a file");
    expect(tools[0]!.inputSchema).toBeDefined();
  });

  // 4
  it("callTool executes and returns result", async () => {
    adapter.registerTools([createMockTool("code_read")]);
    const result = await adapter.callTool("code_read", { path: "/tmp/test" });
    expect(result.isError).toBeUndefined();
    expect(result.content[0]!.text).toContain("code_read");
    expect(result.content[0]!.text).toContain("/tmp/test");
  });

  // 5
  it("callTool returns error for unknown tool", async () => {
    const result = await adapter.callTool("nonexistent", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("not found");
  });

  // 6
  it("callTool handles execution errors", async () => {
    const failing: AdaptableTool = {
      name: "failing_tool",
      description: "Fails",
      execute: async () => {
        throw new Error("boom");
      },
    };
    adapter.registerTools([failing]);
    const result = await adapter.callTool("failing_tool", {});
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain("boom");
  });

  // 7
  it("clear removes all tools", () => {
    adapter.registerTools([createMockTool("a"), createMockTool("b")]);
    expect(adapter.listToolNames()).toHaveLength(2);
    adapter.clear();
    expect(adapter.listToolNames()).toHaveLength(0);
  });

  // 8
  it("callTool returns (empty result) for tool with empty content", async () => {
    const empty: AdaptableTool = {
      name: "empty_tool",
      description: "Empty",
      execute: async () => ({ content: [] }),
    };
    adapter.registerTools([empty]);
    const result = await adapter.callTool("empty_tool", {});
    expect(result.content[0]!.text).toBe("(empty result)");
  });
});

describe("typeBoxToJsonSchema", () => {
  // 9
  it("converts object schema with properties", () => {
    const schema = typeBoxToJsonSchema({
      type: "object",
      properties: {
        name: { type: "string", description: "Name" },
        age: { type: "number", minimum: 0 },
      },
      required: ["name"],
    });
    expect(schema.type).toBe("object");
    expect((schema.properties as Record<string, unknown>).name).toBeDefined();
    expect(schema.required).toEqual(["name"]);
  });

  // 10
  it("converts array schema", () => {
    const schema = typeBoxToJsonSchema({
      type: "array",
      items: { type: "string" },
    });
    expect(schema.type).toBe("array");
    expect((schema.items as Record<string, unknown>).type).toBe("string");
  });

  // 11
  it("handles null/undefined input", () => {
    const schema = typeBoxToJsonSchema(null);
    expect(schema).toEqual({ type: "object", properties: {} });
  });

  // 12
  it("handles nested objects", () => {
    const schema = typeBoxToJsonSchema({
      type: "object",
      properties: {
        inner: {
          type: "object",
          properties: {
            value: { type: "string" },
          },
        },
      },
    });
    const props = schema.properties as Record<string, Record<string, unknown>>;
    expect(props.inner!.type).toBe("object");
  });
});

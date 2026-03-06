import { describe, it, expect, beforeEach } from "vitest";
import {
  McpProtocolDispatcher,
  McpError,
  ErrorCodes,
  MCP_PROTOCOL_VERSION,
  type McpHandlers,
  type McpToolDef,
  type McpToolResult,
  type McpResourceDef,
  type McpResourceContents,
  type McpPromptDef,
  type McpPromptMessage,
} from "./protocol.js";

// ── Helpers ───────────────────────────────────────────────────────────

function createMockHandlers(): McpHandlers {
  return {
    listTools: async (): Promise<McpToolDef[]> => [
      { name: "test_tool", description: "A test tool", inputSchema: { type: "object" } },
    ],
    callTool: async (name: string, args: Record<string, unknown>): Promise<McpToolResult> => ({
      content: [{ type: "text", text: `Called ${name} with ${JSON.stringify(args)}` }],
    }),
    listResources: async (): Promise<McpResourceDef[]> => [
      { uri: "test:///resource", name: "Test Resource" },
    ],
    readResource: async (uri: string): Promise<McpResourceContents> => ({
      uri,
      text: `Content of ${uri}`,
    }),
    listPrompts: async (): Promise<McpPromptDef[]> => [
      { name: "test_prompt", description: "A test prompt" },
    ],
    getPrompt: async (name: string): Promise<McpPromptMessage[]> => [
      { role: "assistant", content: { type: "text", text: `Prompt: ${name}` } },
    ],
  };
}

function req(method: string, params?: Record<string, unknown>, id?: number | string): string {
  return JSON.stringify({ jsonrpc: "2.0", id: id ?? 1, method, params });
}

function notification(method: string): string {
  return JSON.stringify({ jsonrpc: "2.0", method });
}

function parse(raw: string): { id: number | string | null; result?: unknown; error?: unknown } {
  return JSON.parse(raw);
}

describe("McpProtocolDispatcher", () => {
  let dispatcher: McpProtocolDispatcher;

  beforeEach(() => {
    dispatcher = new McpProtocolDispatcher({
      serverInfo: { name: "test-server", version: "1.0.0" },
      capabilities: { tools: {}, resources: {}, prompts: {} },
      handlers: createMockHandlers(),
    });
  });

  // 1
  it("handles initialize handshake", async () => {
    const raw = await dispatcher.handleMessage(req("initialize"));
    expect(raw).not.toBeNull();
    const res = parse(raw!);
    expect(res.id).toBe(1);
    const result = res.result as { protocolVersion: string; serverInfo: { name: string } };
    expect(result.protocolVersion).toBe(MCP_PROTOCOL_VERSION);
    expect(result.serverInfo.name).toBe("test-server");
    expect(dispatcher.isInitialized()).toBe(true);
  });

  // 2
  it("rejects requests before initialization", async () => {
    const raw = await dispatcher.handleMessage(req("tools/list"));
    expect(raw).not.toBeNull();
    const res = parse(raw!);
    expect(res.error).toBeDefined();
    expect((res.error as { code: number }).code).toBe(ErrorCodes.INTERNAL_ERROR);
  });

  // 3
  it("handles tools/list after init", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(req("tools/list", {}, 2));
    const res = parse(raw!);
    const result = res.result as { tools: McpToolDef[] };
    expect(result.tools).toHaveLength(1);
    expect(result.tools[0]!.name).toBe("test_tool");
  });

  // 4
  it("handles tools/call", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(
      req("tools/call", { name: "test_tool", arguments: { foo: "bar" } }, 3),
    );
    const res = parse(raw!);
    const result = res.result as McpToolResult;
    expect(result.content[0]!.text).toContain("test_tool");
    expect(result.content[0]!.text).toContain("bar");
  });

  // 5
  it("handles resources/list", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(req("resources/list", {}, 4));
    const res = parse(raw!);
    const result = res.result as { resources: McpResourceDef[] };
    expect(result.resources).toHaveLength(1);
    expect(result.resources[0]!.uri).toBe("test:///resource");
  });

  // 6
  it("handles resources/read", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(
      req("resources/read", { uri: "test:///resource" }, 5),
    );
    const res = parse(raw!);
    const result = res.result as { contents: McpResourceContents[] };
    expect(result.contents[0]!.text).toContain("test:///resource");
  });

  // 7
  it("handles prompts/list", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(req("prompts/list", {}, 6));
    const res = parse(raw!);
    const result = res.result as { prompts: McpPromptDef[] };
    expect(result.prompts).toHaveLength(1);
    expect(result.prompts[0]!.name).toBe("test_prompt");
  });

  // 8
  it("handles prompts/get", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(
      req("prompts/get", { name: "test_prompt", arguments: {} }, 7),
    );
    const res = parse(raw!);
    const result = res.result as { messages: McpPromptMessage[] };
    expect(result.messages[0]!.content.text).toContain("test_prompt");
  });

  // 9
  it("handles ping", async () => {
    const raw = await dispatcher.handleMessage(req("ping"));
    const res = parse(raw!);
    expect(res.result).toEqual({});
  });

  // 10
  it("returns null for notifications", async () => {
    const raw = await dispatcher.handleMessage(notification("notifications/initialized"));
    expect(raw).toBeNull();
  });

  // 11
  it("returns error for unknown method", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(req("unknown/method", {}, 8));
    const res = parse(raw!);
    expect((res.error as { code: number }).code).toBe(ErrorCodes.METHOD_NOT_FOUND);
  });

  // 12
  it("returns parse error for invalid JSON", async () => {
    const raw = await dispatcher.handleMessage("not json at all");
    const res = parse(raw!);
    expect((res.error as { code: number }).code).toBe(ErrorCodes.PARSE_ERROR);
  });

  // 13
  it("returns invalid request for non-object", async () => {
    const raw = await dispatcher.handleMessage(JSON.stringify([1, 2, 3]));
    const res = parse(raw!);
    expect((res.error as { code: number }).code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  // 14
  it("returns invalid request for missing jsonrpc", async () => {
    const raw = await dispatcher.handleMessage(JSON.stringify({ id: 1, method: "ping" }));
    const res = parse(raw!);
    expect((res.error as { code: number }).code).toBe(ErrorCodes.INVALID_REQUEST);
  });

  // 15
  it("returns invalid params for tools/call without name", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(req("tools/call", {}, 9));
    const res = parse(raw!);
    expect((res.error as { code: number }).code).toBe(ErrorCodes.INVALID_PARAMS);
  });

  // 16
  it("returns invalid params for resources/read without uri", async () => {
    await dispatcher.handleMessage(req("initialize"));
    const raw = await dispatcher.handleMessage(req("resources/read", {}, 10));
    const res = parse(raw!);
    expect((res.error as { code: number }).code).toBe(ErrorCodes.INVALID_PARAMS);
  });

  // 17
  it("McpError preserves code and data", () => {
    const err = new McpError(42, "test error", { detail: "info" });
    expect(err.code).toBe(42);
    expect(err.message).toBe("test error");
    expect(err.data).toEqual({ detail: "info" });
    expect(err.name).toBe("McpError");
  });
});

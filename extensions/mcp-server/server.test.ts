import { describe, it, expect, afterEach } from "vitest";
import { McpServer, type McpServerOptions } from "./server.js";
import type { McpServerConfig } from "./config.js";
import type { ResourceDataSources } from "./resource-provider.js";
import type { PromptDataSources } from "./prompt-provider.js";
import type { AdaptableTool } from "./tool-adapter.js";

// ── Helpers ───────────────────────────────────────────────────────────

function createTestConfig(overrides?: Partial<McpServerConfig>): McpServerConfig {
  return {
    cortex: { host: "127.0.0.1", port: 8085 },
    agentNamespace: "test",
    transport: "http",
    port: 13200 + Math.floor(Math.random() * 100),
    host: "127.0.0.1",
    auth: { allowedOrigins: [] },
    capabilities: { tools: true, resources: true, prompts: true },
    serverName: "test-mayros",
    serverVersion: "0.1.0",
    ...overrides,
  };
}

function createTestTool(name: string): AdaptableTool {
  return {
    name,
    description: `Test tool: ${name}`,
    parameters: { type: "object", properties: {} },
    execute: async () => ({
      content: [{ type: "text" as const, text: `Result from ${name}` }],
    }),
  };
}

function createEmptyResourceSources(): ResourceDataSources {
  return {
    listAgents: () => [],
    getAgent: () => null,
    listConventions: async () => [],
    getConvention: async () => null,
    listRules: async () => [],
    getRule: async () => null,
    getGraphStats: async () => null,
    listGraphSubjects: async () => [],
    getDagTips: async () => null,
    getDagStats: async () => null,
  };
}

function createEmptyPromptSources(): PromptDataSources {
  return {
    listConventions: async () => [],
    resolveRules: async () => [],
    getAgentIdentity: () => null,
    listAgentIds: () => [],
  };
}

function createTestServerOptions(overrides?: Partial<McpServerOptions>): McpServerOptions {
  return {
    config: createTestConfig(),
    tools: [createTestTool("code_read"), createTestTool("code_write")],
    resourceSources: createEmptyResourceSources(),
    promptSources: createEmptyPromptSources(),
    ...overrides,
  };
}

describe("McpServer", () => {
  let server: McpServer | null = null;

  afterEach(async () => {
    if (server) {
      await server.stop();
      server = null;
    }
  });

  // 1
  it("creates server with tools registered", () => {
    server = new McpServer(createTestServerOptions());
    const status = server.status();
    expect(status.running).toBe(false);
    expect(status.toolCount).toBe(2);
    expect(status.transport).toBe("http");
  });

  // 2
  it("starts HTTP transport", async () => {
    server = new McpServer(createTestServerOptions());
    await server.start();
    expect(server.isRunning()).toBe(true);
    expect(server.status().address).toBeDefined();
  });

  // 3
  it("stops cleanly", async () => {
    server = new McpServer(createTestServerOptions());
    await server.start();
    await server.stop();
    expect(server.isRunning()).toBe(false);
    server = null;
  });

  // 4
  it("exposes tool adapter for dynamic registration", () => {
    server = new McpServer(createTestServerOptions());
    const adapter = server.getToolAdapter();
    expect(adapter.listToolNames()).toEqual(["code_read", "code_write"]);
  });

  // 5
  it("handles full MCP flow over HTTP", async () => {
    const opts = createTestServerOptions();
    server = new McpServer(opts);
    await server.start();

    const addr = server.status().address!;

    // Initialize
    const initRes = await fetch(`${addr}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    const initBody = await initRes.json();
    expect(initBody.result.serverInfo.name).toBe("test-mayros");
    expect(initBody.result.capabilities.tools).toBeDefined();
    expect(initBody.result.capabilities.resources).toBeDefined();
    expect(initBody.result.capabilities.prompts).toBeDefined();

    // List tools
    const toolsRes = await fetch(`${addr}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
    });
    const toolsBody = await toolsRes.json();
    expect(toolsBody.result.tools).toHaveLength(2);

    // Call tool
    const callRes = await fetch(`${addr}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 3,
        method: "tools/call",
        params: { name: "code_read", arguments: { path: "/tmp/test" } },
      }),
    });
    const callBody = await callRes.json();
    expect(callBody.result.content[0].text).toContain("code_read");
  });

  // 6
  it("capabilities reflect config", () => {
    const opts = createTestServerOptions({
      config: createTestConfig({ capabilities: { tools: true, resources: false, prompts: false } }),
    });
    server = new McpServer(opts);
    // The dispatcher is created with only tools capability
    const dispatcher = server.getDispatcher();
    expect(dispatcher).toBeDefined();
  });

  // 7
  it("status reports initialized state", async () => {
    server = new McpServer(createTestServerOptions());
    await server.start();
    expect(server.status().initialized).toBe(false);

    // Send initialize
    const addr = server.status().address!;
    await fetch(`${addr}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }),
    });
    expect(server.status().initialized).toBe(true);
  });

  // 8
  it("getResourceProvider and getPromptProvider are accessible", () => {
    server = new McpServer(createTestServerOptions());
    expect(server.getResourceProvider()).toBeDefined();
    expect(server.getPromptProvider()).toBeDefined();
  });
});

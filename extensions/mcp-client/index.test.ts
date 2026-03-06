/**
 * MCP Client Plugin Tests
 *
 * Tests cover: config parsing (defaults, full, servers array, transport validation,
 * unknown keys), plugin shape, tool registration, session manager integration.
 */

import { describe, it, expect, vi } from "vitest";

// ============================================================================
// Config Tests
// ============================================================================

describe("mcp-client config", () => {
  it("parses valid config with defaults", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({});

    expect(config.cortex.host).toBe("127.0.0.1");
    expect(config.cortex.port).toBe(8080);
    expect(config.agentNamespace).toBe("mayros");
    expect(config.servers).toEqual([]);
    expect(config.registerInCortex).toBe(true);
    expect(config.maxReconnectAttempts).toBe(5);
    expect(config.reconnectDelayMs).toBe(3000);
  });

  it("parses full config with servers", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({
      cortex: {
        host: "10.0.0.1",
        port: 9090,
        authToken: "Bearer test-token",
      },
      agentNamespace: "custom",
      servers: [
        {
          id: "fs-server",
          name: "Filesystem",
          transport: { type: "stdio", command: "node", args: ["server.js"] },
          autoConnect: true,
          toolPrefix: "fs",
        },
        {
          id: "api-server",
          transport: { type: "http", url: "http://localhost:3000" },
          autoConnect: false,
        },
      ],
      registerInCortex: false,
      maxReconnectAttempts: 10,
      reconnectDelayMs: 5000,
    });

    expect(config.cortex.host).toBe("10.0.0.1");
    expect(config.cortex.port).toBe(9090);
    expect(config.agentNamespace).toBe("custom");
    expect(config.servers).toHaveLength(2);
    expect(config.servers[0].id).toBe("fs-server");
    expect(config.servers[0].name).toBe("Filesystem");
    expect(config.servers[0].transport.type).toBe("stdio");
    expect(config.servers[0].transport.command).toBe("node");
    expect(config.servers[0].transport.args).toEqual(["server.js"]);
    expect(config.servers[0].autoConnect).toBe(true);
    expect(config.servers[0].toolPrefix).toBe("fs");
    expect(config.servers[1].id).toBe("api-server");
    expect(config.servers[1].transport.type).toBe("http");
    expect(config.servers[1].transport.url).toBe("http://localhost:3000");
    expect(config.registerInCortex).toBe(false);
    expect(config.maxReconnectAttempts).toBe(10);
    expect(config.reconnectDelayMs).toBe(5000);
  });

  it("parses all transport types", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({
      servers: [
        { id: "stdio-srv", transport: { type: "stdio", command: "cmd" }, autoConnect: false },
        { id: "sse-srv", transport: { type: "sse", url: "http://a.com/sse" }, autoConnect: false },
        { id: "http-srv", transport: { type: "http", url: "http://a.com" }, autoConnect: false },
        { id: "ws-srv", transport: { type: "websocket", url: "ws://a.com" }, autoConnect: false },
      ],
    });

    expect(config.servers).toHaveLength(4);
    expect(config.servers.map((s) => s.transport.type)).toEqual([
      "stdio",
      "sse",
      "http",
      "websocket",
    ]);
  });

  it("rejects unknown top-level keys", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() => mcpClientConfigSchema.parse({ unknownKey: true })).toThrow(/unknown keys/);
  });

  it("rejects unknown transport keys", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [
          {
            id: "bad",
            transport: { type: "http", url: "http://x.com", badKey: true },
            autoConnect: false,
          },
        ],
      }),
    ).toThrow(/unknown keys/);
  });

  it("rejects unknown server keys", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [
          {
            id: "bad",
            transport: { type: "http", url: "http://x.com" },
            autoConnect: false,
            badKey: true,
          },
        ],
      }),
    ).toThrow(/unknown keys/);
  });

  it("rejects invalid transport type", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [{ id: "bad", transport: { type: "grpc" }, autoConnect: false }],
      }),
    ).toThrow(/transport\.type must be one of/);
  });

  it("rejects stdio without command", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [{ id: "bad", transport: { type: "stdio" }, autoConnect: false }],
      }),
    ).toThrow(/stdio transport requires a command/);
  });

  it("rejects http without url", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [{ id: "bad", transport: { type: "http" }, autoConnect: false }],
      }),
    ).toThrow(/http transport requires a url/);
  });

  it("rejects server without id", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [{ transport: { type: "http", url: "http://x.com" }, autoConnect: false }],
      }),
    ).toThrow(/servers\[0\]\.id is required/);
  });

  it("rejects invalid server id format", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [
          { id: "123-bad", transport: { type: "http", url: "http://x.com" }, autoConnect: false },
        ],
      }),
    ).toThrow(/must start with a letter/);
  });

  it("rejects invalid namespace", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() => mcpClientConfigSchema.parse({ agentNamespace: "123-bad" })).toThrow(
      /agentNamespace must start with a letter/,
    );
  });

  it("rejects negative maxReconnectAttempts", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() => mcpClientConfigSchema.parse({ maxReconnectAttempts: -1 })).toThrow(
      /maxReconnectAttempts must be >= 0/,
    );
  });

  it("rejects reconnectDelayMs below 100", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() => mcpClientConfigSchema.parse({ reconnectDelayMs: 50 })).toThrow(
      /reconnectDelayMs must be >= 100/,
    );
  });

  it("allows maxReconnectAttempts of 0", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({ maxReconnectAttempts: 0 });
    expect(config.maxReconnectAttempts).toBe(0);
  });

  it("rejects invalid cortex port", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() => mcpClientConfigSchema.parse({ cortex: { port: 0 } })).toThrow(
      /cortex\.port must be between 1 and 65535/,
    );
  });

  it("rejects transport config that is not an object", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    expect(() =>
      mcpClientConfigSchema.parse({
        servers: [{ id: "bad", transport: "not-an-object", autoConnect: false }],
      }),
    ).toThrow(/transport config must be an object/);
  });

  it("parses server with authToken in transport", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({
      servers: [
        {
          id: "secure-srv",
          transport: {
            type: "http",
            url: "http://localhost:3000",
            authToken: "Bearer secret",
          },
          autoConnect: false,
        },
      ],
    });

    expect(config.servers[0].transport.authToken).toBe("Bearer secret");
  });

  it("parses server with oauth2 config in transport", async () => {
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({
      servers: [
        {
          id: "oauth-srv",
          transport: {
            type: "http",
            url: "http://localhost:3000",
            oauth2: {
              clientId: "my-client-id",
              scopes: ["openid", "profile"],
              authorizationEndpoint: "https://auth.test/authorize",
              tokenEndpoint: "https://auth.test/token",
            },
          },
          autoConnect: false,
        },
      ],
    });

    expect(config.servers[0].transport.oauth2).toBeDefined();
    expect(config.servers[0].transport.oauth2!.clientId).toBe("my-client-id");
    expect(config.servers[0].transport.oauth2!.scopes).toEqual(["openid", "profile"]);
  });
});

// ============================================================================
// Plugin Shape Tests
// ============================================================================

describe("mcp-client plugin registration", () => {
  it("plugin has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("mcp-client");
    expect(plugin.name).toBe("MCP Client");
    expect(plugin.kind).toBe("integration");
    expect(plugin.configSchema).toBeTruthy();
    expect(typeof plugin.register).toBe("function");
  });

  it("plugin description mentions MCP", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.description.toLowerCase()).toContain("mcp");
  });

  it("config schema has parse method", async () => {
    const { default: plugin } = await import("./index.js");

    expect(typeof plugin.configSchema.parse).toBe("function");
  });
});

// ============================================================================
// Session Manager Tests (with mocked transport)
// ============================================================================

describe("SessionManager", () => {
  it("throws for unknown server id", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({});
    const mgr = new SessionManager(config);

    await expect(mgr.connect("nonexistent")).rejects.toThrow(/not found in configuration/);
  });

  it("listConnections returns empty initially", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({});
    const mgr = new SessionManager(config);

    expect(mgr.listConnections()).toHaveLength(0);
  });

  it("getConnection returns undefined for unknown server", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({});
    const mgr = new SessionManager(config);

    expect(mgr.getConnection("unknown")).toBeUndefined();
  });

  it("getTransport returns undefined for unknown server", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({});
    const mgr = new SessionManager(config);

    expect(mgr.getTransport("unknown")).toBeUndefined();
  });

  it("disconnectAll is safe with no connections", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({});
    const mgr = new SessionManager(config);

    // Should not throw
    await mgr.disconnectAll();
    expect(mgr.listConnections()).toHaveLength(0);
  });

  it("autoConnectAll skips when no auto-connect servers", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({
      servers: [
        {
          id: "manual-srv",
          transport: { type: "http", url: "http://localhost:3000" },
          autoConnect: false,
        },
      ],
    });
    const mgr = new SessionManager(config);

    // autoConnectAll should not try to connect manual servers
    await mgr.autoConnectAll();
    expect(mgr.listConnections()).toHaveLength(0);
  });

  it("reconnect throws when max attempts exceeded", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({
      maxReconnectAttempts: 0,
      reconnectDelayMs: 100,
      servers: [
        {
          id: "fail-srv",
          transport: { type: "http", url: "http://localhost:9999" },
          autoConnect: false,
        },
      ],
    });
    const mgr = new SessionManager(config);

    await expect(mgr.reconnect("fail-srv")).rejects.toThrow(/max reconnect attempts/);
  });

  it("disconnect is safe for non-connected server", async () => {
    const { SessionManager } = await import("./session-manager.js");
    const { mcpClientConfigSchema } = await import("./config.js");

    const config = mcpClientConfigSchema.parse({
      servers: [
        {
          id: "srv",
          transport: { type: "http", url: "http://localhost:3000" },
          autoConnect: false,
        },
      ],
    });
    const mgr = new SessionManager(config);

    // Should not throw
    await mgr.disconnect("srv");
  });
});

// ============================================================================
// Tool Bridge Integration
// ============================================================================

describe("tool bridge integration", () => {
  it("classifyMcpToolKind is exported and works", async () => {
    const { classifyMcpToolKind } = await import("./tool-bridge.js");

    expect(classifyMcpToolKind("get_user")).toBe("read");
    expect(classifyMcpToolKind("create_item")).toBe("write");
    expect(classifyMcpToolKind("run_test")).toBe("exec");
  });

  it("bridgeMcpTool is exported and works", async () => {
    const { bridgeMcpTool } = await import("./tool-bridge.js");

    const bridged = bridgeMcpTool(
      { name: "test_tool", description: "A test tool" },
      "server-1",
      "srv",
    );

    expect(bridged.name).toBe("srv_test_tool");
    expect(bridged.serverId).toBe("server-1");
    expect(bridged.originalName).toBe("test_tool");
  });
});

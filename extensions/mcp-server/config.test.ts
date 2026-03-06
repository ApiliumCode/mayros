import { describe, it, expect } from "vitest";
import { mcpServerConfigSchema, type McpServerConfig } from "./config.js";

describe("mcpServerConfigSchema", () => {
  // 1
  it("parses minimal config with defaults", () => {
    const cfg = mcpServerConfigSchema.parse({});
    expect(cfg.transport).toBe("stdio");
    expect(cfg.port).toBe(3100);
    expect(cfg.host).toBe("127.0.0.1");
    expect(cfg.serverName).toBe("mayros");
    expect(cfg.serverVersion).toBe("0.1.0");
    expect(cfg.capabilities.tools).toBe(true);
    expect(cfg.capabilities.resources).toBe(true);
    expect(cfg.capabilities.prompts).toBe(true);
    expect(cfg.auth.allowedOrigins).toEqual([]);
  });

  // 2
  it("parses full config", () => {
    const cfg = mcpServerConfigSchema.parse({
      transport: "http",
      port: 8080,
      host: "0.0.0.0",
      serverName: "my-mayros",
      serverVersion: "2.0.0",
      auth: { token: "secret", allowedOrigins: ["http://localhost:3000"] },
      capabilities: { tools: true, resources: false, prompts: true },
    });
    expect(cfg.transport).toBe("http");
    expect(cfg.port).toBe(8080);
    expect(cfg.host).toBe("0.0.0.0");
    expect(cfg.serverName).toBe("my-mayros");
    expect(cfg.auth.token).toBe("secret");
    expect(cfg.auth.allowedOrigins).toEqual(["http://localhost:3000"]);
    expect(cfg.capabilities.resources).toBe(false);
  });

  // 3
  it("rejects invalid port", () => {
    expect(() => mcpServerConfigSchema.parse({ port: 0 })).toThrow("port");
    expect(() => mcpServerConfigSchema.parse({ port: 70000 })).toThrow("port");
  });

  // 4
  it("rejects invalid namespace", () => {
    expect(() => mcpServerConfigSchema.parse({ agentNamespace: "123bad" })).toThrow(
      "agentNamespace",
    );
    expect(() => mcpServerConfigSchema.parse({ agentNamespace: "has spaces" })).toThrow(
      "agentNamespace",
    );
  });

  // 5
  it("defaults to stdio transport for unknown values", () => {
    const cfg = mcpServerConfigSchema.parse({ transport: "unknown" });
    expect(cfg.transport).toBe("stdio");
  });

  // 6
  it("parses null/undefined as defaults", () => {
    const cfg = mcpServerConfigSchema.parse(null);
    expect(cfg.transport).toBe("stdio");
    expect(cfg.port).toBe(3100);
  });

  // 7
  it("rejects unknown top-level keys", () => {
    expect(() => mcpServerConfigSchema.parse({ unknownKey: true })).toThrow();
  });

  // 8
  it("auth config handles empty/missing values", () => {
    const cfg = mcpServerConfigSchema.parse({ auth: {} });
    expect(cfg.auth.token).toBeUndefined();
    expect(cfg.auth.allowedOrigins).toEqual([]);
  });
});

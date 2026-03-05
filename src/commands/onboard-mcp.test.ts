import { describe, expect, it, vi, beforeEach } from "vitest";
import type { MayrosConfig } from "../config/config.js";
import type { RuntimeEnv } from "../runtime.js";
import type { WizardPrompter } from "../wizard/prompts.js";
import { setupMcpServers } from "./onboard-mcp.js";

describe("onboard-mcp", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.GITHUB_TOKEN;
    delete process.env.MCP_FILESYSTEM_DIR;
  });

  const createMockPrompter = (overrides: {
    confirm?: boolean;
    multiselect?: string[];
    textResponses?: string[];
  }): WizardPrompter => {
    let textCallIndex = 0;
    const texts = overrides.textResponses ?? [];
    return {
      confirm: vi.fn().mockResolvedValue(overrides.confirm ?? true),
      note: vi.fn().mockResolvedValue(undefined),
      intro: vi.fn().mockResolvedValue(undefined),
      outro: vi.fn().mockResolvedValue(undefined),
      text: vi.fn().mockImplementation(() => {
        const value = texts[textCallIndex] ?? "default-value";
        textCallIndex++;
        return Promise.resolve(value);
      }),
      select: vi.fn().mockResolvedValue(""),
      multiselect: vi.fn().mockResolvedValue(overrides.multiselect ?? []),
      progress: vi.fn().mockReturnValue({ stop: vi.fn(), update: vi.fn() }),
    };
  };

  const createMockRuntime = (): RuntimeEnv => ({
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn(),
  });

  it("returns config unchanged when user skips", async () => {
    const cfg: MayrosConfig = { agents: { defaults: { workspace: "/w" } } };
    const prompter = createMockPrompter({ confirm: false });
    const result = await setupMcpServers(cfg, createMockRuntime(), prompter);

    expect(result).toEqual(cfg);
    expect(prompter.multiselect).not.toHaveBeenCalled();
  });

  it("configures selected presets correctly", async () => {
    const prompter = createMockPrompter({
      multiselect: ["memory", "fetch"],
    });
    const result = await setupMcpServers({}, createMockRuntime(), prompter);

    const entries = result.plugins?.entries?.["mcp-client"];
    expect(entries?.enabled).toBe(true);
    const config = entries?.config as Record<string, unknown>;
    const servers = config.servers as Array<Record<string, unknown>>;
    expect(servers).toHaveLength(2);
    expect(servers[0]).toEqual({
      id: "memory",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-memory"],
      },
      autoConnect: true,
    });
    expect(servers[1]).toEqual({
      id: "fetch",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-fetch"],
      },
      autoConnect: true,
    });
  });

  it("uses env var when available for requiresInput presets", async () => {
    process.env.GITHUB_TOKEN = "ghp_test123";
    const prompter = createMockPrompter({ multiselect: ["github"] });
    const result = await setupMcpServers({}, createMockRuntime(), prompter);

    const config = result.plugins?.entries?.["mcp-client"]?.config as Record<string, unknown>;
    const servers = config.servers as Array<Record<string, unknown>>;
    expect(servers[0]).toEqual({
      id: "github",
      transport: {
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github", "ghp_test123"],
      },
      autoConnect: true,
    });
    // Should not have prompted for text input
    expect(prompter.text).not.toHaveBeenCalled();
  });

  it("prompts for input when env var is not set", async () => {
    const prompter = createMockPrompter({
      multiselect: ["filesystem"],
      textResponses: ["/home/user/code"],
    });
    const result = await setupMcpServers({}, createMockRuntime(), prompter);

    const config = result.plugins?.entries?.["mcp-client"]?.config as Record<string, unknown>;
    const servers = config.servers as Array<Record<string, unknown>>;
    expect(servers[0]!.id).toBe("filesystem");
    const transport = servers[0]!.transport as Record<string, unknown>;
    const args = transport.args as string[];
    expect(args[args.length - 1]).toBe("/home/user/code");
    expect(prompter.text).toHaveBeenCalledTimes(1);
  });

  it("handles custom server option", async () => {
    const prompter = createMockPrompter({
      multiselect: ["__custom__"],
      textResponses: ["my-server", "npx -y @my/server --flag"],
    });
    const result = await setupMcpServers({}, createMockRuntime(), prompter);

    const config = result.plugins?.entries?.["mcp-client"]?.config as Record<string, unknown>;
    const servers = config.servers as Array<Record<string, unknown>>;
    expect(servers).toHaveLength(1);
    expect(servers[0]).toEqual({
      id: "my-server",
      transport: { type: "stdio", command: "npx", args: ["-y", "@my/server", "--flag"] },
      autoConnect: true,
    });
  });

  it("preserves existing plugins config", async () => {
    const cfg: MayrosConfig = {
      plugins: {
        enabled: true,
        entries: {
          "other-plugin": { enabled: true, config: { key: "value" } },
        },
      },
    };
    const prompter = createMockPrompter({ multiselect: ["memory"] });
    const result = await setupMcpServers(cfg, createMockRuntime(), prompter);

    expect(result.plugins?.enabled).toBe(true);
    expect(result.plugins?.entries?.["other-plugin"]).toEqual({
      enabled: true,
      config: { key: "value" },
    });
    expect(result.plugins?.entries?.["mcp-client"]?.enabled).toBe(true);
  });

  it("shows summary note after configuration", async () => {
    const prompter = createMockPrompter({ multiselect: ["memory", "fetch"] });
    await setupMcpServers({}, createMockRuntime(), prompter);

    const noteCalls = (prompter.note as ReturnType<typeof vi.fn>).mock.calls;
    const lastNote = noteCalls[noteCalls.length - 1];
    expect(lastNote[0]).toContain("2 servers configured: memory, fetch");
    expect(lastNote[0]).toContain("mayros mcp list");
    expect(lastNote[1]).toBe("MCP Servers Configured");
  });
});

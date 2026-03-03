import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mock vscode module                                                 */
/* ------------------------------------------------------------------ */

const registeredCommands = new Map<string, (...args: unknown[]) => unknown>();
const registeredTreeProviders = new Map<string, unknown>();
const disposables: Array<{ dispose: () => void }> = [];

const mockConfig = new Map<string, unknown>([
  ["gatewayUrl", "ws://127.0.0.1:18789"],
  ["autoConnect", false], // Disable auto-connect in tests
  ["reconnectDelayMs", 3000],
  ["maxReconnectAttempts", 5],
]);

vi.mock("vscode", () => ({
  workspace: {
    getConfiguration: vi.fn((_section: string) => ({
      get: <T>(key: string, fallback: T): T => (mockConfig.get(key) as T) ?? fallback,
    })),
    onDidChangeConfiguration: vi.fn(() => ({ dispose: vi.fn() })),
  },
  window: {
    registerTreeDataProvider: vi.fn((id: string, provider: unknown) => {
      registeredTreeProviders.set(id, provider);
      return { dispose: vi.fn() };
    }),
    showInformationMessage: vi.fn(),
    showErrorMessage: vi.fn(),
    createWebviewPanel: vi.fn(() => ({
      webview: {
        html: "",
        asWebviewUri: vi.fn((uri: unknown) => uri),
        onDidReceiveMessage: vi.fn(),
        postMessage: vi.fn(),
      },
      onDidDispose: vi.fn(),
      reveal: vi.fn(),
      dispose: vi.fn(),
    })),
  },
  commands: {
    registerCommand: vi.fn((command: string, callback: (...args: unknown[]) => unknown) => {
      registeredCommands.set(command, callback);
      return { dispose: vi.fn() };
    }),
  },
  ViewColumn: { One: 1, Beside: 2 },
  Uri: {
    joinPath: vi.fn((...parts: unknown[]) => parts.join("/")),
  },
  EventEmitter: vi.fn(() => ({
    event: vi.fn(),
    fire: vi.fn(),
    dispose: vi.fn(),
  })),
  TreeItem: class MockTreeItem {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    iconPath?: unknown;
    tooltip?: string;
    description?: string;
    command?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class MockThemeIcon {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
}));

/* ------------------------------------------------------------------ */
/*  Mock MayrosClient — must be mocked before import                   */
/* ------------------------------------------------------------------ */

const mockClient = {
  connected: false,
  connect: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
  dispose: vi.fn(),
  listSessions: vi.fn().mockResolvedValue([]),
  listAgents: vi.fn().mockResolvedValue([]),
  getSkillsStatus: vi.fn().mockResolvedValue([]),
  on: vi.fn(),
  off: vi.fn(),
};

vi.mock("../src/mayros-client.js", () => ({
  MayrosClient: vi.fn(() => mockClient),
}));

import { activate, deactivate } from "../src/extension.js";
import * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("Extension activate/deactivate", () => {
  let context: vscode.ExtensionContext;

  beforeEach(() => {
    vi.clearAllMocks();
    registeredCommands.clear();
    registeredTreeProviders.clear();
    disposables.length = 0;
    mockClient.connected = false;

    context = {
      subscriptions: disposables,
      extensionUri: "file:///test" as unknown as vscode.Uri,
    } as unknown as vscode.ExtensionContext;
  });

  it("registers all 7 commands", () => {
    activate(context);

    const expectedCommands = [
      "mayros.connect",
      "mayros.disconnect",
      "mayros.refresh",
      "mayros.openChat",
      "mayros.openPlan",
      "mayros.openTrace",
      "mayros.openKg",
    ];

    for (const cmd of expectedCommands) {
      expect(registeredCommands.has(cmd)).toBe(true);
    }
  });

  it("registers 3 tree data providers", () => {
    activate(context);

    expect(registeredTreeProviders.has("mayros.sessions")).toBe(true);
    expect(registeredTreeProviders.has("mayros.agents")).toBe(true);
    expect(registeredTreeProviders.has("mayros.skills")).toBe(true);
  });

  it("adds disposables to context.subscriptions", () => {
    activate(context);

    // 3 tree providers + 7 commands + 1 config listener = 11
    expect(context.subscriptions.length).toBeGreaterThanOrEqual(11);
  });

  it("does not auto-connect when autoConnect is false", () => {
    activate(context);
    expect(mockClient.connect).not.toHaveBeenCalled();
  });

  it("auto-connects when autoConnect is true", () => {
    mockConfig.set("autoConnect", true);
    activate(context);
    expect(mockClient.connect).toHaveBeenCalledOnce();
    mockConfig.set("autoConnect", false); // reset
  });

  it("deactivate disposes the client", () => {
    activate(context);
    deactivate();
    expect(mockClient.dispose).toHaveBeenCalledOnce();
  });

  it("connect command shows success message", async () => {
    activate(context);
    mockClient.connect.mockResolvedValue(undefined);

    const handler = registeredCommands.get("mayros.connect")!;
    await handler();

    expect(vscode.window.showInformationMessage).toHaveBeenCalledWith(
      "Connected to Mayros gateway",
    );
  });

  it("connect command shows error on failure", async () => {
    activate(context);
    mockClient.connect.mockRejectedValue(new Error("ECONNREFUSED"));

    const handler = registeredCommands.get("mayros.connect")!;
    await handler();

    expect(vscode.window.showErrorMessage).toHaveBeenCalledWith("Connection failed: ECONNREFUSED");
  });
});

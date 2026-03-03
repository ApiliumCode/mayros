import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mock vscode module                                                 */
/* ------------------------------------------------------------------ */

const disposeCallbacks: Array<() => void> = [];
let messageCallback: ((msg: unknown) => void) | undefined;
let lastWebviewHtml = "";
const postMessageSpy = vi.fn();
const revealSpy = vi.fn();
const panelDisposeSpy = vi.fn();

function createMockPanel() {
  disposeCallbacks.length = 0;
  messageCallback = undefined;
  lastWebviewHtml = "";

  return {
    webview: {
      get html() {
        return lastWebviewHtml;
      },
      set html(v: string) {
        lastWebviewHtml = v;
      },
      asWebviewUri: vi.fn((uri: unknown) => String(uri)),
      onDidReceiveMessage: vi.fn((cb: (msg: unknown) => void) => {
        messageCallback = cb;
        return { dispose: vi.fn() };
      }),
      postMessage: postMessageSpy,
    },
    onDidDispose: vi.fn((cb: () => void) => {
      disposeCallbacks.push(cb);
      return { dispose: vi.fn() };
    }),
    reveal: revealSpy,
    dispose: panelDisposeSpy,
  };
}

let currentMockPanel: ReturnType<typeof createMockPanel>;
const createWebviewPanelSpy = vi.fn(
  (_viewType: string, _title: string, _column: number, _options: unknown) => {
    currentMockPanel = createMockPanel();
    return currentMockPanel;
  },
);

vi.mock("vscode", () => ({
  window: {
    createWebviewPanel: (...args: unknown[]) =>
      createWebviewPanelSpy(...(args as [string, string, number, unknown])),
  },
  ViewColumn: { One: 1, Beside: 2 },
  Uri: {
    joinPath: vi.fn((...parts: unknown[]) => (parts as string[]).join("/")),
  },
}));

import { ChatPanel } from "../src/panels/chat-panel.js";
import type { SessionInfo, ChatMessage } from "../src/types.js";

/* ------------------------------------------------------------------ */
/*  Mock client                                                        */
/* ------------------------------------------------------------------ */

function createMockClient(
  overrides: {
    connected?: boolean;
    sessions?: SessionInfo[];
    history?: ChatMessage[];
  } = {},
) {
  return {
    connected: overrides.connected ?? true,
    listSessions: vi.fn().mockResolvedValue(overrides.sessions ?? []),
    getChatHistory: vi.fn().mockResolvedValue(overrides.history ?? []),
    sendMessage: vi.fn().mockResolvedValue(undefined),
    abortChat: vi.fn().mockResolvedValue(undefined),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as import("../src/mayros-client.js").MayrosClient;
}

function fireDispose(): void {
  for (const cb of disposeCallbacks) cb();
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("ChatPanel", () => {
  beforeEach(() => {
    // Reset singleton by firing dispose on previous panel FIRST
    fireDispose();
    vi.clearAllMocks();
    disposeCallbacks.length = 0;
    messageCallback = undefined;
    lastWebviewHtml = "";
  });

  it("creates a webview panel with correct title", () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    expect(createWebviewPanelSpy).toHaveBeenCalledWith(
      "mayros.chat",
      "Mayros Chat",
      2, // ViewColumn.Beside
      expect.objectContaining({ enableScripts: true }),
    );
  });

  it("sets webview HTML content", () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);
    expect(lastWebviewHtml).toContain("<!DOCTYPE html>");
    expect(lastWebviewHtml).toContain("Mayros Chat");
  });

  it("reuses existing panel on second call (singleton)", () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);
    const callCountAfterFirst = createWebviewPanelSpy.mock.calls.length;

    ChatPanel.createOrShow(extensionUri, client);
    // Should reveal existing, not create new
    expect(createWebviewPanelSpy.mock.calls.length).toBe(callCountAfterFirst);
    expect(revealSpy).toHaveBeenCalled();
  });

  it("handles 'sessions' message from webview", async () => {
    const sessions: SessionInfo[] = [
      {
        id: "s1",
        status: "active",
        agentId: "default",
        startedAt: "2025-01-01",
        messageCount: 3,
      },
    ];
    const client = createMockClient({ sessions });
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    expect(messageCallback).toBeDefined();
    await messageCallback!({ type: "sessions" });

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith({
        type: "sessions",
        sessions,
      });
    });
  });

  it("handles 'history' message from webview", async () => {
    const history: ChatMessage[] = [
      { role: "user", content: "hello", timestamp: "2025-01-01T00:00:00Z" },
    ];
    const client = createMockClient({ history });
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    await messageCallback!({ type: "history", sessionId: "s1" });

    await vi.waitFor(() => {
      expect(client.getChatHistory).toHaveBeenCalledWith("s1");
      expect(postMessageSpy).toHaveBeenCalledWith({
        type: "history",
        messages: history,
      });
    });
  });

  it("handles 'send' message from webview", async () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    await messageCallback!({
      type: "send",
      sessionId: "s1",
      content: "hello world",
    });

    expect(client.sendMessage).toHaveBeenCalledWith("s1", "hello world");
  });

  it("handles 'abort' message from webview", async () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    await messageCallback!({ type: "abort", sessionId: "s1" });

    expect(client.abortChat).toHaveBeenCalledWith("s1");
  });

  it("posts error when handler throws", async () => {
    const client = createMockClient();
    (client.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(new Error("Send failed"));
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    await messageCallback!({
      type: "send",
      sessionId: "s1",
      content: "test",
    });

    await vi.waitFor(() => {
      expect(postMessageSpy).toHaveBeenCalledWith({
        type: "error",
        text: "Send failed",
      });
    });
  });

  it("cleans up singleton on dispose", () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    // Simulate dispose
    fireDispose();

    // Next createOrShow should create a new panel (not reuse)
    const callCountBefore = createWebviewPanelSpy.mock.calls.length;
    ChatPanel.createOrShow(extensionUri, client);
    expect(createWebviewPanelSpy.mock.calls.length).toBe(callCountBefore + 1);
  });

  it("subscribes to chat.message events on the client", () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    expect(client.on).toHaveBeenCalledWith("event:chat.message", expect.any(Function));
  });

  it("unsubscribes from events on dispose", () => {
    const client = createMockClient();
    const extensionUri = "file:///ext" as unknown as import("vscode").Uri;

    ChatPanel.createOrShow(extensionUri, client);

    expect(client.on).toHaveBeenCalled();

    fireDispose();

    expect(client.off).toHaveBeenCalledWith("event:chat.message", expect.any(Function));
  });
});

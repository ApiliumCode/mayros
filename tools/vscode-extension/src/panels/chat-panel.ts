import * as vscode from "vscode";
import { PanelBase } from "./panel-base.js";
import type { MayrosClient } from "../mayros-client.js";
import type { WebviewToExtension, ChatMessage, SessionInfo } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Chat panel — singleton webview for conversational interaction       */
/* ------------------------------------------------------------------ */

export class ChatPanel extends PanelBase {
  private static instance: ChatPanel | undefined;

  private eventDispose: (() => void) | undefined;
  private messageDisposable: vscode.Disposable | undefined;

  private constructor(
    extensionUri: vscode.Uri,
    private client: MayrosClient,
  ) {
    super(extensionUri, "mayros.chat", "Mayros Chat");
  }

  /* ---- singleton factory ---- */

  static createOrShow(extensionUri: vscode.Uri, client: MayrosClient): ChatPanel {
    if (ChatPanel.instance?.panel) {
      ChatPanel.instance.panel.reveal();
      return ChatPanel.instance;
    }
    const panel = new ChatPanel(extensionUri, client);
    panel.show();
    ChatPanel.instance = panel;
    return panel;
  }

  /* ---- lifecycle ---- */

  private show(): void {
    const panel = this.createPanel(vscode.ViewColumn.Beside);
    panel.webview.html = this.getWebviewContent("chat/chat.js");

    // Listen for messages from the webview
    this.messageDisposable = panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      this.handleWebviewMessage(msg).catch((err) => {
        this.postMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      });
    });

    // Subscribe to gateway streaming events (event name is "chat")
    const onStreamMessage = (...args: unknown[]) => {
      const data = args[0] as Record<string, unknown>;
      if (!data) return;
      const state = data.state as string | undefined;
      const runId = String(data.runId ?? "");
      if (!runId || !state) return;

      if (state === "delta" || state === "final") {
        const raw = data.message as Record<string, unknown> | undefined;
        let text = "";
        if (raw) {
          if (Array.isArray(raw.content)) {
            text = (raw.content as Array<Record<string, unknown>>)
              .filter((b) => b.type === "text" && typeof b.text === "string")
              .map((b) => b.text as string)
              .join("");
          } else if (typeof raw.content === "string") {
            text = raw.content;
          }
        }
        this.postMessage({
          type: "stream",
          runId,
          state: state as "delta" | "final",
          content: text,
        });
      } else if (state === "error") {
        this.postMessage({
          type: "stream",
          runId,
          state: "error",
          content: String(data.errorMessage ?? "Agent error"),
        });
      } else if (state === "aborted") {
        this.postMessage({
          type: "stream",
          runId,
          state: "aborted",
          content: "",
        });
      }
    };
    this.client.on("event:chat", onStreamMessage);

    // Forward connection status changes to the webview
    const onConnected = () => {
      this.postMessage({ type: "connectionStatus", connected: true });
    };
    const onDisconnected = () => {
      this.postMessage({ type: "connectionStatus", connected: false });
    };
    this.client.on("connected", onConnected);
    this.client.on("disconnected", onDisconnected);

    // Send initial connection status
    this.postMessage({ type: "connectionStatus", connected: this.client.connected });

    this.eventDispose = () => {
      this.client.off("event:chat", onStreamMessage);
      this.client.off("connected", onConnected);
      this.client.off("disconnected", onDisconnected);
    };

    panel.onDidDispose(() => {
      this.messageDisposable?.dispose();
      this.messageDisposable = undefined;
      this.eventDispose?.();
      this.eventDispose = undefined;
      ChatPanel.instance = undefined;
    });
  }

  /* ---- message dispatch ---- */

  private async handleWebviewMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "send":
        await this.handleSend(msg.sessionId, msg.content, msg.attachments);
        break;
      case "history":
        await this.handleHistory(msg.sessionId);
        break;
      case "abort":
        await this.handleAbort(msg.sessionId);
        break;
      case "sessions":
        await this.handleGetSessions();
        break;
    }
  }

  /* ---- handlers ---- */

  private async handleSend(
    sessionId: string,
    content: string,
    attachments?: Array<{ name: string; mimeType: string; dataBase64: string }>,
  ): Promise<void> {
    await this.client.sendMessage(sessionId, content, attachments);
  }

  private async handleHistory(sessionId: string): Promise<void> {
    const messages = await this.client.getChatHistory(sessionId);
    this.postMessage({ type: "history", messages });
  }

  private async handleAbort(sessionId: string): Promise<void> {
    await this.client.abortChat(sessionId);
  }

  private async handleGetSessions(): Promise<void> {
    const sessions: SessionInfo[] = this.client.connected ? await this.client.listSessions() : [];
    this.postMessage({ type: "sessions", sessions });
  }
}

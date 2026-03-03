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
    panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      this.handleWebviewMessage(msg).catch((err) => {
        this.postMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      });
    });

    // Subscribe to gateway streaming events
    const onStreamMessage = (...args: unknown[]) => {
      const data = args[0] as { sessionId: string; message: ChatMessage };
      if (data?.message) {
        this.postMessage({ type: "message", message: data.message });
      }
    };
    this.client.on("event:chat.message", onStreamMessage);
    this.eventDispose = () => this.client.off("event:chat.message", onStreamMessage);

    panel.onDidDispose(() => {
      this.eventDispose?.();
      this.eventDispose = undefined;
      ChatPanel.instance = undefined;
    });
  }

  /* ---- message dispatch ---- */

  private async handleWebviewMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "send":
        await this.handleSend(msg.sessionId, msg.content);
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

  private async handleSend(sessionId: string, content: string): Promise<void> {
    await this.client.sendMessage(sessionId, content);
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

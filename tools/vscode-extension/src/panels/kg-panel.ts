import * as vscode from "vscode";
import { PanelBase } from "./panel-base.js";
import type { MayrosClient } from "../mayros-client.js";
import type { WebviewToExtension } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Knowledge Graph panel — triple browser and search                  */
/* ------------------------------------------------------------------ */

export class KgPanel extends PanelBase {
  private static instance: KgPanel | undefined;
  private messageDisposable: vscode.Disposable | undefined;

  private constructor(
    extensionUri: vscode.Uri,
    private client: MayrosClient,
  ) {
    super(extensionUri, "mayros.kg", "Mayros Knowledge Graph");
  }

  /* ---- singleton factory ---- */

  static createOrShow(extensionUri: vscode.Uri, client: MayrosClient): KgPanel {
    if (KgPanel.instance?.panel) {
      KgPanel.instance.panel.reveal();
      return KgPanel.instance;
    }
    const panel = new KgPanel(extensionUri, client);
    panel.show();
    KgPanel.instance = panel;
    return panel;
  }

  /* ---- lifecycle ---- */

  private show(): void {
    const panel = this.createPanel(vscode.ViewColumn.Beside);
    panel.webview.html = this.getWebviewContent("kg/kg.js");

    this.messageDisposable = panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      this.handleWebviewMessage(msg).catch((err) => {
        this.postMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      });
    });

    panel.onDidDispose(() => {
      this.messageDisposable?.dispose();
      this.messageDisposable = undefined;
      KgPanel.instance = undefined;
    });
  }

  /* ---- message dispatch ---- */

  private async handleWebviewMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "kg.search":
        await this.handleSearch(msg.query, msg.limit);
        break;
      case "kg.explore":
        await this.handleExplore(msg.subject);
        break;
    }
  }

  /* ---- handlers ---- */

  private async handleSearch(query: string, limit?: number): Promise<void> {
    const entries = await this.client.queryKg(query, limit ?? 50);
    this.postMessage({ type: "kg.results", entries });
  }

  private async handleExplore(subject: string): Promise<void> {
    // Query all triples where the given subject is either the subject or object
    const entries = await this.client.queryKg(subject, 100);
    this.postMessage({ type: "kg.results", entries });
  }
}

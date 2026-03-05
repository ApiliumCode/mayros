import * as vscode from "vscode";
import { PanelBase } from "./panel-base.js";
import type { MayrosClient } from "../mayros-client.js";
import type { WebviewToExtension, PlanInfo } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Plan panel — phase progress display for Plan Mode                  */
/* ------------------------------------------------------------------ */

export class PlanPanel extends PanelBase {
  private static instance: PlanPanel | undefined;

  private eventDispose: (() => void) | undefined;

  private constructor(
    extensionUri: vscode.Uri,
    private client: MayrosClient,
  ) {
    super(extensionUri, "mayros.plan", "Mayros Plan Mode");
  }

  /* ---- singleton factory ---- */

  static createOrShow(extensionUri: vscode.Uri, client: MayrosClient): PlanPanel {
    if (PlanPanel.instance?.panel) {
      PlanPanel.instance.panel.reveal();
      return PlanPanel.instance;
    }
    const panel = new PlanPanel(extensionUri, client);
    panel.show();
    PlanPanel.instance = panel;
    return panel;
  }

  /* ---- lifecycle ---- */

  private show(): void {
    const panel = this.createPanel(vscode.ViewColumn.Beside);
    panel.webview.html = this.getWebviewContent("plan/plan.js");

    panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      this.handleWebviewMessage(msg).catch((err) => {
        this.postMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      });
    });

    // Subscribe to plan phase changes
    const onPlanUpdate = (...args: unknown[]) => {
      const data = args[0] as PlanInfo;
      if (data) {
        this.postMessage({ type: "plan.data", plan: data });
      }
    };
    this.client.on("event:plan.updated", onPlanUpdate);
    this.eventDispose = () => this.client.off("event:plan.updated", onPlanUpdate);

    panel.onDidDispose(() => {
      this.eventDispose?.();
      this.eventDispose = undefined;
      PlanPanel.instance = undefined;
    });
  }

  /* ---- message dispatch ---- */

  private async handleWebviewMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "plan.refresh":
        await this.handleRefresh(msg.sessionId);
        break;
      case "sessions":
        await this.handleGetSessions();
        break;
    }
  }

  /* ---- handlers ---- */

  private async handleRefresh(sessionId: string): Promise<void> {
    const plan = await this.client.getPlan(sessionId);
    this.postMessage({ type: "plan.data", plan });
  }

  private async handleGetSessions(): Promise<void> {
    const sessions = this.client.connected ? await this.client.listSessions() : [];
    this.postMessage({ type: "sessions", sessions });
  }
}

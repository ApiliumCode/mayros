import * as vscode from "vscode";
import { PanelBase } from "./panel-base.js";
import type { MayrosClient } from "../mayros-client.js";
import type { WebviewToExtension, TraceEvent } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Trace panel — event timeline viewer                                */
/* ------------------------------------------------------------------ */

export class TracePanel extends PanelBase {
  private static instance: TracePanel | undefined;

  private eventDispose: (() => void) | undefined;

  private constructor(
    extensionUri: vscode.Uri,
    private client: MayrosClient,
  ) {
    super(extensionUri, "mayros.trace", "Mayros Trace Viewer");
  }

  /* ---- singleton factory ---- */

  static createOrShow(extensionUri: vscode.Uri, client: MayrosClient): TracePanel {
    if (TracePanel.instance?.panel) {
      TracePanel.instance.panel.reveal();
      return TracePanel.instance;
    }
    const panel = new TracePanel(extensionUri, client);
    panel.show();
    TracePanel.instance = panel;
    return panel;
  }

  /* ---- lifecycle ---- */

  private show(): void {
    const panel = this.createPanel(vscode.ViewColumn.Beside);
    panel.webview.html = this.getWebviewContent("trace/trace.js");

    panel.webview.onDidReceiveMessage((msg: WebviewToExtension) => {
      this.handleWebviewMessage(msg).catch((err) => {
        this.postMessage({
          type: "error",
          text: err instanceof Error ? err.message : String(err),
        });
      });
    });

    // Subscribe to real-time trace events
    const onTraceEvent = (...args: unknown[]) => {
      const data = args[0] as TraceEvent;
      if (data) {
        this.postMessage({ type: "trace.data", events: [data] });
      }
    };
    this.client.on("event:trace.event", onTraceEvent);
    this.eventDispose = () => this.client.off("event:trace.event", onTraceEvent);

    panel.onDidDispose(() => {
      this.eventDispose?.();
      this.eventDispose = undefined;
      TracePanel.instance = undefined;
    });
  }

  /* ---- message dispatch ---- */

  private async handleWebviewMessage(msg: WebviewToExtension): Promise<void> {
    switch (msg.type) {
      case "trace.refresh":
        await this.handleRefresh(msg.agentId, msg.limit);
        break;
      case "trace.filter":
        await this.handleFilter(msg.filterType, msg.filterValue);
        break;
    }
  }

  /* ---- handlers ---- */

  private async handleRefresh(agentId?: string, limit?: number): Promise<void> {
    const events = await this.client.getTraceEvents({
      agentId,
      limit: limit ?? 100,
    });
    this.postMessage({ type: "trace.data", events });
  }

  private async handleFilter(filterType: string, filterValue: string): Promise<void> {
    const options: Record<string, unknown> = { limit: 100 };
    if (filterType === "agent") options.agentId = filterValue;
    const events = await this.client.getTraceEvents(
      options as { agentId?: string; limit?: number },
    );
    this.postMessage({ type: "trace.data", events });
  }
}

import * as vscode from "vscode";

/* ------------------------------------------------------------------ */
/*  Base class for webview panels                                      */
/* ------------------------------------------------------------------ */

export abstract class PanelBase {
  protected panel: vscode.WebviewPanel | undefined;

  constructor(
    protected extensionUri: vscode.Uri,
    protected viewType: string,
    protected title: string,
  ) {}

  /**
   * Create the underlying WebviewPanel.
   * Subclasses call this from their `show()` method.
   */
  protected createPanel(column?: vscode.ViewColumn): vscode.WebviewPanel {
    this.panel = vscode.window.createWebviewPanel(
      this.viewType,
      this.title,
      column ?? vscode.ViewColumn.One,
      {
        enableScripts: true,
        retainContextWhenHidden: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, "dist", "webview")],
      },
    );
    this.panel.onDidDispose(() => {
      this.panel = undefined;
    });
    return this.panel;
  }

  /**
   * Build the HTML shell for a webview.
   * @param scriptName — relative path inside `dist/webview/`, e.g. `"chat/chat.js"`.
   */
  protected getWebviewContent(scriptName: string): string {
    if (!this.panel) return "";
    const scriptUri = this.panel.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, "dist", "webview", scriptName),
    );
    const nonce = getNonce();
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
        content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:;">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${this.title}</title>
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      background: var(--vscode-editor-background);
      margin: 0;
      padding: 8px;
    }
    #app { height: 100vh; display: flex; flex-direction: column; }
  </style>
</head>
<body>
  <div id="app"></div>
  <script nonce="${nonce}" type="module" src="${scriptUri}"></script>
</body>
</html>`;
  }

  /**
   * Post a message from the extension host to the webview.
   */
  protected postMessage(message: unknown): void {
    this.panel?.webview.postMessage(message);
  }

  /** Dispose the underlying panel. */
  dispose(): void {
    this.panel?.dispose();
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let result = "";
  for (let i = 0; i < 32; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
}

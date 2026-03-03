import * as vscode from "vscode";
import type { MayrosClient } from "../mayros-client.js";
import type { SessionInfo } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Sessions tree data provider                                        */
/* ------------------------------------------------------------------ */

export class SessionsTreeProvider implements vscode.TreeDataProvider<SessionTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SessionTreeItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  private client: MayrosClient;

  constructor(client: MayrosClient) {
    this.client = client;
  }

  /** Replace the client instance (used after config change). */
  setClient(client: MayrosClient): void {
    this.client = client;
    this.refresh();
  }

  /** Force the tree to re-render. */
  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: SessionTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SessionTreeItem): Promise<SessionTreeItem[]> {
    // No nested children
    if (element) return [];

    if (!this.client.connected) {
      return [new SessionTreeItem("Not connected", "disconnected")];
    }

    try {
      const sessions = await this.client.listSessions();
      if (sessions.length === 0) {
        return [new SessionTreeItem("No sessions", "empty")];
      }
      return sessions.map((s) => new SessionTreeItem(formatSessionLabel(s), s.status, s.id, s));
    } catch {
      return [new SessionTreeItem("Error loading sessions", "error")];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Tree item                                                          */
/* ------------------------------------------------------------------ */

class SessionTreeItem extends vscode.TreeItem {
  constructor(label: string, status: string, sessionId?: string, session?: SessionInfo) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = status;
    this.iconPath = iconForStatus(status);

    if (sessionId && session) {
      this.tooltip = [
        `Session: ${sessionId}`,
        `Agent: ${session.agentId}`,
        `Status: ${session.status}`,
        `Messages: ${session.messageCount}`,
        `Started: ${session.startedAt}`,
      ].join("\n");
      this.description = session.status;
      this.command = {
        command: "mayros.openChat",
        title: "Open Chat",
        arguments: [sessionId],
      };
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatSessionLabel(session: SessionInfo): string {
  const msgs = session.messageCount === 1 ? "1 msg" : `${session.messageCount} msgs`;
  return `${session.agentId} (${msgs})`;
}

function iconForStatus(status: string): vscode.ThemeIcon {
  switch (status) {
    case "active":
      return new vscode.ThemeIcon("debug-start");
    case "idle":
      return new vscode.ThemeIcon("debug-pause");
    case "ended":
      return new vscode.ThemeIcon("debug-stop");
    case "disconnected":
      return new vscode.ThemeIcon("debug-disconnect");
    case "error":
      return new vscode.ThemeIcon("error");
    case "empty":
      return new vscode.ThemeIcon("circle-outline");
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

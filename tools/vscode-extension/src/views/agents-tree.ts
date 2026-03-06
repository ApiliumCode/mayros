import * as vscode from "vscode";
import type { MayrosClient } from "../mayros-client.js";
import type { AgentInfo } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Agents tree data provider                                          */
/* ------------------------------------------------------------------ */

export class AgentsTreeProvider implements vscode.TreeDataProvider<AgentTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<AgentTreeItem | undefined>();
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

  /** Dispose the internal event emitter. */
  dispose(): void {
    this._onDidChangeTreeData.dispose();
  }

  getTreeItem(element: AgentTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: AgentTreeItem): Promise<AgentTreeItem[]> {
    if (element) return [];

    if (!this.client.connected) {
      return [new AgentTreeItem("Not connected", "disconnected")];
    }

    try {
      const agents = await this.client.listAgents();
      if (agents.length === 0) {
        return [new AgentTreeItem("No agents configured", "empty")];
      }
      return agents.map(
        (a) => new AgentTreeItem(formatAgentLabel(a), a.isDefault ? "default" : "agent", a),
      );
    } catch {
      return [new AgentTreeItem("Error loading agents", "error")];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Tree item                                                          */
/* ------------------------------------------------------------------ */

class AgentTreeItem extends vscode.TreeItem {
  constructor(label: string, status: string, agent?: AgentInfo) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = status;
    this.iconPath = iconForAgentStatus(status);

    if (agent) {
      this.tooltip = [
        `Agent: ${agent.id}`,
        `Name: ${agent.name}`,
        agent.description ? `Description: ${agent.description}` : "",
        agent.isDefault ? "Default agent" : "",
      ]
        .filter(Boolean)
        .join("\n");
      this.description = agent.isDefault ? "default" : agent.id;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatAgentLabel(agent: AgentInfo): string {
  const suffix = agent.isDefault ? " *" : "";
  return `${agent.name}${suffix}`;
}

function iconForAgentStatus(status: string): vscode.ThemeIcon {
  switch (status) {
    case "default":
      return new vscode.ThemeIcon("account");
    case "agent":
      return new vscode.ThemeIcon("person");
    case "disconnected":
      return new vscode.ThemeIcon("debug-disconnect");
    case "error":
      return new vscode.ThemeIcon("error");
    case "empty":
      return new vscode.ThemeIcon("circle-outline");
    default:
      return new vscode.ThemeIcon("person");
  }
}

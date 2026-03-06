import * as vscode from "vscode";
import type { MayrosClient } from "../mayros-client.js";
import type { SkillInfo } from "../types.js";

/* ------------------------------------------------------------------ */
/*  Skills tree data provider                                          */
/* ------------------------------------------------------------------ */

export class SkillsTreeProvider implements vscode.TreeDataProvider<SkillTreeItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<SkillTreeItem | undefined>();
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

  getTreeItem(element: SkillTreeItem): vscode.TreeItem {
    return element;
  }

  async getChildren(element?: SkillTreeItem): Promise<SkillTreeItem[]> {
    if (element) return [];

    if (!this.client.connected) {
      return [new SkillTreeItem("Not connected", "disconnected")];
    }

    try {
      const skills = await this.client.getSkillsStatus();
      if (skills.length === 0) {
        return [new SkillTreeItem("No skills loaded", "empty")];
      }
      return skills.map((s) => new SkillTreeItem(formatSkillLabel(s), s.status, s));
    } catch {
      return [new SkillTreeItem("Error loading skills", "error")];
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Tree item                                                          */
/* ------------------------------------------------------------------ */

class SkillTreeItem extends vscode.TreeItem {
  constructor(label: string, status: string, skill?: SkillInfo) {
    super(label, vscode.TreeItemCollapsibleState.None);
    this.contextValue = status;
    this.iconPath = iconForSkillStatus(status);

    if (skill) {
      const lines = [
        `Skill: ${skill.name}`,
        `Status: ${skill.status}`,
        `Queries: ${skill.queryCount}`,
      ];
      if (skill.lastUsedAt) {
        lines.push(`Last used: ${skill.lastUsedAt}`);
      }
      this.tooltip = lines.join("\n");
      this.description = `${skill.queryCount} queries`;
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatSkillLabel(skill: SkillInfo): string {
  return skill.name;
}

function iconForSkillStatus(status: string): vscode.ThemeIcon {
  switch (status) {
    case "active":
      return new vscode.ThemeIcon("check");
    case "inactive":
      return new vscode.ThemeIcon("circle-outline");
    case "error":
      return new vscode.ThemeIcon("error");
    case "disconnected":
      return new vscode.ThemeIcon("debug-disconnect");
    case "empty":
      return new vscode.ThemeIcon("circle-outline");
    default:
      return new vscode.ThemeIcon("circle-outline");
  }
}

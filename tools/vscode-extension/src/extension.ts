import * as vscode from "vscode";
import { MayrosClient } from "./mayros-client.js";
import { getConfig, onConfigChange } from "./config.js";
import { SessionsTreeProvider } from "./views/sessions-tree.js";
import { AgentsTreeProvider } from "./views/agents-tree.js";
import { SkillsTreeProvider } from "./views/skills-tree.js";
import { ChatPanel } from "./panels/chat-panel.js";
import { PlanPanel } from "./panels/plan-panel.js";
import { TracePanel } from "./panels/trace-panel.js";
import { KgPanel } from "./panels/kg-panel.js";

let client: MayrosClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const config = getConfig();
  client = new MayrosClient(config.gatewayUrl, {
    maxReconnectAttempts: config.maxReconnectAttempts,
    reconnectDelayMs: config.reconnectDelayMs,
  });

  // Sidebar tree-view providers
  const sessionsProvider = new SessionsTreeProvider(client);
  const agentsProvider = new AgentsTreeProvider(client);
  const skillsProvider = new SkillsTreeProvider(client);

  context.subscriptions.push(
    vscode.window.registerTreeDataProvider("mayros.sessions", sessionsProvider),
    vscode.window.registerTreeDataProvider("mayros.agents", agentsProvider),
    vscode.window.registerTreeDataProvider("mayros.skills", skillsProvider),
  );

  // Commands
  context.subscriptions.push(
    vscode.commands.registerCommand("mayros.connect", async () => {
      try {
        await client!.connect();
        vscode.window.showInformationMessage("Connected to Mayros gateway");
        refreshAll();
      } catch (e) {
        vscode.window.showErrorMessage(
          `Connection failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),

    vscode.commands.registerCommand("mayros.disconnect", async () => {
      await client!.disconnect();
      vscode.window.showInformationMessage("Disconnected from Mayros gateway");
      refreshAll();
    }),

    vscode.commands.registerCommand("mayros.refresh", () => {
      refreshAll();
    }),

    vscode.commands.registerCommand("mayros.openChat", () => {
      ChatPanel.createOrShow(context.extensionUri, client!);
    }),

    vscode.commands.registerCommand("mayros.openPlan", () => {
      PlanPanel.createOrShow(context.extensionUri, client!);
    }),

    vscode.commands.registerCommand("mayros.openTrace", () => {
      TracePanel.createOrShow(context.extensionUri, client!);
    }),

    vscode.commands.registerCommand("mayros.openKg", () => {
      KgPanel.createOrShow(context.extensionUri, client!);
    }),
  );

  // React to configuration changes
  context.subscriptions.push(
    onConfigChange((newConfig) => {
      if (client && client.connected) {
        client
          .disconnect()
          .then(() => {
            client = new MayrosClient(newConfig.gatewayUrl, {
              maxReconnectAttempts: newConfig.maxReconnectAttempts,
              reconnectDelayMs: newConfig.reconnectDelayMs,
            });
            // Re-wire tree providers
            sessionsProvider.setClient(client!);
            agentsProvider.setClient(client!);
            skillsProvider.setClient(client!);
            if (newConfig.autoConnect) {
              client!.connect().catch(() => {});
            }
          })
          .catch(() => {});
      } else {
        client = new MayrosClient(newConfig.gatewayUrl, {
          maxReconnectAttempts: newConfig.maxReconnectAttempts,
          reconnectDelayMs: newConfig.reconnectDelayMs,
        });
        sessionsProvider.setClient(client!);
        agentsProvider.setClient(client!);
        skillsProvider.setClient(client!);
      }
    }),
  );

  // Auto-connect on activation
  if (config.autoConnect) {
    client.connect().catch(() => {
      /* silent on startup — user can manually connect */
    });
  }

  function refreshAll(): void {
    sessionsProvider.refresh();
    agentsProvider.refresh();
    skillsProvider.refresh();
  }
}

export function deactivate(): void {
  if (client) {
    client.dispose();
    client = undefined;
  }
}

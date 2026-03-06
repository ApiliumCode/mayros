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
import { explainCode, sendSelection } from "./editor/code-actions.js";
import { MayrosCodeLensProvider, sendMarker } from "./editor/gutter-markers.js";

let client: MayrosClient | undefined;

export function activate(context: vscode.ExtensionContext): void {
  const config = getConfig();

  client = new MayrosClient(config.gatewayUrl, {
    maxReconnectAttempts: config.maxReconnectAttempts,
    reconnectDelayMs: config.reconnectDelayMs,
    token: config.gatewayToken || undefined,
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
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      try {
        await client.connect();
        vscode.window.showInformationMessage("Connected to Mayros gateway");
        refreshAll();
      } catch (e) {
        vscode.window.showErrorMessage(
          `Connection failed: ${e instanceof Error ? e.message : String(e)}`,
        );
      }
    }),

    vscode.commands.registerCommand("mayros.disconnect", async () => {
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      await client.disconnect();
      vscode.window.showInformationMessage("Disconnected from Mayros gateway");
      refreshAll();
    }),

    vscode.commands.registerCommand("mayros.refresh", () => {
      refreshAll();
    }),

    vscode.commands.registerCommand("mayros.openChat", () => {
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      ChatPanel.createOrShow(context.extensionUri, client);
    }),

    vscode.commands.registerCommand("mayros.openPlan", () => {
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      PlanPanel.createOrShow(context.extensionUri, client);
    }),

    vscode.commands.registerCommand("mayros.openTrace", () => {
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      TracePanel.createOrShow(context.extensionUri, client);
    }),

    vscode.commands.registerCommand("mayros.openKg", () => {
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      KgPanel.createOrShow(context.extensionUri, client);
    }),

    // Editor context actions
    vscode.commands.registerCommand("mayros.explainCode", () => {
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      explainCode(client);
    }),

    vscode.commands.registerCommand("mayros.sendSelection", () => {
      if (!client) {
        vscode.window.showWarningMessage("Mayros client not initialized");
        return;
      }
      sendSelection(client);
    }),

    vscode.commands.registerCommand(
      "mayros.sendMarker",
      (file: string, line: number, text: string) => {
        if (!client) {
          vscode.window.showWarningMessage("Mayros client not initialized");
          return;
        }
        sendMarker(client, file, line, text);
      },
    ),

    // CodeLens provider for gutter markers
    vscode.languages.registerCodeLensProvider({ scheme: "file" }, new MayrosCodeLensProvider()),
  );

  // React to configuration changes
  context.subscriptions.push(
    onConfigChange((newConfig) => {
      const rewireClient = (): void => {
        client = new MayrosClient(newConfig.gatewayUrl, {
          maxReconnectAttempts: newConfig.maxReconnectAttempts,
          reconnectDelayMs: newConfig.reconnectDelayMs,
          token: newConfig.gatewayToken || undefined,
        });
        sessionsProvider.setClient(client);
        agentsProvider.setClient(client);
        skillsProvider.setClient(client);
        if (newConfig.autoConnect) {
          client.connect().catch((e) => {
            console.error("[Mayros] Auto-reconnect after config change failed:", e);
          });
        }
      };

      if (client && client.connected) {
        client
          .disconnect()
          .then(rewireClient)
          .catch((e) => {
            console.error("[Mayros] Disconnect during config change failed:", e);
            rewireClient();
          });
      } else {
        rewireClient();
      }
    }),
  );

  // Auto-connect on activation (retry once after short delay on failure)
  if (config.autoConnect) {
    client
      .connect()
      .then(() => {
        refreshAll();
      })
      .catch((e) => {
        console.error("[Mayros] Initial auto-connect failed, retrying in 2s:", e);
        setTimeout(() => {
          client
            ?.connect()
            .then(() => refreshAll())
            .catch((retryErr) => {
              console.error("[Mayros] Auto-connect retry failed:", retryErr);
            });
        }, 2000);
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

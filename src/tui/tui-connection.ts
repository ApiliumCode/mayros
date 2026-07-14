/**
 * Gateway connection handlers extracted from tui.ts.
 *
 * Wires the GatewayChatClient lifecycle callbacks (onEvent, onConnected,
 * onDisconnected, onGap) and starts the client + TUI. The pairing/gateway-down
 * hint flags are internal to this module since they are only relevant during
 * connection transitions.
 */

import type { ChatLog } from "./components/chat-log.js";
import type { GatewayChatClient } from "./gateway-chat.js";
import { isLoopbackHost } from "../gateway/net.js";
import type { TuiOptions, TuiStateAccess } from "./tui-types.js";
import type { Component, TUI } from "@earendil-works/pi-tui";
import { resolveGatewayDisconnectState, tryInlinePairingApproval } from "./tui-helpers.js";

export interface ConnectionHandlerDeps {
  client: GatewayChatClient;
  tui: TUI;
  chatLog: ChatLog;
  opts: TuiOptions;
  state: TuiStateAccess;
  autoMessage: string | undefined;
  createWelcomeScreen: () => Component;
  refreshAgents: () => Promise<void>;
  refreshSessionInfo: () => Promise<void>;
  loadHistory: () => Promise<void>;
  sendMessage: (text: string) => Promise<void>;
  updateHeader: () => void;
  updateFooter: () => void;
  setConnectionStatus: (text: string, ttlMs?: number) => void;
  setActivityStatus: (text: string) => void;
  handleChatEvent: (payload: unknown) => void;
  handleAgentEvent: (payload: unknown) => void;
}

/**
 * Wires all client callbacks. Internal flags (pairingHintShown,
 * gatewayDownHintShown, wasDisconnected) track hint deduplication across
 * reconnect cycles.
 */
export function wireConnectionHandlers(deps: ConnectionHandlerDeps): void {
  const { client, tui, chatLog, opts, state } = deps;

  let pairingHintShown = false;
  let gatewayDownHintShown = false;
  let wasDisconnected = false;

  client.onEvent = (evt) => {
    if (evt.event === "chat") {
      deps.handleChatEvent(evt.payload);
    }
    if (evt.event === "agent") {
      deps.handleAgentEvent(evt.payload);
    }
  };

  client.onConnected = () => {
    state.isConnected = true;
    pairingHintShown = false;
    gatewayDownHintShown = false;
    const reconnected = wasDisconnected;
    wasDisconnected = false;
    deps.setConnectionStatus("connected");
    void (async () => {
      await deps.refreshAgents();
      deps.updateHeader();
      if (opts.cleanStart && !reconnected) {
        chatLog.clearAll();
        chatLog.addWelcome(deps.createWelcomeScreen());
        state.historyLoaded = true;
        await deps.refreshSessionInfo();
      } else {
        await deps.loadHistory();
      }
      deps.setConnectionStatus(reconnected ? "gateway reconnected" : "gateway connected", 4000);
      tui.requestRender();
      if (!state.autoMessageSent && deps.autoMessage) {
        state.autoMessageSent = true;
        await deps.sendMessage(deps.autoMessage);
      }
      deps.updateFooter();
      tui.requestRender();
    })();
  };

  client.onDisconnected = (reason) => {
    state.isConnected = false;
    wasDisconnected = true;
    state.historyLoaded = false;
    const disconnectState = resolveGatewayDisconnectState(reason);
    deps.setConnectionStatus(disconnectState.connectionStatus, 5000);
    deps.setActivityStatus(disconnectState.activityStatus);
    if (disconnectState.pairingHint && !pairingHintShown) {
      pairingHintShown = true;
      if (isLoopbackHost(new URL(client.connection.url).hostname)) {
        void tryInlinePairingApproval().then((ok) => {
          if (ok) {
            chatLog.addSystem("Device paired. Reconnecting...");
          } else {
            chatLog.addSystem(disconnectState.pairingHint!);
          }
          tui.requestRender();
        });
      } else {
        chatLog.addSystem(disconnectState.pairingHint);
      }
    }
    if (disconnectState.gatewayDownHint && !gatewayDownHintShown) {
      gatewayDownHintShown = true;
      chatLog.addSystem(disconnectState.gatewayDownHint);
    }
    deps.updateFooter();
    tui.requestRender();
  };

  client.onGap = (info) => {
    deps.setConnectionStatus(`event gap: expected ${info.expected}, got ${info.received}`, 5000);
    tui.requestRender();
  };
}

import { randomUUID } from "node:crypto";
import type { Component, TUI } from "@earendil-works/pi-tui";
import type { SessionsPatchResult } from "../gateway/protocol/index.js";
import { formatRelativeTimestamp } from "../infra/format-time/format-relative.ts";
import { normalizeAgentId } from "../routing/session-key.js";
import { parseCommand } from "./commands.js";
import type { ChatLog } from "./components/chat-log.js";
import {
  createFilterableSelectList,
  createSearchableSelectList,
  createSettingsList,
} from "./components/selectors.js";
import type { ChatAttachmentInput, GatewayChatClient } from "./gateway-chat.js";
import { applyOutputStyle } from "./output-styles.js";
import type { OutputStyle } from "./output-styles.js";
import type { AgentSummary, TuiOptions, TuiStateAccess } from "./tui-types.js";
import type { CommandHandlerContext, CommandGroupHandler } from "./tui-cmd-types.js";
import { sessionCommands } from "./tui-cmd-session.js";
import { configCommands } from "./tui-cmd-config.js";
import { displayCommands } from "./tui-cmd-display.js";
import { clipboardCommands } from "./tui-cmd-clipboard.js";
import { ecosystemCommands } from "./tui-cmd-ecosystem.js";
import { teleportCommands } from "./tui-cmd-teleport.js";
import { miscCommands } from "./tui-cmd-misc.js";

export type { CommandHandlerContext } from "./tui-cmd-types.js";

/**
 * Base context shape that callers (runTui) provide. The shared closures
 * (sendMessage, setAgent, selectors) are constructed inside
 * createCommandHandlers and added to produce the full CommandHandlerContext
 * passed to each command group.
 */
type CommandHandlerBaseContext = {
  client: GatewayChatClient;
  chatLog: ChatLog;
  tui: TUI;
  opts: TuiOptions;
  state: TuiStateAccess;
  deliverDefault: boolean;
  openOverlay: (component: Component) => void;
  closeOverlay: () => void;
  refreshSessionInfo: () => Promise<void>;
  loadHistory: () => Promise<void>;
  setSession: (key: string) => Promise<void>;
  refreshAgents: () => Promise<void>;
  abortActive: () => Promise<void>;
  setActivityStatus: (text: string) => void;
  formatSessionKey: (key: string) => string;
  applySessionInfoFromPatch: (result: SessionsPatchResult) => void;
  noteLocalRunId: (runId: string) => void;
  forgetLocalRunId?: (runId: string) => void;
  mouseHandler?: { enable(): void; disable(): void; isEnabled(): boolean };
};

export function createCommandHandlers(base: CommandHandlerBaseContext) {
  const {
    client,
    chatLog,
    tui,
    opts,
    state,
    deliverDefault,
    openOverlay,
    closeOverlay,
    refreshSessionInfo,
    loadHistory,
    setSession,
    refreshAgents,
    setActivityStatus,
    formatSessionKey,
    applySessionInfoFromPatch,
    noteLocalRunId,
    forgetLocalRunId,
  } = base;

  const setAgent = async (id: string) => {
    state.currentAgentId = normalizeAgentId(id);
    await setSession("");
  };

  const openModelSelector = async () => {
    try {
      const models = await client.listModels();
      if (models.length === 0) {
        chatLog.addSystem("no models available");
        tui.requestRender();
        return;
      }
      const items = models.map((model) => ({
        value: `${model.provider}/${model.id}`,
        label: `${model.provider}/${model.id}`,
        description: model.name && model.name !== model.id ? model.name : "",
      }));
      const selector = createSearchableSelectList(items, 9);
      selector.onSelect = (item) => {
        void (async () => {
          try {
            const result = await client.patchSession({
              key: state.currentSessionKey,
              model: item.value,
            });
            chatLog.addSystem(`model set to ${item.value}`);
            applySessionInfoFromPatch(result);
            await refreshSessionInfo();
          } catch (err) {
            chatLog.addSystem(`model set failed: ${String(err)}`);
          }
          closeOverlay();
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`model list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  const openAgentSelector = async () => {
    await refreshAgents();
    if (state.agents.length === 0) {
      chatLog.addSystem("no agents found");
      tui.requestRender();
      return;
    }
    const items = state.agents.map((agent: AgentSummary) => ({
      value: agent.id,
      label: agent.name ? `${agent.id} (${agent.name})` : agent.id,
      description: agent.id === state.agentDefaultId ? "default" : "",
    }));
    const selector = createSearchableSelectList(items, 9);
    selector.onSelect = (item) => {
      void (async () => {
        closeOverlay();
        await setAgent(item.value);
        tui.requestRender();
      })();
    };
    selector.onCancel = () => {
      closeOverlay();
      tui.requestRender();
    };
    openOverlay(selector);
    tui.requestRender();
  };

  const openSessionSelector = async () => {
    try {
      const result = await client.listSessions({
        includeGlobal: false,
        includeUnknown: false,
        includeDerivedTitles: true,
        includeLastMessage: true,
        agentId: state.currentAgentId,
      });
      const items = result.sessions.map((session) => {
        const title = session.derivedTitle ?? session.displayName;
        const formattedKey = formatSessionKey(session.key);
        // Avoid redundant "title (key)" when title matches key
        const label = title && title !== formattedKey ? `${title} (${formattedKey})` : formattedKey;
        // Build description: time + message preview
        const timePart = session.updatedAt
          ? formatRelativeTimestamp(session.updatedAt, { dateFallback: true, fallback: "" })
          : "";
        const preview = session.lastMessagePreview?.replace(/\s+/g, " ").trim();
        const description =
          timePart && preview ? `${timePart} · ${preview}` : (preview ?? timePart);
        return {
          value: session.key,
          label,
          description,
          searchText: [
            session.displayName,
            session.label,
            session.subject,
            session.sessionId,
            session.key,
            session.lastMessagePreview,
          ]
            .filter(Boolean)
            .join(" "),
        };
      });
      const selector = createFilterableSelectList(items, 9);
      selector.onSelect = (item) => {
        void (async () => {
          closeOverlay();
          await setSession(item.value);
          tui.requestRender();
        })();
      };
      selector.onCancel = () => {
        closeOverlay();
        tui.requestRender();
      };
      openOverlay(selector);
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`sessions list failed: ${String(err)}`);
      tui.requestRender();
    }
  };

  const openSettings = () => {
    const items = [
      {
        id: "tools",
        label: "Tool output",
        currentValue: state.toolsExpanded ? "expanded" : "collapsed",
        values: ["collapsed", "expanded"],
      },
      {
        id: "thinking",
        label: "Show thinking",
        currentValue: state.showThinking ? "on" : "off",
        values: ["off", "on"],
      },
      {
        id: "permission",
        label: "Permission mode",
        currentValue: state.permissionMode ?? "auto",
        values: ["auto", "ask", "deny"],
      },
    ];
    const settings = createSettingsList(
      items,
      (id, value) => {
        if (id === "tools") {
          state.toolsExpanded = value === "expanded";
          chatLog.setToolsExpanded(state.toolsExpanded);
        }
        if (id === "thinking") {
          state.showThinking = value === "on";
          void loadHistory();
        }
        if (id === "permission") {
          state.permissionMode = value as "auto" | "ask" | "deny";
        }
        tui.requestRender();
      },
      () => {
        closeOverlay();
        tui.requestRender();
      },
    );
    openOverlay(settings);
    tui.requestRender();
  };

  const sendMessage = async (text: string, displayText?: string) => {
    try {
      chatLog.addUser(displayText ?? text);
      tui.requestRender();
      const style = (state.outputStyle ?? "standard") as OutputStyle;
      const styledText = applyOutputStyle(text, style);
      const runId = randomUUID();
      noteLocalRunId(runId);
      state.activeChatRunId = runId;
      setActivityStatus("sending");

      // Collect pending images as attachments
      let attachments: ChatAttachmentInput[] | undefined;
      if (state.pendingImages.size > 0) {
        attachments = [];
        let idx = 0;
        for (const [, img] of state.pendingImages) {
          idx++;
          attachments.push({
            mimeType: img.mimeType,
            fileName: `paste-${idx}.png`,
            content: img.base64,
          });
        }
        state.pendingImages.clear();
      }

      await client.sendChat({
        sessionKey: state.currentSessionKey,
        message: styledText,
        thinking: opts.thinking,
        deliver: deliverDefault,
        timeoutMs: opts.timeoutMs,
        runId,
        attachments,
      });
      setActivityStatus("waiting");
    } catch (err) {
      if (state.activeChatRunId) {
        forgetLocalRunId?.(state.activeChatRunId);
      }
      state.activeChatRunId = null;
      chatLog.addSystem(`send failed: ${String(err)}`);
      setActivityStatus("error");
    }
    tui.requestRender();
  };

  // Full context with shared closures, passed to every command group.
  const ctx: CommandHandlerContext = {
    ...base,
    sendMessage,
    setAgent,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
    openSettings,
  };

  // Groups are tried in order; the first to return true (handled) wins.
  const groups: CommandGroupHandler[] = [
    sessionCommands,
    configCommands,
    displayCommands,
    clipboardCommands,
    ecosystemCommands,
    teleportCommands,
    miscCommands,
  ];

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) {
      return;
    }
    for (const g of groups) {
      if (await g(ctx, name, args, raw)) {
        tui.requestRender();
        return;
      }
    }
    // No group matched — should not happen since miscCommands has a default
    // fallback, but guard defensively.
    tui.requestRender();
  };

  return {
    handleCommand,
    sendMessage,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
    openSettings,
    setAgent,
  };
}

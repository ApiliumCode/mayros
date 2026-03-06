import { randomUUID } from "node:crypto";
import type { Component, TUI } from "@mariozechner/pi-tui";
import {
  listThinkingLevelLabels,
  normalizeUsageDisplay,
  resolveResponseUsageMode,
} from "../auto-reply/thinking.js";
import { expandMarkdownCommand, findMarkdownCommand } from "../commands/markdown-commands.js";
import type { SessionsPatchResult } from "../gateway/protocol/index.js";
import { formatRelativeTimestamp } from "../infra/format-time/format-relative.ts";
import { normalizeAgentId } from "../routing/session-key.js";
import { execSync, spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { helpText, parseCommand } from "./commands.js";
import { undo, listUndoEntries } from "./undo-manager.js";
import {
  exportSession,
  importSession,
  validatePayloadSize,
  MAX_EXPORT_MESSAGES,
  type TeleportPayload,
} from "./session-teleport.js";
import { formatContextVisualization } from "./context-visualizer.js";
import { renderDiff, renderDiffStats } from "./diff-renderer.js";
import { compactMessages } from "./compact-handler.js";
import { SessionManager, formatSessionLine } from "./session-manager.js";
import { applyOutputStyle, isValidOutputStyle, OUTPUT_STYLE_NAMES } from "./output-styles.js";
import type { OutputStyle } from "./output-styles.js";
import { THEME_PRESETS } from "./theme/palettes.js";
import type { ThemePreset } from "./theme/palettes.js";
import { setThemePreset, getThemePreset } from "./theme/theme.js";
import type { ChatLog } from "./components/chat-log.js";
import {
  createFilterableSelectList,
  createSearchableSelectList,
  createSelectList,
  createSettingsList,
} from "./components/selectors.js";
import type { ChatAttachmentInput, GatewayChatClient } from "./gateway-chat.js";
import { formatStatusSummary } from "./tui-status-summary.js";
import type {
  AgentSummary,
  GatewayStatusSummary,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";

type CommandHandlerContext = {
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
};

export function createCommandHandlers(context: CommandHandlerContext) {
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
    abortActive,
    setActivityStatus,
    formatSessionKey,
    applySessionInfoFromPatch,
    noteLocalRunId,
    forgetLocalRunId,
  } = context;

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

  const handleCommand = async (raw: string) => {
    const { name, args } = parseCommand(raw);
    if (!name) {
      return;
    }
    switch (name) {
      case "help":
        chatLog.addSystem(
          helpText({
            provider: state.sessionInfo.modelProvider,
            model: state.sessionInfo.model,
          }),
        );
        break;
      case "status":
        try {
          const status = await client.getStatus();
          if (typeof status === "string") {
            chatLog.addSystem(status);
            break;
          }
          if (status && typeof status === "object") {
            const lines = formatStatusSummary(status as GatewayStatusSummary);
            for (const line of lines) {
              chatLog.addSystem(line);
            }
            break;
          }
          chatLog.addSystem("status: unknown response");
        } catch (err) {
          chatLog.addSystem(`status failed: ${String(err)}`);
        }
        break;
      case "agent":
      case "agents":
        if (!args) {
          await openAgentSelector();
        } else {
          await setAgent(args);
        }
        break;
      case "session":
      case "sessions": {
        const sessionSubCmd = args.split(/\s+/)[0]?.toLowerCase();
        const sessionArgs = args.slice((sessionSubCmd ?? "").length).trim();

        if (!args) {
          await openSessionSelector();
        } else if (sessionSubCmd === "list") {
          try {
            const mgr = new SessionManager({
              client,
              currentAgentId: state.currentAgentId,
            });
            const sessions = await mgr.listSessions({ limit: 20 });
            if (sessions.length === 0) {
              chatLog.addSystem("no sessions found");
            } else {
              const lines = sessions.map((s) => formatSessionLine(s, formatSessionKey));
              chatLog.addSystem(
                `Sessions (${sessions.length}):\n${lines.map((l) => `  ${l}`).join("\n")}`,
              );
            }
          } catch (err) {
            chatLog.addSystem(`session list failed: ${String(err)}`);
          }
        } else if (sessionSubCmd === "rename") {
          if (!sessionArgs) {
            chatLog.addSystem("usage: /session rename <name>");
          } else {
            try {
              const mgr = new SessionManager({
                client,
                currentAgentId: state.currentAgentId,
              });
              await mgr.renameSession(state.currentSessionKey, sessionArgs);
              chatLog.addSystem(`session renamed to "${sessionArgs}"`);
              await refreshSessionInfo();
            } catch (err) {
              chatLog.addSystem(`session rename failed: ${String(err)}`);
            }
          }
        } else if (sessionSubCmd === "delete") {
          if (!sessionArgs) {
            chatLog.addSystem("usage: /session delete <key>");
          } else {
            try {
              const mgr = new SessionManager({
                client,
                currentAgentId: state.currentAgentId,
              });
              await mgr.deleteSession(sessionArgs);
              chatLog.addSystem(`session ${sessionArgs} deleted`);
            } catch (err) {
              chatLog.addSystem(`session delete failed: ${String(err)}`);
            }
          }
        } else {
          // Treat as session key for resume
          await setSession(args);
        }
        break;
      }
      case "model":
      case "models":
        if (!args) {
          await openModelSelector();
        } else {
          try {
            const result = await client.patchSession({
              key: state.currentSessionKey,
              model: args,
            });
            chatLog.addSystem(`model set to ${args}`);
            applySessionInfoFromPatch(result);
            await refreshSessionInfo();
          } catch (err) {
            chatLog.addSystem(`model set failed: ${String(err)}`);
          }
        }
        break;
      case "think":
        if (!args) {
          const levels = listThinkingLevelLabels(
            state.sessionInfo.modelProvider,
            state.sessionInfo.model,
          );
          const currentThink = state.sessionInfo.thinkingLevel ?? "medium";
          const thinkItems = levels.map((l) => ({
            value: l,
            label: l === currentThink ? `${l} (current)` : l,
          }));
          const thinkSelector = createSelectList(thinkItems, thinkItems.length);
          thinkSelector.onSelect = (item) => {
            void (async () => {
              try {
                const result = await client.patchSession({
                  key: state.currentSessionKey,
                  thinkingLevel: item.value,
                });
                chatLog.addSystem(`thinking set to ${item.value}`);
                applySessionInfoFromPatch(result);
                await refreshSessionInfo();
              } catch (err) {
                chatLog.addSystem(`think failed: ${String(err)}`);
              }
              closeOverlay();
              tui.requestRender();
            })();
          };
          thinkSelector.onCancel = () => {
            closeOverlay();
            tui.requestRender();
          };
          openOverlay(thinkSelector);
          tui.requestRender();
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            thinkingLevel: args,
          });
          chatLog.addSystem(`thinking set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`think failed: ${String(err)}`);
        }
        break;
      case "verbose": {
        if (!args) {
          const verboseOpts = ["on", "off"];
          const currentVerbose = state.sessionInfo.verboseLevel ?? "off";
          const verboseItems = verboseOpts.map((v) => ({
            value: v,
            label: v === currentVerbose ? `${v} (current)` : v,
          }));
          const verboseSelector = createSelectList(verboseItems, verboseItems.length);
          verboseSelector.onSelect = (item) => {
            void (async () => {
              try {
                const result = await client.patchSession({
                  key: state.currentSessionKey,
                  verboseLevel: item.value,
                });
                chatLog.addSystem(`verbose set to ${item.value}`);
                applySessionInfoFromPatch(result);
                await loadHistory();
              } catch (err) {
                chatLog.addSystem(`verbose failed: ${String(err)}`);
              }
              closeOverlay();
              tui.requestRender();
            })();
          };
          verboseSelector.onCancel = () => {
            closeOverlay();
            tui.requestRender();
          };
          openOverlay(verboseSelector);
          tui.requestRender();
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            verboseLevel: args,
          });
          chatLog.addSystem(`verbose set to ${args}`);
          applySessionInfoFromPatch(result);
          await loadHistory();
        } catch (err) {
          chatLog.addSystem(`verbose failed: ${String(err)}`);
        }
        break;
      }
      case "reasoning": {
        if (!args) {
          const reasoningOpts = ["on", "off"];
          const currentReasoning = state.sessionInfo.reasoningLevel ?? "off";
          const reasoningItems = reasoningOpts.map((r) => ({
            value: r,
            label: r === currentReasoning ? `${r} (current)` : r,
          }));
          const reasoningSelector = createSelectList(reasoningItems, reasoningItems.length);
          reasoningSelector.onSelect = (item) => {
            void (async () => {
              try {
                const result = await client.patchSession({
                  key: state.currentSessionKey,
                  reasoningLevel: item.value,
                });
                chatLog.addSystem(`reasoning set to ${item.value}`);
                applySessionInfoFromPatch(result);
                await refreshSessionInfo();
              } catch (err) {
                chatLog.addSystem(`reasoning failed: ${String(err)}`);
              }
              closeOverlay();
              tui.requestRender();
            })();
          };
          reasoningSelector.onCancel = () => {
            closeOverlay();
            tui.requestRender();
          };
          openOverlay(reasoningSelector);
          tui.requestRender();
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            reasoningLevel: args,
          });
          chatLog.addSystem(`reasoning set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`reasoning failed: ${String(err)}`);
        }
        break;
      }
      case "usage": {
        const normalized = args ? normalizeUsageDisplay(args) : undefined;
        if (args && !normalized) {
          chatLog.addSystem("usage: /usage <off|tokens|full>");
          break;
        }
        const currentRaw = state.sessionInfo.responseUsage;
        const current = resolveResponseUsageMode(currentRaw);
        const next =
          normalized ?? (current === "off" ? "tokens" : current === "tokens" ? "full" : "off");
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            responseUsage: next === "off" ? null : next,
          });
          chatLog.addSystem(`usage footer: ${next}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`usage failed: ${String(err)}`);
        }
        break;
      }
      case "elevated": {
        if (!args) {
          const elevatedOpts = ["on", "off", "ask", "full"];
          const currentElevated = state.sessionInfo.elevatedLevel ?? "off";
          const elevatedItems = elevatedOpts.map((e) => ({
            value: e,
            label: e === currentElevated ? `${e} (current)` : e,
          }));
          const elevatedSelector = createSelectList(elevatedItems, elevatedItems.length);
          elevatedSelector.onSelect = (item) => {
            void (async () => {
              try {
                const result = await client.patchSession({
                  key: state.currentSessionKey,
                  elevatedLevel: item.value,
                });
                chatLog.addSystem(`elevated set to ${item.value}`);
                applySessionInfoFromPatch(result);
                await refreshSessionInfo();
              } catch (err) {
                chatLog.addSystem(`elevated failed: ${String(err)}`);
              }
              closeOverlay();
              tui.requestRender();
            })();
          };
          elevatedSelector.onCancel = () => {
            closeOverlay();
            tui.requestRender();
          };
          openOverlay(elevatedSelector);
          tui.requestRender();
          break;
        }
        if (!["on", "off", "ask", "full"].includes(args)) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            elevatedLevel: args,
          });
          chatLog.addSystem(`elevated set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`elevated failed: ${String(err)}`);
        }
        break;
      }
      case "activation": {
        if (!args) {
          const activationOpts = ["mention", "always"];
          const currentActivation = state.sessionInfo.groupActivation ?? "mention";
          const activationItems = activationOpts.map((a) => ({
            value: a,
            label: a === currentActivation ? `${a} (current)` : a,
          }));
          const activationSelector = createSelectList(activationItems, activationItems.length);
          activationSelector.onSelect = (item) => {
            void (async () => {
              try {
                const result = await client.patchSession({
                  key: state.currentSessionKey,
                  groupActivation: item.value === "always" ? "always" : "mention",
                });
                chatLog.addSystem(`activation set to ${item.value}`);
                applySessionInfoFromPatch(result);
                await refreshSessionInfo();
              } catch (err) {
                chatLog.addSystem(`activation failed: ${String(err)}`);
              }
              closeOverlay();
              tui.requestRender();
            })();
          };
          activationSelector.onCancel = () => {
            closeOverlay();
            tui.requestRender();
          };
          openOverlay(activationSelector);
          tui.requestRender();
          break;
        }
        try {
          const result = await client.patchSession({
            key: state.currentSessionKey,
            groupActivation: args === "always" ? "always" : "mention",
          });
          chatLog.addSystem(`activation set to ${args}`);
          applySessionInfoFromPatch(result);
          await refreshSessionInfo();
        } catch (err) {
          chatLog.addSystem(`activation failed: ${String(err)}`);
        }
        break;
      }
      case "context": {
        const used = state.sessionInfo.totalTokens ?? 0;
        const max = state.sessionInfo.contextTokens ?? 0;
        const lines = formatContextVisualization({
          usedTokens: used,
          maxTokens: max,
          inputTokens: state.sessionInfo.inputTokens,
          outputTokens: state.sessionInfo.outputTokens,
        });
        for (const line of lines) {
          chatLog.addSystem(line);
        }
        break;
      }
      case "diff": {
        try {
          const cmd = args ? `git diff -- ${args}` : "git diff";
          const raw = execSync(cmd, { encoding: "utf-8", maxBuffer: 1024 * 1024 }).trim();
          if (!raw) {
            chatLog.addSystem("no changes");
            break;
          }
          const stats = renderDiffStats(raw);
          chatLog.addSystem(
            `${stats.files} file(s) changed, +${stats.additions} -${stats.deletions}`,
          );
          for (const line of renderDiff(raw)) {
            chatLog.addSystem(line);
          }
        } catch (err) {
          chatLog.addSystem(`diff failed: ${String(err)}`);
        }
        break;
      }
      case "style": {
        const styleName = args.toLowerCase();
        if (!styleName) {
          const currentStyle = state.outputStyle ?? "standard";
          const styleItems = OUTPUT_STYLE_NAMES.map((s) => ({
            value: s,
            label: s === currentStyle ? `${s} (current)` : s,
          }));
          const styleSelector = createSelectList(styleItems, styleItems.length);
          styleSelector.onSelect = (item) => {
            state.outputStyle = item.value as OutputStyle;
            chatLog.addSystem(`output style set to ${item.value}`);
            closeOverlay();
            tui.requestRender();
          };
          styleSelector.onCancel = () => {
            closeOverlay();
            tui.requestRender();
          };
          openOverlay(styleSelector);
          tui.requestRender();
          break;
        }
        if (!isValidOutputStyle(styleName)) {
          chatLog.addSystem(`unknown style. usage: /style <${OUTPUT_STYLE_NAMES.join("|")}>`);
          break;
        }
        state.outputStyle = styleName;
        chatLog.addSystem(`output style set to ${styleName}`);
        break;
      }
      case "theme": {
        const preset = args.toLowerCase();
        if (!preset) {
          const currentTheme = getThemePreset();
          const themeItems = THEME_PRESETS.map((t) => ({
            value: t,
            label: t === currentTheme ? `${t} (current)` : t,
          }));
          const themeSelector = createSelectList(themeItems, themeItems.length);
          themeSelector.onSelect = (item) => {
            setThemePreset(item.value as ThemePreset);
            chatLog.addSystem(`theme set to ${item.value}`);
            closeOverlay();
            tui.requestRender();
          };
          themeSelector.onCancel = () => {
            closeOverlay();
            tui.requestRender();
          };
          openOverlay(themeSelector);
          tui.requestRender();
          break;
        }
        if (!THEME_PRESETS.includes(preset as ThemePreset)) {
          chatLog.addSystem(`unknown theme. usage: /theme <${THEME_PRESETS.join("|")}>`);
          break;
        }
        setThemePreset(preset as ThemePreset);
        chatLog.addSystem(`theme set to ${preset}`);
        break;
      }
      case "new":
      case "reset":
        try {
          // Clear token counts immediately to avoid stale display (#1523)
          state.sessionInfo.inputTokens = null;
          state.sessionInfo.outputTokens = null;
          state.sessionInfo.totalTokens = null;
          tui.requestRender();

          await client.resetSession(state.currentSessionKey, name);
          chatLog.addSystem(`session ${state.currentSessionKey} reset`);
          await loadHistory();
        } catch (err) {
          chatLog.addSystem(`reset failed: ${String(err)}`);
        }
        break;
      case "vim": {
        const enabled = !state.vimEnabled;
        state.vimEnabled = enabled;
        chatLog.addSystem(`vim mode ${enabled ? "enabled" : "disabled"}`);
        break;
      }
      case "permission": {
        const MODES = ["auto", "ask", "deny"] as const;
        type PermMode = (typeof MODES)[number];
        const mode = args.toLowerCase();
        if (!mode) {
          const current = state.permissionMode ?? "auto";
          const idx = MODES.indexOf(current);
          const next = MODES[(idx + 1) % MODES.length] as PermMode;
          state.permissionMode = next;
          chatLog.addSystem(`permission mode: ${next}`);
        } else if (MODES.includes(mode as PermMode)) {
          state.permissionMode = mode as PermMode;
          chatLog.addSystem(`permission mode set to ${mode}`);
        } else {
          chatLog.addSystem("usage: /permission <auto|ask|deny>");
        }
        break;
      }
      case "fast": {
        const isFast = !state.fastMode;
        state.fastMode = isFast;
        if (isFast) {
          // Save current thinking level before switching
          state.previousThinkingLevel = state.sessionInfo.thinkingLevel ?? "medium";
          try {
            const result = await client.patchSession({
              key: state.currentSessionKey,
              thinkingLevel: "off",
            });
            applySessionInfoFromPatch(result);
          } catch {
            // Best-effort — fast mode works locally even without gateway
          }
          state.outputStyle = "standard";
          chatLog.addSystem("fast mode enabled (thinking: off, style: standard)");
        } else {
          // Restore previous thinking level
          const prevLevel = state.previousThinkingLevel ?? "medium";
          try {
            const result = await client.patchSession({
              key: state.currentSessionKey,
              thinkingLevel: prevLevel,
            });
            applySessionInfoFromPatch(result);
          } catch {
            // Best-effort
          }
          chatLog.addSystem(`fast mode disabled (thinking: ${prevLevel})`);
        }
        break;
      }
      case "compact": {
        try {
          const history = (await client.loadHistory({
            sessionKey: state.currentSessionKey,
          })) as { messages?: Array<Record<string, unknown>> };
          const rawMessages = history?.messages ?? [];
          if (rawMessages.length === 0) {
            chatLog.addSystem("nothing to compact");
            break;
          }
          const mapped = rawMessages
            .filter(
              (m) =>
                typeof m === "object" &&
                m !== null &&
                (m.role === "user" || m.role === "assistant"),
            )
            .map((m) => ({
              role: String(m.role ?? "user"),
              content: typeof m.content === "string" ? m.content : "",
            }));
          const compactResult = compactMessages({
            messages: mapped,
            sessionKey: state.currentSessionKey,
          });
          chatLog.addSystem(
            `Compacted ${compactResult.originalCount} messages \u2192 summary (${compactResult.knowledgeItems} knowledge items extracted)`,
          );
        } catch (err) {
          chatLog.addSystem(`compact failed: ${String(err)}`);
        }
        break;
      }
      case "copy": {
        const lastText = chatLog.getLastAssistantText();
        if (!lastText) {
          chatLog.addSystem("nothing to copy");
          break;
        }
        try {
          const proc = spawn(
            process.platform === "darwin" ? "pbcopy" : "xclip",
            process.platform === "darwin" ? [] : ["-selection", "clipboard"],
            { stdio: ["pipe", "ignore", "ignore"] },
          );
          proc.stdin?.write(lastText);
          proc.stdin?.end();
          chatLog.addSystem("last response copied to clipboard");
        } catch (err) {
          chatLog.addSystem(`copy failed: ${String(err)}`);
        }
        break;
      }
      case "export": {
        const lastText = chatLog.getLastAssistantText();
        if (!lastText) {
          chatLog.addSystem("nothing to export");
          break;
        }
        const filePath = args || `mayros-export-${Date.now()}.md`;
        try {
          writeFileSync(filePath, lastText, "utf-8");
          chatLog.addSystem(`exported to ${filePath}`);
        } catch (err) {
          chatLog.addSystem(`export failed: ${String(err)}`);
        }
        break;
      }
      case "undo": {
        const cwd = process.cwd();
        if (args === "list") {
          const entries = listUndoEntries(cwd);
          if (entries.length === 0) {
            chatLog.addSystem("No undo points available.");
          } else {
            const lines = entries.map(
              (e) => `  [${e.index}] ${e.label}${e.timestamp ? ` (${e.timestamp})` : ""}`,
            );
            chatLog.addSystem(`Undo points:\n${lines.join("\n")}`);
          }
        } else {
          const result = undo(cwd);
          chatLog.addSystem(result.message);
        }
        break;
      }
      case "abort":
        await abortActive();
        break;
      case "settings":
        openSettings();
        break;
      case "bug": {
        const url = "https://github.com/ApiliumCode/mayros/issues/new";
        try {
          const openCmd =
            process.platform === "darwin"
              ? "open"
              : process.platform === "win32"
                ? "start"
                : "xdg-open";
          execSync(`${openCmd} ${url}`, { stdio: "ignore" });
          chatLog.addSystem(`Opened ${url}`);
        } catch {
          chatLog.addSystem(`Report bugs at: ${url}`);
        }
        break;
      }
      case "init": {
        try {
          const fs = await import("node:fs");
          const path = await import("node:path");
          const configPath = path.join(process.cwd(), "mayros.json");
          if (fs.existsSync(configPath)) {
            chatLog.addSystem("mayros.json already exists in this directory");
            break;
          }
          const pkg = fs.existsSync(path.join(process.cwd(), "package.json"))
            ? JSON.parse(fs.readFileSync(path.join(process.cwd(), "package.json"), "utf-8"))
            : null;
          const projectName = pkg?.name ?? path.basename(process.cwd());
          const config = {
            $schema: "https://apilium.com/schemas/mayros/v1.json",
            meta: { lastTouchedVersion: "0.1.5" },
            ui: { theme: "dark" },
            agents: { defaults: { agentId: projectName } },
          };
          fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
          chatLog.addSystem(`Created ${configPath}`);
        } catch (err) {
          chatLog.addSystem(`init failed: ${String(err)}`);
        }
        break;
      }
      case "exit":
      case "quit":
        client.stop();
        tui.stop();
        process.exit(0);
        break;
      // --- Mayros ecosystem ---
      case "plan": {
        const action = args || "show";
        await sendMessage(`/plan ${action}`);
        break;
      }
      case "kg": {
        if (!args) {
          chatLog.addSystem("usage: /kg <query>");
          break;
        }
        await sendMessage(`Search the knowledge graph for: ${args}`);
        break;
      }
      case "trace": {
        await sendMessage(`Show trace ${args || "events"} summary for the current session`);
        break;
      }
      case "team": {
        await sendMessage("Show the team dashboard with current agent status and activity");
        break;
      }
      case "tasks": {
        await sendMessage("Show background tasks status and summary");
        break;
      }
      case "workflow": {
        if (!args) {
          await sendMessage("List available workflows and their status");
        } else {
          await sendMessage(`/workflow ${args}`);
        }
        break;
      }
      case "rules": {
        await sendMessage(`Show active rules${args ? ` matching: ${args}` : ""}`);
        break;
      }
      case "mailbox": {
        if (!args) {
          await sendMessage("Check my inbox for new messages and show unread count");
        } else {
          await sendMessage(`/mailbox ${args}`);
        }
        break;
      }
      case "search": {
        const query = args.trim();
        if (!query) {
          chatLog.addSystem("Usage: /search <query>");
          break;
        }
        chatLog.addSystem(`Searching for "${query}"...`);
        try {
          const { searchSessions } = await import("../infra/session-search.js");
          const summary = await searchSessions({ query, limit: 10 });
          if (summary.results.length === 0) {
            chatLog.addSystem(
              `No results found for "${query}" (${summary.sessionsSearched} sessions searched)`,
            );
            break;
          }
          const lines = [
            `Found ${summary.totalMatches} result(s) in ${summary.sessionsSearched} sessions:`,
          ];
          for (const r of summary.results) {
            const date = new Date(r.timestamp).toISOString().slice(0, 16).replace("T", " ");
            const tag = r.role === "user" ? "[You]" : "[AI]";
            lines.push(
              `${date} ${tag} (${r.sessionId}): ${r.snippet.replace(/\n/g, " ").slice(0, 100)}`,
            );
          }
          chatLog.addSystem(lines.join("\n"));
        } catch (err) {
          chatLog.addSystem(`search failed: ${String(err)}`);
        }
        break;
      }
      case "batch": {
        if (!args) {
          chatLog.addSystem("usage: /batch <file> — run 'mayros batch run <file>' from terminal");
        } else {
          chatLog.addSystem(
            `Run 'mayros batch run ${args}' from the terminal for batch processing`,
          );
        }
        break;
      }
      case "teleport": {
        const subCmd = args.split(/\s+/)[0]?.toLowerCase();
        if (subCmd === "export") {
          // Populate messages from actual session history
          let messages: TeleportPayload["messages"] = [];
          try {
            const history = await client.loadHistory({
              sessionKey: state.currentSessionKey,
              limit: MAX_EXPORT_MESSAGES,
            });
            if (Array.isArray(history)) {
              messages = history.map(
                (m: { role?: string; content?: string; timestamp?: string }) => ({
                  role: (m.role as "user" | "assistant" | "system") ?? "user",
                  content:
                    typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
                  ...(m.timestamp ? { timestamp: m.timestamp } : {}),
                }),
              );
            }
          } catch {
            // If history load fails, export with empty messages (degraded mode)
          }

          const payload: TeleportPayload = {
            version: 1,
            timestamp: new Date().toISOString(),
            agentId: state.currentAgentId,
            sessionKey: state.currentSessionKey,
            messages,
            metadata: {},
          };

          const sizeError = validatePayloadSize(payload);
          if (sizeError) {
            chatLog.addSystem(`Export warning: ${sizeError}`);
          }

          const token = exportSession(payload);
          // Copy to clipboard
          try {
            execSync(
              `echo -n "${token}" | pbcopy 2>/dev/null || echo -n "${token}" | xclip -sel clipboard 2>/dev/null || echo -n "${token}" | xsel --clipboard 2>/dev/null`,
              { encoding: "utf-8" },
            );
            chatLog.addSystem(
              `Session exported to clipboard (${token.length} chars, ${messages.length} messages). Share this token to import on another device.`,
            );
          } catch {
            chatLog.addSystem(`Session token:\n${token}`);
          }
        } else if (subCmd === "import") {
          const token = args.slice("import".length).trim();
          if (!token) {
            chatLog.addSystem("Usage: /teleport import <token>");
            break;
          }
          try {
            const payload = importSession(token);
            chatLog.addSystem(
              `Session imported: ${payload.messages.length} messages from agent "${payload.agentId}" (${payload.timestamp})`,
            );
          } catch (err) {
            chatLog.addSystem(`Import failed: ${String(err)}`);
          }
        } else {
          chatLog.addSystem("Usage: /teleport export | /teleport import <token>");
        }
        break;
      }
      case "sync": {
        await sendMessage(`Show Cortex sync ${args || "status"}`);
        break;
      }
      case "onboard": {
        chatLog.addSystem("Run 'mayros onboard' from the terminal to start the setup wizard");
        break;
      }
      default: {
        // Check for user-defined markdown commands before sending raw
        const mdCmd = findMarkdownCommand(name);
        if (mdCmd) {
          const expanded = expandMarkdownCommand(mdCmd, args);
          await sendMessage(expanded);
        } else {
          await sendMessage(raw);
        }
        break;
      }
    }
    tui.requestRender();
  };

  const sendMessage = async (text: string) => {
    try {
      chatLog.addUser(text);
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

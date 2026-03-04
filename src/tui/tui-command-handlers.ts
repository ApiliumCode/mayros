import { randomUUID } from "node:crypto";
import type { Component, TUI } from "@mariozechner/pi-tui";
import {
  formatThinkingLevels,
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
import { formatContextVisualization } from "./context-visualizer.js";
import { renderDiff, renderDiffStats } from "./diff-renderer.js";
import { applyOutputStyle, isValidOutputStyle, OUTPUT_STYLE_NAMES } from "./output-styles.js";
import type { OutputStyle } from "./output-styles.js";
import { THEME_PRESETS } from "./theme/palettes.js";
import type { ThemePreset } from "./theme/palettes.js";
import { setThemePreset, getThemePreset } from "./theme/theme.js";
import type { ChatLog } from "./components/chat-log.js";
import {
  createFilterableSelectList,
  createSearchableSelectList,
  createSettingsList,
} from "./components/selectors.js";
import type { GatewayChatClient } from "./gateway-chat.js";
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
        if (!args) {
          await openAgentSelector();
        } else {
          await setAgent(args);
        }
        break;
      case "agents":
        await openAgentSelector();
        break;
      case "session":
        if (!args) {
          await openSessionSelector();
        } else {
          await setSession(args);
        }
        break;
      case "sessions":
        await openSessionSelector();
        break;
      case "model":
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
      case "models":
        await openModelSelector();
        break;
      case "think":
        if (!args) {
          const levels = formatThinkingLevels(
            state.sessionInfo.modelProvider,
            state.sessionInfo.model,
            "|",
          );
          chatLog.addSystem(`usage: /think <${levels}>`);
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
      case "verbose":
        if (!args) {
          chatLog.addSystem("usage: /verbose <on|off>");
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
      case "reasoning":
        if (!args) {
          chatLog.addSystem("usage: /reasoning <on|off>");
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
      case "elevated":
        if (!args) {
          chatLog.addSystem("usage: /elevated <on|off|ask|full>");
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
      case "activation":
        if (!args) {
          chatLog.addSystem("usage: /activation <mention|always>");
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
          const current = state.outputStyle ?? "standard";
          chatLog.addSystem(
            `current style: ${current}. usage: /style <${OUTPUT_STYLE_NAMES.join("|")}>`,
          );
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
        if (!preset || !THEME_PRESETS.includes(preset as ThemePreset)) {
          chatLog.addSystem(
            `current theme: ${getThemePreset()}. usage: /theme <${THEME_PRESETS.join("|")}>`,
          );
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
      case "abort":
        await abortActive();
        break;
      case "settings":
        openSettings();
        break;
      case "exit":
      case "quit":
        client.stop();
        tui.stop();
        process.exit(0);
        break;
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
      await client.sendChat({
        sessionKey: state.currentSessionKey,
        message: styledText,
        thinking: opts.thinking,
        deliver: deliverDefault,
        timeoutMs: opts.timeoutMs,
        runId,
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

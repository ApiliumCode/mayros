import {
  CombinedAutocompleteProvider,
  Container,
  Loader,
  ProcessTerminal,
  Text,
  TUI,
} from "@earendil-works/pi-tui";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { VERSION } from "../version.js";
import { loadConfig } from "../config/config.js";
import { isLoopbackHost } from "../gateway/net.js";
import {
  normalizeAgentId,
  normalizeMainKey,
  parseAgentSessionKey,
} from "../routing/session-key.js";
import { captureClipboardImage } from "./clipboard-image.js";
import { getSlashCommands } from "./commands.js";
import { createEnrichedProvider } from "./enriched-autocomplete.js";
import { applyKeybindingsFromConfig, createTuiResolver } from "./keybinding-resolver.js";
import { ChatLog } from "./components/chat-log.js";
import { CustomEditor } from "./components/custom-editor.js";
import { WelcomeScreen } from "./components/welcome-screen.js";
import { GatewayChatClient } from "./gateway-chat.js";
import { enableKeyboardProtocol } from "./term-capabilities.js";
import { detectTerminalColorScheme } from "./term-capabilities.js";
import type { BuiltinPreset } from "./theme/palettes.js";
import { THEME_PRESETS } from "./theme/palettes.js";
import { discoverCustomThemes } from "./theme/theme-loader.js";
import { editorTheme, theme, setThemePreset } from "./theme/theme.js";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { createEventHandlers } from "./tui-event-handlers.js";
import { MouseHandler, createMouseInputListener } from "./mouse-handler.js";
import { formatTokens } from "./tui-formatters.js";
import { createLocalShellRunner } from "./tui-local-shell.js";
import { createOverlayHandlers } from "./tui-overlays.js";
import { createSessionActions } from "./tui-session-actions.js";
import type {
  AgentSummary,
  PendingImage,
  SectionState,
  SessionInfo,
  SessionScope,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";
import { nextSectionState } from "./tui-types.js";
import { buildWaitingStatusMessage, defaultWaitingPhrases } from "./tui-waiting.js";

export { resolveFinalAssistantText } from "./tui-formatters.js";
export type { TuiOptions } from "./tui-types.js";
export {
  createEditorSubmitHandler,
  shouldEnableWindowsGitBashPasteFallback,
  createSubmitBurstCoalescer,
  resolveTuiSessionKey,
  resolveGatewayDisconnectState,
  createBackspaceDeduper,
} from "./tui-helpers.js";
import {
  createEditorSubmitHandler,
  shouldEnableWindowsGitBashPasteFallback,
  createSubmitBurstCoalescer,
  resolveTuiSessionKey,
  resolveGatewayDisconnectState,
  createBackspaceDeduper,
  tryInlinePairingApproval,
} from "./tui-helpers.js";

export async function runTui(opts: TuiOptions) {
  const config = loadConfig();

  // Accessibility mode: redirect to linear TUI
  const { isA11yMode } = await import("./a11y-renderer.js");
  if (isA11yMode() || config.ui?.accessibility) {
    const { runA11yTui } = await import("./a11y-tui.js");
    await runA11yTui(opts);
    return;
  }

  // Discover custom themes from ~/.mayros/themes/*.json before resolving the
  // config theme, so a custom theme name in config.ui.theme works on startup.
  await discoverCustomThemes();

  const configTheme = config.ui?.theme;
  // "auto" (or unset) defers to terminal color-scheme detection after the TUI
  // instance is created; until then the default "dark" preset is in place.
  const themeIsAuto = !configTheme || configTheme === "auto";
  if (!themeIsAuto && THEME_PRESETS.includes(configTheme as BuiltinPreset)) {
    setThemePreset(configTheme);
  } else if (!themeIsAuto) {
    // Could be a custom theme name — set it; resolvePalette falls back to
    // dark if the name isn't registered yet.
    setThemePreset(configTheme);
  }
  const keybindingsConfig = config.ui?.keybindings;
  applyKeybindingsFromConfig(keybindingsConfig);
  const tuiResolver = createTuiResolver(keybindingsConfig);
  const initialSessionInput = (opts.session ?? "").trim();
  let sessionScope: SessionScope = (config.session?.scope ?? "per-sender") as SessionScope;
  let sessionMainKey = normalizeMainKey(config.session?.mainKey);
  let agentDefaultId = resolveDefaultAgentId(config);
  let currentAgentId = agentDefaultId;
  let agents: AgentSummary[] = [];
  const agentNames = new Map<string, string>();
  let currentSessionKey = "";
  let initialSessionApplied = false;
  let currentSessionId: string | null = null;
  let activeChatRunId: string | null = null;
  let historyLoaded = false;
  let isConnected = false;
  let wasDisconnected = false;
  let toolsExpanded = false;
  let showThinking = false;
  let toolSectionState: SectionState = "collapsed";
  let thinkingSectionState: SectionState = "collapsed";
  let pairingHintShown = false;
  let gatewayDownHintShown = false;
  let outputStyle: string | undefined;
  let permissionMode: "auto" | "ask" | "deny" = "auto";
  let fastMode = false;
  let previousThinkingLevel: string | undefined;
  let vimEnabled = false;
  const mouseHandler = new MouseHandler({
    scrollLines: 3,
    scrollAcceleration: true,
    maxAcceleration: 5,
  });
  const pendingImages = new Map<string, PendingImage>();
  const localRunIds = new Set<string>();

  const deliverDefault = opts.deliver ?? false;
  const autoMessage = opts.message?.trim();
  let autoMessageSent = false;
  let sessionInfo: SessionInfo = {};
  let lastCtrlCAt = 0;
  let activityStatus = "idle";
  let connectionStatus = "connecting";
  let statusTimeout: NodeJS.Timeout | null = null;
  let statusTimer: NodeJS.Timeout | null = null;
  let statusStartedAt: number | null = null;
  let lastActivityStatus = activityStatus;

  const state: TuiStateAccess = {
    get agentDefaultId() {
      return agentDefaultId;
    },
    set agentDefaultId(value) {
      agentDefaultId = value;
    },
    get sessionMainKey() {
      return sessionMainKey;
    },
    set sessionMainKey(value) {
      sessionMainKey = value;
    },
    get sessionScope() {
      return sessionScope;
    },
    set sessionScope(value) {
      sessionScope = value;
    },
    get agents() {
      return agents;
    },
    set agents(value) {
      agents = value;
    },
    get currentAgentId() {
      return currentAgentId;
    },
    set currentAgentId(value) {
      currentAgentId = value;
    },
    get currentSessionKey() {
      return currentSessionKey;
    },
    set currentSessionKey(value) {
      currentSessionKey = value;
    },
    get currentSessionId() {
      return currentSessionId;
    },
    set currentSessionId(value) {
      currentSessionId = value;
    },
    get activeChatRunId() {
      return activeChatRunId;
    },
    set activeChatRunId(value) {
      activeChatRunId = value;
    },
    get historyLoaded() {
      return historyLoaded;
    },
    set historyLoaded(value) {
      historyLoaded = value;
    },
    get sessionInfo() {
      return sessionInfo;
    },
    set sessionInfo(value) {
      sessionInfo = value;
    },
    get initialSessionApplied() {
      return initialSessionApplied;
    },
    set initialSessionApplied(value) {
      initialSessionApplied = value;
    },
    get isConnected() {
      return isConnected;
    },
    set isConnected(value) {
      isConnected = value;
    },
    get autoMessageSent() {
      return autoMessageSent;
    },
    set autoMessageSent(value) {
      autoMessageSent = value;
    },
    get toolsExpanded() {
      return toolsExpanded;
    },
    set toolsExpanded(value) {
      toolsExpanded = value;
    },
    get showThinking() {
      return showThinking;
    },
    set showThinking(value) {
      showThinking = value;
    },
    get toolSectionState() {
      return toolSectionState;
    },
    set toolSectionState(value) {
      toolSectionState = value;
    },
    get thinkingSectionState() {
      return thinkingSectionState;
    },
    set thinkingSectionState(value) {
      thinkingSectionState = value;
    },
    get connectionStatus() {
      return connectionStatus;
    },
    set connectionStatus(value) {
      connectionStatus = value;
    },
    get activityStatus() {
      return activityStatus;
    },
    set activityStatus(value) {
      activityStatus = value;
    },
    get statusTimeout() {
      return statusTimeout;
    },
    set statusTimeout(value) {
      statusTimeout = value;
    },
    get lastCtrlCAt() {
      return lastCtrlCAt;
    },
    set lastCtrlCAt(value) {
      lastCtrlCAt = value;
    },
    get outputStyle() {
      return outputStyle;
    },
    set outputStyle(value) {
      outputStyle = value;
    },
    get vimEnabled() {
      return vimEnabled;
    },
    set vimEnabled(value) {
      vimEnabled = value ?? false;
    },
    get permissionMode() {
      return permissionMode;
    },
    set permissionMode(value) {
      permissionMode = value ?? "auto";
      updateFooter();
    },
    get fastMode() {
      return fastMode;
    },
    set fastMode(value) {
      fastMode = value ?? false;
      updateFooter();
    },
    get previousThinkingLevel() {
      return previousThinkingLevel;
    },
    set previousThinkingLevel(value) {
      previousThinkingLevel = value;
    },
    get pendingImages() {
      return pendingImages;
    },
  };

  const noteLocalRunId = (runId: string) => {
    if (!runId) {
      return;
    }
    localRunIds.add(runId);
    if (localRunIds.size > 200) {
      const [first] = localRunIds;
      if (first) {
        localRunIds.delete(first);
      }
    }
  };

  const forgetLocalRunId = (runId: string) => {
    localRunIds.delete(runId);
  };

  const isLocalRunId = (runId: string) => localRunIds.has(runId);

  const clearLocalRunIds = () => {
    localRunIds.clear();
  };

  const client = new GatewayChatClient({
    url: opts.url,
    token: opts.token,
    password: opts.password,
  });

  const tui = new TUI(new ProcessTerminal());
  // Auto-detect the terminal's dark/light preference before the first render.
  // Queries run concurrently with a short timeout, so an unresponsive terminal
  // falls back to the default "dark" preset without blocking startup.
  if (themeIsAuto) {
    const detected = await detectTerminalColorScheme(tui);
    setThemePreset(detected);
  }
  const dedupeBackspace = createBackspaceDeduper();
  tui.addInputListener((data) => {
    const next = dedupeBackspace(data);
    if (next.length === 0) {
      return { consume: true };
    }
    return { data: next };
  });
  tui.addInputListener(createMouseInputListener(mouseHandler));
  const header = new Text("", 1, 0);
  const statusContainer = new Container();
  const footer = new Text("", 1, 0);
  const chatLog = new ChatLog();
  const editor = new CustomEditor(tui, editorTheme);
  editor.tuiResolver = tuiResolver;
  editor.captureClipboardImage = captureClipboardImage;
  editor.onImagePaste = (img) => {
    pendingImages.set(img.marker, { base64: img.base64, mimeType: img.mimeType });
  };

  // Mouse scroll → ChatLog scroll + re-render
  mouseHandler.onScroll((direction, lines) => {
    if (direction === "up") {
      chatLog.scrollBy(lines);
    } else {
      chatLog.scrollBy(-lines);
    }
    tui.requestRender();
  });
  // Mouse reporting off by default — enables native text selection.
  // Users can toggle with /mouse if they want scroll-with-mouse.

  const root = new Container();
  root.addChild(header);
  root.addChild(chatLog);
  root.addChild(editor);
  root.addChild(statusContainer);
  root.addChild(footer);

  const updateAutocompleteProvider = () => {
    const base = new CombinedAutocompleteProvider(
      getSlashCommands({
        cfg: config,
        provider: sessionInfo.modelProvider,
        model: sessionInfo.model,
      }),
      process.cwd(),
    );
    editor.setAutocompleteProvider(createEnrichedProvider(base));
  };

  tui.addChild(root);
  tui.setFocus(editor);

  const formatSessionKey = (key: string) => {
    if (key === "global" || key === "unknown") {
      return key;
    }
    const parsed = parseAgentSessionKey(key);
    return parsed?.rest ?? key;
  };

  const formatAgentLabel = (id: string) => {
    const name = agentNames.get(id);
    return name ? `${id} (${name})` : id;
  };

  const resolveSessionKey = (raw?: string) => {
    return resolveTuiSessionKey({
      raw,
      sessionScope,
      currentAgentId,
      sessionMainKey,
    });
  };

  currentSessionKey = resolveSessionKey(initialSessionInput);

  const updateHeader = () => {
    const sessionLabel = formatSessionKey(currentSessionKey);
    const agentLabel = formatAgentLabel(currentAgentId);
    header.setText(
      theme.header(
        `mayros tui - ${client.connection.url} - agent ${agentLabel} - session ${sessionLabel}`,
      ),
    );
  };

  const busyStates = new Set(["sending", "waiting", "streaming", "running"]);
  let statusText: Text | null = null;
  let statusLoader: Loader | null = null;

  const formatElapsed = (startMs: number) => {
    const totalSeconds = Math.max(0, Math.floor((Date.now() - startMs) / 1000));
    if (totalSeconds < 60) {
      return `${totalSeconds}s`;
    }
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    return `${minutes}m ${seconds}s`;
  };

  const ensureStatusText = () => {
    if (statusText) {
      return;
    }
    statusContainer.clear();
    statusLoader?.stop();
    statusLoader = null;
    statusText = new Text("", 1, 0);
    statusContainer.addChild(statusText);
  };

  const ensureStatusLoader = () => {
    if (statusLoader) {
      return;
    }
    statusContainer.clear();
    statusText = null;
    statusLoader = new Loader(
      tui,
      (spinner) => theme.accent(spinner),
      (text) => theme.bold(theme.accentSoft(text)),
      "",
    );
    statusContainer.addChild(statusLoader);
  };

  let waitingTick = 0;
  let waitingTimer: NodeJS.Timeout | null = null;
  let waitingPhrase: string | null = null;

  const updateBusyStatusMessage = () => {
    if (!statusLoader || !statusStartedAt) {
      return;
    }
    const elapsed = formatElapsed(statusStartedAt);

    if (activityStatus === "waiting") {
      waitingTick++;
      statusLoader.setMessage(
        buildWaitingStatusMessage({
          theme,
          tick: waitingTick,
          elapsed,
          connectionStatus,
          phrases: waitingPhrase ? [waitingPhrase] : undefined,
        }),
      );
      return;
    }

    statusLoader.setMessage(`${activityStatus} • ${elapsed} | ${connectionStatus}`);
  };

  const startStatusTimer = () => {
    if (statusTimer) {
      return;
    }
    statusTimer = setInterval(() => {
      if (!busyStates.has(activityStatus)) {
        return;
      }
      updateBusyStatusMessage();
    }, 1000);
  };

  const stopStatusTimer = () => {
    if (!statusTimer) {
      return;
    }
    clearInterval(statusTimer);
    statusTimer = null;
  };

  const startWaitingTimer = () => {
    if (waitingTimer) {
      return;
    }

    // Pick a phrase once per waiting session.
    if (!waitingPhrase) {
      const idx = Math.floor(Math.random() * defaultWaitingPhrases.length);
      waitingPhrase = defaultWaitingPhrases[idx] ?? defaultWaitingPhrases[0] ?? "waiting";
    }

    waitingTick = 0;

    waitingTimer = setInterval(() => {
      if (activityStatus !== "waiting") {
        return;
      }
      updateBusyStatusMessage();
    }, 120);
  };

  const stopWaitingTimer = () => {
    if (!waitingTimer) {
      return;
    }
    clearInterval(waitingTimer);
    waitingTimer = null;
    waitingPhrase = null;
  };

  const renderStatus = () => {
    const isBusy = busyStates.has(activityStatus);
    if (isBusy) {
      if (!statusStartedAt || lastActivityStatus !== activityStatus) {
        statusStartedAt = Date.now();
      }
      ensureStatusLoader();
      if (activityStatus === "waiting") {
        stopStatusTimer();
        startWaitingTimer();
      } else {
        stopWaitingTimer();
        startStatusTimer();
      }
      updateBusyStatusMessage();
    } else {
      statusStartedAt = null;
      stopStatusTimer();
      stopWaitingTimer();
      statusLoader?.stop();
      statusLoader = null;
      ensureStatusText();
      const text = activityStatus ? `${connectionStatus} | ${activityStatus}` : connectionStatus;
      statusText?.setText(theme.dim(text));
    }
    lastActivityStatus = activityStatus;
  };

  const setConnectionStatus = (text: string, ttlMs?: number) => {
    connectionStatus = text;
    renderStatus();
    if (statusTimeout) {
      clearTimeout(statusTimeout);
    }
    if (ttlMs && ttlMs > 0) {
      statusTimeout = setTimeout(() => {
        connectionStatus = isConnected ? "connected" : "disconnected";
        renderStatus();
      }, ttlMs);
    }
  };

  const setActivityStatus = (text: string) => {
    activityStatus = text;
    renderStatus();
  };

  const updateFooter = () => {
    const sessionKeyLabel = formatSessionKey(currentSessionKey);
    const sessionLabel = sessionInfo.displayName
      ? `${sessionKeyLabel} (${sessionInfo.displayName})`
      : sessionKeyLabel;
    const agentLabel = formatAgentLabel(currentAgentId);
    const modelLabel = sessionInfo.model
      ? sessionInfo.modelProvider
        ? `${sessionInfo.modelProvider}/${sessionInfo.model}`
        : sessionInfo.model
      : "unknown";
    const tokens = formatTokens(sessionInfo.totalTokens ?? null, sessionInfo.contextTokens ?? null);
    const think = sessionInfo.thinkingLevel ?? "off";
    const verbose = sessionInfo.verboseLevel ?? "off";
    const reasoning = sessionInfo.reasoningLevel ?? "off";
    const reasoningLabel =
      reasoning === "on" ? "reasoning" : reasoning === "stream" ? "reasoning:stream" : null;
    const permLabel = permissionMode !== "auto" ? `perm ${permissionMode}` : null;
    const fastLabel = fastMode ? "FAST" : null;
    const footerParts = [
      `agent ${agentLabel}`,
      `session ${sessionLabel}`,
      modelLabel,
      think !== "off" ? `think ${think}` : null,
      verbose !== "off" ? `verbose ${verbose}` : null,
      reasoningLabel,
      tokens,
      permLabel,
      fastLabel,
    ].filter(Boolean);
    footer.setText(theme.dim(footerParts.join(" | ")));
  };

  const { openOverlay, closeOverlay } = createOverlayHandlers(tui, editor);

  const initialSessionAgentId = (() => {
    if (!initialSessionInput) {
      return null;
    }
    const parsed = parseAgentSessionKey(initialSessionInput);
    return parsed ? normalizeAgentId(parsed.agentId) : null;
  })();

  const createWelcomeScreen = () => new WelcomeScreen({ version: VERSION, getState: () => state });

  const sessionActions = createSessionActions({
    client,
    chatLog,
    tui,
    opts,
    state,
    agentNames,
    initialSessionInput,
    initialSessionAgentId,
    resolveSessionKey,
    updateHeader,
    updateFooter,
    updateAutocompleteProvider,
    setActivityStatus,
    clearLocalRunIds,
    createWelcomeScreen,
  });
  const {
    refreshAgents,
    refreshSessionInfo,
    applySessionInfoFromPatch,
    loadHistory,
    setSession,
    abortActive,
  } = sessionActions;

  const { handleChatEvent, handleAgentEvent } = createEventHandlers({
    chatLog,
    tui,
    state,
    setActivityStatus,
    refreshSessionInfo,
    loadHistory,
    isLocalRunId,
    forgetLocalRunId,
    clearLocalRunIds,
  });

  const { handleCommand, sendMessage, openModelSelector, openAgentSelector, openSessionSelector } =
    createCommandHandlers({
      client,
      chatLog,
      tui,
      opts,
      state,
      deliverDefault,
      openOverlay,
      closeOverlay,
      refreshSessionInfo,
      applySessionInfoFromPatch,
      loadHistory,
      setSession,
      refreshAgents,
      abortActive,
      setActivityStatus,
      formatSessionKey,
      noteLocalRunId,
      forgetLocalRunId,
      mouseHandler,
    });

  const { runLocalShellLine } = createLocalShellRunner({
    chatLog,
    tui,
    openOverlay,
    closeOverlay,
  });
  updateAutocompleteProvider();
  const submitHandler = createEditorSubmitHandler({
    editor,
    handleCommand,
    sendMessage,
    handleBangLine: runLocalShellLine,
  });
  editor.onSubmit = createSubmitBurstCoalescer({
    submit: submitHandler,
    enabled: shouldEnableWindowsGitBashPasteFallback(),
  });

  editor.onEscape = () => {
    void abortActive();
  };
  editor.onCtrlC = () => {
    const now = Date.now();
    // Tri-state, in priority order:
    //   1. an active run → abort it
    //   2. non-empty input → clear it
    //   3. double Ctrl+C within 1s → exit
    // Escape remains a secondary abort path.
    if (activeChatRunId) {
      void abortActive();
      return;
    }
    if (editor.getText().trim().length > 0) {
      editor.setText("");
      setActivityStatus("cleared input");
      tui.requestRender();
      return;
    }
    if (now - lastCtrlCAt < 1000) {
      mouseHandler.disable();
      client.stop();
      tui.stop();
      process.exit(0);
    }
    lastCtrlCAt = now;
    setActivityStatus("press ctrl+c again to exit");
    tui.requestRender();
  };
  editor.onCtrlD = () => {
    mouseHandler.disable();
    client.stop();
    tui.stop();
    process.exit(0);
  };
  editor.onCtrlO = () => {
    toolSectionState = nextSectionState(toolSectionState);
    toolsExpanded = toolSectionState === "expanded";
    chatLog.setToolSectionState(toolSectionState);
    setActivityStatus(`tools: ${toolSectionState}`);
    tui.requestRender();
  };
  editor.onCtrlL = () => {
    void openModelSelector();
  };
  editor.onCtrlG = () => {
    void openAgentSelector();
  };
  editor.onCtrlP = () => {
    void openSessionSelector();
  };
  editor.onCtrlT = () => {
    thinkingSectionState = nextSectionState(thinkingSectionState);
    // Thinking text is baked into the assistant message at compose time, so
    // toggling requires reloading history. "hidden" suppresses thinking;
    // "collapsed" and "expanded" both show it (a truncated mode would require
    // restructuring the composer — deferred to a follow-up).
    showThinking = thinkingSectionState !== "hidden";
    void loadHistory();
  };
  editor.onShiftTab = () => {
    const modes: Array<"auto" | "ask" | "deny"> = ["auto", "ask", "deny"];
    const idx = modes.indexOf(permissionMode);
    permissionMode = modes[(idx + 1) % modes.length] ?? "auto";
    state.permissionMode = permissionMode;
    setActivityStatus(`permission: ${permissionMode}`);
    tui.requestRender();
  };

  client.onEvent = (evt) => {
    if (evt.event === "chat") {
      handleChatEvent(evt.payload);
    }
    if (evt.event === "agent") {
      handleAgentEvent(evt.payload);
    }
  };

  client.onConnected = () => {
    isConnected = true;
    pairingHintShown = false;
    gatewayDownHintShown = false;
    const reconnected = wasDisconnected;
    wasDisconnected = false;
    setConnectionStatus("connected");
    void (async () => {
      await refreshAgents();
      updateHeader();
      if (opts.cleanStart && !reconnected) {
        chatLog.clearAll();
        chatLog.addWelcome(createWelcomeScreen());
        historyLoaded = true;
        await refreshSessionInfo();
      } else {
        await loadHistory();
      }
      setConnectionStatus(reconnected ? "gateway reconnected" : "gateway connected", 4000);
      tui.requestRender();
      if (!autoMessageSent && autoMessage) {
        autoMessageSent = true;
        await sendMessage(autoMessage);
      }
      updateFooter();
      tui.requestRender();
    })();
  };

  client.onDisconnected = (reason) => {
    isConnected = false;
    wasDisconnected = true;
    historyLoaded = false;
    const disconnectState = resolveGatewayDisconnectState(reason);
    setConnectionStatus(disconnectState.connectionStatus, 5000);
    setActivityStatus(disconnectState.activityStatus);
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
    updateFooter();
    tui.requestRender();
  };

  client.onGap = (info) => {
    setConnectionStatus(`event gap: expected ${info.expected}, got ${info.received}`, 5000);
    tui.requestRender();
  };

  updateHeader();
  setConnectionStatus("connecting");
  updateFooter();
  // Enable extended keyboard protocols (kitty / modifyOtherKeys) so modifier
  // combinations like Shift+Enter survive in capable terminals. The handle
  // restores the terminal on exit.
  const keyboardProtocol = enableKeyboardProtocol();
  tui.start();
  client.start();
  await new Promise<void>((resolve) => {
    const finish = () => {
      keyboardProtocol.disable();
      resolve();
    };
    process.once("exit", finish);
    process.once("SIGINT", finish);
    process.once("SIGTERM", finish);
  });
}

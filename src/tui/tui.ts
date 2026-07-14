import {
  CombinedAutocompleteProvider,
  Container,
  ProcessTerminal,
  Text,
  TUI,
} from "@earendil-works/pi-tui";
import { resolveDefaultAgentId } from "../agents/agent-scope.js";
import { VERSION } from "../version.js";
import { loadConfig } from "../config/config.js";
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
import { createLocalShellRunner } from "./tui-local-shell.js";
import { createOverlayHandlers } from "./tui-overlays.js";
import { createSessionActions } from "./tui-session-actions.js";
import { createStatusRenderer, type StatusRenderer } from "./tui-status-renderer.js";
import { wireEditorKeyBindings } from "./tui-keybindings.js";
import { wireConnectionHandlers } from "./tui-connection.js";
import type {
  AgentSummary,
  PendingImage,
  SectionState,
  SessionInfo,
  SessionScope,
  TuiOptions,
  TuiStateAccess,
} from "./tui-types.js";

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
  createBackspaceDeduper,
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
  let toolsExpanded = false;
  let showThinking = false;
  let toolSectionState: SectionState = "collapsed";
  let thinkingSectionState: SectionState = "collapsed";
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
  // Status display state (activity/connection labels + timers) is owned by the
  // status renderer created below. The `state` object delegates these fields
  // to the renderer via late-bound references.
  let statusRenderer: StatusRenderer | null = null;

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
      return statusRenderer?.isConnected ?? false;
    },
    set isConnected(value) {
      if (statusRenderer) {
        statusRenderer.isConnected = value;
      }
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
      return statusRenderer?.connectionStatus ?? "connecting";
    },
    set connectionStatus(value) {
      if (statusRenderer) {
        statusRenderer.connectionStatus = value;
      }
    },
    get activityStatus() {
      return statusRenderer?.activityStatus ?? "idle";
    },
    set activityStatus(value) {
      if (statusRenderer) {
        statusRenderer.activityStatus = value;
      }
    },
    get statusTimeout() {
      return statusRenderer?.statusTimeout ?? null;
    },
    set statusTimeout(value) {
      if (statusRenderer) {
        statusRenderer.statusTimeout = value;
      }
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

  // Status renderer owns the connection/activity labels, busy/idle timers,
  // and the waiting-status animation. Created here so it can capture the
  // header/footer/statusContainer nodes; the `state` object above delegates
  // activityStatus/connectionStatus/isConnected/statusTimeout to it.
  statusRenderer = createStatusRenderer({
    tui,
    statusContainer,
    header,
    footer,
    gatewayUrl: client.connection.url,
    formatSessionKey,
    formatAgentLabel,
    getCurrentSessionKey: () => currentSessionKey,
    getCurrentAgentId: () => currentAgentId,
    getSessionInfo: () => sessionInfo,
    getPermissionMode: () => permissionMode,
    getFastMode: () => fastMode,
  });

  const updateHeader = () => statusRenderer.updateHeader();
  const updateFooter = () => statusRenderer.updateFooter();
  const setConnectionStatus = (text: string, ttlMs?: number) =>
    statusRenderer.setConnectionStatus(text, ttlMs);
  const setActivityStatus = (text: string) => statusRenderer.setActivityStatus(text);

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

  wireEditorKeyBindings({
    editor,
    tui,
    chatLog,
    client,
    state,
    mouseHandler,
    abortActive,
    setActivityStatus,
    loadHistory,
    openModelSelector,
    openAgentSelector,
    openSessionSelector,
  });

  wireConnectionHandlers({
    client,
    tui,
    chatLog,
    opts,
    state,
    autoMessage,
    createWelcomeScreen,
    refreshAgents,
    refreshSessionInfo,
    loadHistory,
    sendMessage,
    updateHeader,
    updateFooter,
    setConnectionStatus,
    setActivityStatus,
    handleChatEvent,
    handleAgentEvent,
  });

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

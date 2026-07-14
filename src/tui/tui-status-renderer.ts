/**
 * Status/footer renderer extracted from tui.ts.
 *
 * Encapsulates all status display state and rendering logic that was
 * previously inlined in runTui(). The renderer owns the busy/idle timers,
 * the waiting-status animation, and the connection/activity labels.
 */

import { Container, Loader, Text, TUI } from "@earendil-works/pi-tui";
import { formatTokens } from "./tui-formatters.js";
import type { SessionInfo } from "./tui-types.js";
import { theme } from "./theme/theme.js";
import { buildWaitingStatusMessage, defaultWaitingPhrases } from "./tui-waiting.js";

/** States that show a busy spinner with elapsed time. */
const BUSY_STATES = new Set(["sending", "waiting", "streaming", "running"]);

export interface StatusRendererDeps {
  tui: TUI;
  statusContainer: Container;
  header: Text;
  footer: Text;
  gatewayUrl: string;
  formatSessionKey: (key: string) => string;
  formatAgentLabel: (id: string) => string;
  // Lazy reads from runTui state (these change over time).
  getCurrentSessionKey: () => string;
  getCurrentAgentId: () => string;
  getSessionInfo: () => SessionInfo;
  getPermissionMode: () => "auto" | "ask" | "deny";
  getFastMode: () => boolean;
}

export interface StatusRenderer {
  /** Re-render the header line (gateway URL, agent, session). */
  updateHeader(): void;
  /** Re-render the footer line (agent, session, model, tokens, flags). */
  updateFooter(): void;
  /** Re-render the status area based on current activity/connection state. */
  renderStatus(): void;
  /** Set the connection label, optionally with a TTL after which it reverts. */
  setConnectionStatus(text: string, ttlMs?: number): void;
  /** Set the activity label and re-render the status area. */
  setActivityStatus(text: string): void;
  // State delegation — the runTui `state` object proxies these.
  activityStatus: string;
  connectionStatus: string;
  isConnected: boolean;
  statusTimeout: ReturnType<typeof setTimeout> | null;
}

export function createStatusRenderer(deps: StatusRendererDeps): StatusRenderer {
  const { tui, statusContainer, header, footer, gatewayUrl } = deps;

  // Delegated state (read by runTui via the `state` object).
  let activityStatus = "idle";
  let connectionStatus = "connecting";
  let isConnected = false;
  let statusTimeout: ReturnType<typeof setTimeout> | null = null;

  // Internal rendering state (never accessed outside the renderer).
  let statusTimer: ReturnType<typeof setInterval> | null = null;
  let statusStartedAt: number | null = null;
  let lastActivityStatus = activityStatus;
  let statusText: Text | null = null;
  let statusLoader: Loader | null = null;
  let waitingTick = 0;
  let waitingTimer: ReturnType<typeof setInterval> | null = null;
  let waitingPhrase: string | null = null;

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
      if (!BUSY_STATES.has(activityStatus)) {
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
    const isBusy = BUSY_STATES.has(activityStatus);
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

  const updateHeader = () => {
    const sessionLabel = deps.formatSessionKey(deps.getCurrentSessionKey());
    const agentLabel = deps.formatAgentLabel(deps.getCurrentAgentId());
    header.setText(
      theme.header(`mayros tui - ${gatewayUrl} - agent ${agentLabel} - session ${sessionLabel}`),
    );
  };

  const updateFooter = () => {
    const sessionKeyLabel = deps.formatSessionKey(deps.getCurrentSessionKey());
    const sessionInfo = deps.getSessionInfo();
    const sessionLabel = sessionInfo.displayName
      ? `${sessionKeyLabel} (${sessionInfo.displayName})`
      : sessionKeyLabel;
    const agentLabel = deps.formatAgentLabel(deps.getCurrentAgentId());
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
    const permissionMode = deps.getPermissionMode();
    const permLabel = permissionMode !== "auto" ? `perm ${permissionMode}` : null;
    const fastLabel = deps.getFastMode() ? "FAST" : null;
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

  return {
    updateHeader,
    updateFooter,
    renderStatus,
    setConnectionStatus,
    setActivityStatus,
    get activityStatus() {
      return activityStatus;
    },
    set activityStatus(value: string) {
      activityStatus = value;
    },
    get connectionStatus() {
      return connectionStatus;
    },
    set connectionStatus(value: string) {
      connectionStatus = value;
    },
    get isConnected() {
      return isConnected;
    },
    set isConnected(value: boolean) {
      isConnected = value;
    },
    get statusTimeout() {
      return statusTimeout;
    },
    set statusTimeout(value: ReturnType<typeof setTimeout> | null) {
      statusTimeout = value;
    },
  };
}

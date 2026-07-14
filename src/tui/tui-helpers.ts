/**
 * Pure helper functions extracted from tui.ts.
 *
 * These functions have no dependency on the TUI instance, the gateway client,
 * or any mutable state — they are pure factories and resolvers tested in
 * tui.test.ts. Extracting them keeps tui.ts focused on wiring.
 */

import { Key, matchesKey } from "@earendil-works/pi-tui";
import { buildAgentMainSessionKey } from "../routing/session-key.js";
import type { SessionScope } from "./tui-types.js";

export function createEditorSubmitHandler(params: {
  editor: {
    setText: (value: string) => void;
    addToHistory: (value: string) => void;
  };
  handleCommand: (value: string) => Promise<void> | void;
  sendMessage: (value: string) => Promise<void> | void;
  handleBangLine: (value: string) => Promise<void> | void;
}) {
  return (text: string) => {
    const raw = text;
    const value = raw.trim();
    params.editor.setText("");

    // Keep previous behavior: ignore empty/whitespace-only submissions.
    if (!value) {
      return;
    }

    // Bash mode: only if the very first character is '!' and it's not just '!'.
    // IMPORTANT: use the raw (untrimmed) text so leading spaces do NOT trigger.
    // Per requirement: a lone '!' should be treated as a normal message.
    if (raw.startsWith("!") && raw !== "!") {
      params.editor.addToHistory(raw);
      void params.handleBangLine(raw);
      return;
    }

    // Enable built-in editor prompt history navigation (up/down).
    params.editor.addToHistory(value);

    if (value.startsWith("/")) {
      void params.handleCommand(value);
      return;
    }

    void params.sendMessage(value);
  };
}

export function shouldEnableWindowsGitBashPasteFallback(params?: {
  platform?: string;
  env?: NodeJS.ProcessEnv;
}): boolean {
  const platform = params?.platform ?? process.platform;
  if (platform !== "win32") {
    return false;
  }
  const env = params?.env ?? process.env;
  const msystem = (env.MSYSTEM ?? "").toUpperCase();
  const shell = env.SHELL ?? "";
  const termProgram = (env.TERM_PROGRAM ?? "").toLowerCase();
  if (msystem.startsWith("MINGW") || msystem.startsWith("MSYS")) {
    return true;
  }
  if (shell.toLowerCase().includes("bash")) {
    return true;
  }
  return termProgram.includes("mintty");
}

export function createSubmitBurstCoalescer(params: {
  submit: (value: string) => void;
  enabled: boolean;
  burstWindowMs?: number;
  now?: () => number;
  setTimer?: typeof setTimeout;
  clearTimer?: typeof clearTimeout;
}) {
  const windowMs = Math.max(1, params.burstWindowMs ?? 50);
  const now = params.now ?? (() => Date.now());
  const setTimer = params.setTimer ?? setTimeout;
  const clearTimer = params.clearTimer ?? clearTimeout;
  let pending: string | null = null;
  let pendingAt = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const clearFlushTimer = () => {
    if (!flushTimer) {
      return;
    }
    clearTimer(flushTimer);
    flushTimer = null;
  };

  const flushPending = () => {
    if (pending === null) {
      return;
    }
    const value = pending;
    pending = null;
    pendingAt = 0;
    clearFlushTimer();
    params.submit(value);
  };

  const scheduleFlush = () => {
    clearFlushTimer();
    flushTimer = setTimer(() => {
      flushPending();
    }, windowMs);
  };

  return (value: string) => {
    if (!params.enabled) {
      params.submit(value);
      return;
    }
    if (value.includes("\n")) {
      flushPending();
      params.submit(value);
      return;
    }
    const ts = now();
    if (pending === null) {
      pending = value;
      pendingAt = ts;
      scheduleFlush();
      return;
    }
    if (ts - pendingAt <= windowMs) {
      pending = `${pending}\n${value}`;
      pendingAt = ts;
      scheduleFlush();
      return;
    }
    flushPending();
    pending = value;
    pendingAt = ts;
    scheduleFlush();
  };
}

export function resolveTuiSessionKey(params: {
  raw?: string;
  sessionScope: SessionScope;
  currentAgentId: string;
  sessionMainKey: string;
}) {
  const trimmed = (params.raw ?? "").trim();
  if (!trimmed) {
    if (params.sessionScope === "global") {
      return "global";
    }
    return buildAgentMainSessionKey({
      agentId: params.currentAgentId,
      mainKey: params.sessionMainKey,
    });
  }
  if (trimmed === "global" || trimmed === "unknown") {
    return trimmed;
  }
  if (trimmed.startsWith("agent:")) {
    return trimmed;
  }
  return `agent:${params.currentAgentId}:${trimmed}`;
}

export async function tryInlinePairingApproval(): Promise<boolean> {
  try {
    const { listDevicePairing, approveDevicePairing } = await import("../infra/device-pairing.js");
    const list = await listDevicePairing();
    if (!list.pending.length) return false;
    const latest = list.pending.reduce((a, b) => (b.ts > a.ts ? b : a));
    return (await approveDevicePairing(latest.requestId)) !== null;
  } catch {
    return false;
  }
}

export function resolveGatewayDisconnectState(reason?: string): {
  connectionStatus: string;
  activityStatus: string;
  pairingHint?: string;
  gatewayDownHint?: string;
} {
  const reasonLabel = reason?.trim() ? reason.trim() : "closed";
  if (/pairing required/i.test(reasonLabel)) {
    return {
      connectionStatus: `gateway disconnected: ${reasonLabel}`,
      activityStatus: "pairing required: run mayros devices list",
      pairingHint:
        "Pairing required. Run `mayros devices list`, approve your request ID, then reconnect.",
    };
  }
  if (/ECONNREFUSED|connect failed/i.test(reasonLabel)) {
    return {
      connectionStatus: "gateway not running",
      activityStatus: "start gateway with: mayros gateway run",
      gatewayDownHint:
        "Gateway is not responding. Start it with `mayros gateway run` or `mayros onboard`.",
    };
  }
  return {
    connectionStatus: `gateway disconnected: ${reasonLabel}`,
    activityStatus: "idle",
  };
}

export function createBackspaceDeduper(params?: { dedupeWindowMs?: number; now?: () => number }) {
  const dedupeWindowMs = Math.max(0, Math.floor(params?.dedupeWindowMs ?? 8));
  const now = params?.now ?? (() => Date.now());
  let lastBackspaceAt = -1;

  return (data: string): string => {
    if (!matchesKey(data, Key.backspace)) {
      return data;
    }
    const ts = now();
    if (lastBackspaceAt >= 0 && ts - lastBackspaceAt <= dedupeWindowMs) {
      return "";
    }
    lastBackspaceAt = ts;
    return data;
  };
}

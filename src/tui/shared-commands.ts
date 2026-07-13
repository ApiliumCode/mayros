/**
 * Renderer-agnostic slash-command handling shared between the graphical TUI
 * and the accessible (text-mode) TUI.
 *
 * The graphical TUI dispatches most commands through its own full handler
 * (tui-command-handlers.ts) because it has overlays, pickers, and rich
 * rendering. The accessible TUI has none of that, so it routes a focused set
 * of commands through this shared core, which calls the gateway client
 * directly and reports results as plain text via the injected render sink.
 *
 * This closes the feature-parity gap without forcing both TUIs to share a
 * renderer: the logic is shared, the presentation is not.
 */

import type { GatewayChatClient } from "./gateway-chat.js";

/** Sink for status/system messages produced by shared commands. */
export type SharedCommandSink = {
  /** Surface a normal informational message. */
  info: (text: string) => void;
  /** Surface an error message. */
  error: (text: string) => void;
};

export type SharedCommandContext = {
  client: GatewayChatClient;
  sessionKey: string;
  /** Active run id, if any, for abort. */
  getActiveRunId?: () => string | null;
  /** Called after a session reset/switch so the caller can update its state. */
  onSessionChanged?: (sessionKey: string) => void;
};

export type HandleSharedCommandResult = {
  /** true if the command was recognized and handled here. */
  handled: boolean;
};

/**
 * Handle a focused set of slash commands against the gateway client.
 * Returns { handled: true } when the command was recognized; the caller
 * should not fall through to sending it as a chat message in that case.
 */
export async function handleSharedCommand(
  ctx: SharedCommandContext,
  name: string,
  args: string,
  sink: SharedCommandSink,
): Promise<HandleSharedCommandResult> {
  switch (name) {
    case "abort": {
      const runId = ctx.getActiveRunId?.() ?? null;
      if (!runId) {
        sink.info("no active run");
        return { handled: true };
      }
      try {
        await ctx.client.abortChat({ sessionKey: ctx.sessionKey, runId });
        sink.info("aborted");
      } catch (err) {
        sink.error(`abort failed: ${String(err)}`);
      }
      return { handled: true };
    }

    case "new":
    case "reset": {
      try {
        await ctx.client.resetSession(ctx.sessionKey, name === "new" ? "new" : "reset");
        sink.info("session reset");
        ctx.onSessionChanged?.(ctx.sessionKey);
      } catch (err) {
        sink.error(`reset failed: ${String(err)}`);
      }
      return { handled: true };
    }

    case "compact": {
      try {
        const result = await ctx.client.compactSession({ key: ctx.sessionKey });
        if (result.compacted) {
          sink.info("context compacted");
        } else {
          sink.info(`compaction skipped: ${result.reason ?? "no change"}`);
        }
      } catch (err) {
        sink.error(`compact failed: ${String(err)}`);
      }
      return { handled: true };
    }

    case "status": {
      try {
        const status = await ctx.client.getStatus();
        const summary = formatStatusSummary(status);
        sink.info(summary);
      } catch (err) {
        sink.error(`status failed: ${String(err)}`);
      }
      return { handled: true };
    }

    case "sessions":
    case "session": {
      if (name === "sessions" || !args) {
        try {
          const result = await ctx.client.listSessions({ limit: 20 });
          const lines = formatSessionList(result);
          sink.info(lines || "no sessions");
        } catch (err) {
          sink.error(`session list failed: ${String(err)}`);
        }
        return { handled: true };
      }
      // `/session <key>` — switch by setting currentSessionKey on the caller.
      ctx.onSessionChanged?.(args.trim());
      sink.info(`switched to ${args.trim()}`);
      return { handled: true };
    }

    case "models":
    case "model": {
      try {
        const models = await ctx.client.listModels();
        if (models.length === 0) {
          sink.info("no models configured");
        } else {
          const lines = models.map((m) => `  ${m.id}${m.name ? ` — ${m.name}` : ""}`).join("\n");
          sink.info(`Available models:\n${lines}`);
        }
      } catch (err) {
        sink.error(`model list failed: ${String(err)}`);
      }
      return { handled: true };
    }

    case "help": {
      sink.info(SHARED_HELP_TEXT);
      return { handled: true };
    }

    default:
      return { handled: false };
  }
}

function formatStatusSummary(status: unknown): string {
  if (!status || typeof status !== "object") return String(status);
  const s = status as Record<string, unknown>;
  const parts: string[] = [];
  if (typeof s.version === "string") parts.push(`gateway ${s.version}`);
  if (typeof s.uptime === "number") parts.push(`uptime ${Math.round(s.uptime)}s`);
  if (s.model && typeof s.model === "object") {
    const m = s.model as Record<string, unknown>;
    if (typeof m.id === "string") parts.push(`model ${m.id}`);
  }
  if (typeof s.sessions === "number") parts.push(`${s.sessions} sessions`);
  return parts.length > 0 ? parts.join(" · ") : "status unavailable";
}

function formatSessionList(result: unknown): string {
  if (!result || typeof result !== "object") return "";
  const r = result as Record<string, unknown>;
  const sessions = Array.isArray(r.sessions) ? r.sessions : [];
  if (sessions.length === 0) return "";
  return sessions
    .map((entry, i) => {
      const e = entry as Record<string, unknown>;
      const key = typeof e.key === "string" ? e.key : `session-${i}`;
      const title = typeof e.title === "string" ? e.title : "";
      return `  ${key}${title ? ` — ${title}` : ""}`;
    })
    .join("\n");
}

const SHARED_HELP_TEXT = `Available commands in accessible mode:
  /abort          Abort the active run
  /new            Reset the session (new conversation)
  /reset          Reset the session
  /compact        Compact session context
  /status         Show gateway status
  /sessions       List recent sessions
  /session <key>  Switch to a session by key
  /model          List available models
  /help           Show this help
  /quit, /exit    Exit

Type a message and press Enter to send.`;

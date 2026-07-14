/**
 * Teleport command group (session export/import across devices).
 * Command: teleport
 */

import { copyToClipboard } from "../infra/clipboard.js";
import {
  exportSession,
  importSession,
  validatePayloadSize,
  MAX_EXPORT_MESSAGES,
  type TeleportPayload,
} from "./session-teleport.js";
import type { CommandGroupHandler } from "./tui-cmd-types.js";

export const teleportCommands: CommandGroupHandler = async (ctx, name, args, _raw) => {
  const { client, chatLog, tui, state } = ctx;

  if (name !== "teleport") {
    return false;
  }

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
        messages = history.map((m: { role?: string; content?: string; timestamp?: string }) => ({
          role: (m.role as "user" | "assistant" | "system") ?? "user",
          content: typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
          ...(m.timestamp ? { timestamp: m.timestamp } : {}),
        }));
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
    // Copy to clipboard using the cross-platform clipboard helper
    // (pbcopy / xclip / wl-copy / clip.exe / PowerShell fallback).
    try {
      const ok = await copyToClipboard(token);
      chatLog.addSystem(
        ok
          ? `Session exported to clipboard (${token.length} chars, ${messages.length} messages). Share this token to import on another device.`
          : `Session token (no clipboard tool found):\n${token}`,
      );
    } catch {
      chatLog.addSystem(`Session token:\n${token}`);
    }
    return true;
  }

  if (subCmd === "import") {
    const token = args.slice("import".length).trim();
    if (!token) {
      chatLog.addSystem("Usage: /teleport import <token>");
      return true;
    }
    try {
      const payload = importSession(token);

      // Render each message in the chat log display and inject
      // assistant messages into the current session via the gateway.
      // User and system messages are shown visually only — they are
      // part of the imported context that the user brought over.
      let injected = 0;
      let failed = 0;
      for (const msg of payload.messages) {
        if (msg.role === "user") {
          chatLog.addUser(msg.content);
        } else if (msg.role === "system") {
          chatLog.addSystem(msg.content);
        } else if (msg.role === "assistant") {
          // Persist to the session transcript so the model sees the history
          try {
            await client.injectChat({
              sessionKey: state.currentSessionKey,
              message: msg.content,
              label: "teleport",
            });
            chatLog.finalizeAssistant(msg.content);
            injected++;
          } catch {
            // Fall back to display-only if injection fails
            chatLog.finalizeAssistant(msg.content);
            failed++;
          }
        }
      }

      const summaryParts = [`Session imported: ${payload.messages.length} messages`];
      summaryParts.push(`from agent "${payload.agentId}" (${payload.timestamp})`);
      if (injected > 0) {
        summaryParts.push(`${injected} assistant message(s) written to session transcript`);
      }
      if (failed > 0) {
        summaryParts.push(
          `${failed} assistant message(s) displayed only (transcript write failed)`,
        );
      }
      chatLog.addSystem(summaryParts.join(" — "));
      tui.requestRender();
    } catch (err) {
      chatLog.addSystem(`Import failed: ${String(err)}`);
    }
    return true;
  }

  chatLog.addSystem("Usage: /teleport export | /teleport import <token>");
  return true;
};

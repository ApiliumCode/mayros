/**
 * SessionManager — Enhanced session operations for the TUI.
 *
 * Provides list, resume, rename, and delete operations for sessions,
 * building on the existing GatewayChatClient API.
 */

import { formatRelativeTimestamp } from "../infra/format-time/format-relative.js";
import type { GatewayChatClient, GatewaySessionList } from "./gateway-chat.js";

export type SessionSummary = {
  key: string;
  title: string;
  updatedAt: string;
  preview: string;
  model?: string;
};

export type SessionListOptions = {
  agentId?: string;
  limit?: number;
};

export type SessionManagerContext = {
  client: GatewayChatClient;
  currentAgentId: string;
};

export class SessionManager {
  private client: GatewayChatClient;
  private agentId: string;

  constructor(ctx: SessionManagerContext) {
    this.client = ctx.client;
    this.agentId = ctx.currentAgentId;
  }

  /**
   * List recent sessions with formatted metadata.
   */
  async listSessions(opts: SessionListOptions = {}): Promise<SessionSummary[]> {
    const result = await this.client.listSessions({
      agentId: opts.agentId ?? this.agentId,
      limit: opts.limit ?? 20,
      includeGlobal: false,
      includeUnknown: false,
      includeDerivedTitles: true,
      includeLastMessage: true,
    });

    return formatSessionList(result);
  }

  /**
   * Rename the current session.
   */
  async renameSession(key: string, displayName: string): Promise<void> {
    await this.client.patchSession({ key, label: displayName });
  }

  /**
   * Delete a session by key.
   */
  async deleteSession(key: string): Promise<void> {
    await this.client.resetSession(key, "reset");
  }
}

/**
 * Format a gateway session list into display-friendly summaries.
 */
export function formatSessionList(result: GatewaySessionList): SessionSummary[] {
  return result.sessions.map((session) => {
    const title = session.derivedTitle ?? session.displayName ?? session.key;
    const updatedAt = session.updatedAt
      ? formatRelativeTimestamp(session.updatedAt, { dateFallback: true, fallback: "" })
      : "";
    const preview = session.lastMessagePreview
      ? session.lastMessagePreview.replace(/\s+/g, " ").trim().slice(0, 80)
      : "";

    return {
      key: session.key,
      title,
      updatedAt,
      preview,
      model: session.model,
    };
  });
}

/**
 * Format a session summary as a single display line.
 */
export function formatSessionLine(
  session: SessionSummary,
  formatKey: (key: string) => string,
): string {
  const key = formatKey(session.key);
  const time = session.updatedAt ? ` (${session.updatedAt})` : "";
  const preview = session.preview ? ` — ${session.preview}` : "";
  const titlePart = session.title !== session.key ? `${session.title} ` : "";
  return `${titlePart}[${key}]${time}${preview}`;
}

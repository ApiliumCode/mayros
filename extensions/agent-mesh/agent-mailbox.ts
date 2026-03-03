/**
 * Agent Mailbox
 *
 * Cortex-backed persistent messaging between agents. Messages survive
 * restarts and support inbox/outbox queries, threading via replyTo,
 * and status tracking (unread/read/archived).
 *
 * Triple schema:
 *   Subject:   {ns}:mailbox:{recipientId}:{messageId}
 *   Predicates: {ns}:mail:from, :to, :content, :type, :sentAt, :readAt, :status, :replyTo
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";

// ============================================================================
// Types
// ============================================================================

export type MailMessageType =
  | "task"
  | "finding"
  | "question"
  | "status"
  | "knowledge-share"
  | "delegation-context";

export type MailStatus = "unread" | "read" | "archived";

export type MailMessage = {
  id: string;
  from: string;
  to: string;
  content: string;
  type: MailMessageType;
  sentAt: string;
  readAt?: string;
  status: MailStatus;
  replyTo?: string;
};

export type MailboxQuery = {
  agent?: string;
  from?: string;
  status?: MailStatus;
  type?: MailMessageType;
  limit?: number;
  since?: string;
};

export type MailboxStats = {
  total: number;
  unread: number;
  read: number;
  archived: number;
  byType: Record<string, number>;
};

// ============================================================================
// Helpers
// ============================================================================

const VALID_MAIL_TYPES: MailMessageType[] = [
  "task",
  "finding",
  "question",
  "status",
  "knowledge-share",
  "delegation-context",
];

const VALID_MAIL_STATUSES: MailStatus[] = ["unread", "read", "archived"];

export function isValidMailMessageType(type: string): type is MailMessageType {
  return VALID_MAIL_TYPES.includes(type as MailMessageType);
}

export function isValidMailStatus(status: string): status is MailStatus {
  return VALID_MAIL_STATUSES.includes(status as MailStatus);
}

function mailSubject(ns: string, recipientId: string, messageId: string): string {
  return `${ns}:mailbox:${recipientId}:${messageId}`;
}

function mailPredicate(ns: string, field: string): string {
  return `${ns}:mail:${field}`;
}

function extractTripleValue(obj: unknown): string {
  if (typeof obj === "string") return obj;
  if (typeof obj === "number") return String(obj);
  if (typeof obj === "object" && obj !== null && "node" in obj) {
    return String((obj as { node: string }).node);
  }
  return String(obj);
}

// ============================================================================
// AgentMailbox
// ============================================================================

export class AgentMailbox {
  constructor(
    private readonly client: CortexClient,
    private readonly ns: string,
  ) {}

  /**
   * Send a message from one agent to another.
   */
  async send(params: {
    from: string;
    to: string;
    content: string;
    type?: MailMessageType;
    replyTo?: string;
  }): Promise<MailMessage> {
    const messageId = randomUUID().slice(0, 12);
    const now = new Date().toISOString();
    const messageType = params.type ?? "task";
    const subject = mailSubject(this.ns, params.to, messageId);

    const fields: Array<[string, string]> = [
      ["from", params.from],
      ["to", params.to],
      ["content", params.content],
      ["type", messageType],
      ["sentAt", now],
      ["status", "unread"],
    ];

    if (params.replyTo) {
      fields.push(["replyTo", params.replyTo]);
    }

    for (const [field, value] of fields) {
      await this.client.createTriple({
        subject,
        predicate: mailPredicate(this.ns, field),
        object: value,
      });
    }

    return {
      id: messageId,
      from: params.from,
      to: params.to,
      content: params.content,
      type: messageType,
      sentAt: now,
      status: "unread",
      replyTo: params.replyTo,
    };
  }

  /**
   * Query inbox for an agent. Filters by status, type, sender, and since date.
   */
  async inbox(query: MailboxQuery): Promise<MailMessage[]> {
    const agent = query.agent;
    if (!agent) return [];

    // Find all messages for this agent by querying the "to" predicate
    const result = await this.client.patternQuery({
      predicate: mailPredicate(this.ns, "to"),
      object: { node: agent },
      limit: 500,
    });

    if (result.matches.length === 0) return [];

    const messages: MailMessage[] = [];
    const limit = query.limit ?? 50;

    for (const match of result.matches) {
      if (messages.length >= limit) break;

      const subj = String(match.subject);
      const msg = await this.reconstructMessage(subj);
      if (!msg) continue;

      // Apply filters
      if (query.status && msg.status !== query.status) continue;
      if (query.type && msg.type !== query.type) continue;
      if (query.from && msg.from !== query.from) continue;
      if (query.since && msg.sentAt < query.since) continue;

      messages.push(msg);
    }

    // Sort newest first
    messages.sort((a, b) => b.sentAt.localeCompare(a.sentAt));

    return messages;
  }

  /**
   * Query outbox for an agent (messages sent by this agent).
   */
  async outbox(agentId: string, opts?: { limit?: number }): Promise<MailMessage[]> {
    const result = await this.client.patternQuery({
      predicate: mailPredicate(this.ns, "from"),
      object: { node: agentId },
      limit: 500,
    });

    if (result.matches.length === 0) return [];

    const messages: MailMessage[] = [];
    const limit = opts?.limit ?? 50;

    for (const match of result.matches) {
      if (messages.length >= limit) break;

      const subj = String(match.subject);
      const msg = await this.reconstructMessage(subj);
      if (msg) messages.push(msg);
    }

    messages.sort((a, b) => b.sentAt.localeCompare(a.sentAt));
    return messages;
  }

  /**
   * Mark a message as read.
   */
  async markRead(recipientId: string, messageId: string): Promise<boolean> {
    const subject = mailSubject(this.ns, recipientId, messageId);
    const msg = await this.reconstructMessage(subject);
    if (!msg) return false;

    await this.updateField(subject, "status", "read");
    await this.updateField(subject, "readAt", new Date().toISOString());
    return true;
  }

  /**
   * Mark a message as archived.
   */
  async markArchived(recipientId: string, messageId: string): Promise<boolean> {
    const subject = mailSubject(this.ns, recipientId, messageId);
    const msg = await this.reconstructMessage(subject);
    if (!msg) return false;

    await this.updateField(subject, "status", "archived");
    return true;
  }

  /**
   * Get a single message by recipient + message ID.
   */
  async getMessage(recipientId: string, messageId: string): Promise<MailMessage | null> {
    const subject = mailSubject(this.ns, recipientId, messageId);
    return this.reconstructMessage(subject);
  }

  /**
   * Get mailbox statistics for an agent.
   */
  async stats(agentId: string): Promise<MailboxStats> {
    const messages = await this.inbox({ agent: agentId, limit: 1000 });

    const stats: MailboxStats = {
      total: messages.length,
      unread: 0,
      read: 0,
      archived: 0,
      byType: {},
    };

    for (const msg of messages) {
      if (msg.status === "unread") stats.unread++;
      else if (msg.status === "read") stats.read++;
      else if (msg.status === "archived") stats.archived++;

      stats.byType[msg.type] = (stats.byType[msg.type] ?? 0) + 1;
    }

    return stats;
  }

  // ---------- internal ----------

  private async reconstructMessage(subject: string): Promise<MailMessage | null> {
    const result = await this.client.listTriples({ subject, limit: 20 });
    if (result.triples.length === 0) return null;

    const fields: Record<string, string> = {};
    const predPrefix = mailPredicate(this.ns, "");

    for (const t of result.triples) {
      const pred = String(t.predicate);
      if (pred.startsWith(predPrefix)) {
        fields[pred.slice(predPrefix.length)] = extractTripleValue(t.object);
      }
    }

    if (!fields.from || !fields.to) return null;

    // Extract messageId from subject: {ns}:mailbox:{recipientId}:{messageId}
    const parts = subject.split(":");
    const messageId = parts[parts.length - 1];

    return {
      id: messageId,
      from: fields.from,
      to: fields.to,
      content: fields.content ?? "",
      type: isValidMailMessageType(fields.type ?? "") ? (fields.type as MailMessageType) : "task",
      sentAt: fields.sentAt ?? "",
      readAt: fields.readAt || undefined,
      status: isValidMailStatus(fields.status ?? "") ? (fields.status as MailStatus) : "unread",
      replyTo: fields.replyTo || undefined,
    };
  }

  private async updateField(subject: string, field: string, value: string): Promise<void> {
    const predicate = mailPredicate(this.ns, field);

    // Delete existing
    const existing = await this.client.listTriples({
      subject,
      predicate,
      limit: 1,
    });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    // Write new
    await this.client.createTriple({ subject, predicate, object: value });
  }
}

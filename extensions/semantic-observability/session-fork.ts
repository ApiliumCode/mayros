/**
 * Session Fork/Rewind Manager
 *
 * Session state as Cortex subgraph. Fork = snapshot current session triples
 * into a new session key. Rewind = soft-delete triples after a given timestamp.
 *
 * Triple namespace:
 *   Subject: {ns}:session:{sessionKey}
 *   Predicates:
 *     {ns}:session:parentSession   — parent session key (for forks)
 *     {ns}:session:forkedAt        — ISO timestamp
 *     {ns}:session:forkedFrom      — original session key
 *     {ns}:session:checkpoint      — serialized checkpoint data (JSON)
 *     {ns}:session:status          — active|rewound|forked
 *     {ns}:session:rewindPoint     — ISO timestamp of rewind target
 */

import { randomUUID } from "node:crypto";
import type { CortexClient } from "../shared/cortex-client.js";
import type { TraceEmitter, TraceEvent } from "./trace-emitter.js";

// ============================================================================
// Types
// ============================================================================

export type SessionCheckpoint = {
  sessionKey: string;
  timestamp: string;
  eventCount: number;
  lastEventId?: string;
};

export type ForkResult = {
  originalSession: string;
  forkedSession: string;
  forkedAt: string;
  eventsCopied: number;
};

export type RewindResult = {
  sessionKey: string;
  rewindPoint: string;
  eventsRemoved: number;
  eventsRetained: number;
};

export type SessionForkEntry = {
  sessionKey: string;
  parentSession?: string;
  forkedAt?: string;
  status: "active" | "rewound" | "forked";
  checkpoints: SessionCheckpoint[];
};

// ============================================================================
// Helpers
// ============================================================================

function sessionSubject(ns: string, sessionKey: string): string {
  return `${ns}:session:${sessionKey}`;
}

function sessionPredicate(ns: string, field: string): string {
  return `${ns}:session:${field}`;
}

// ============================================================================
// SessionForkManager
// ============================================================================

export class SessionForkManager {
  constructor(
    private readonly client: CortexClient,
    private readonly emitter: TraceEmitter,
    private readonly ns: string,
  ) {}

  /**
   * Create a checkpoint of the current session state.
   */
  async checkpoint(sessionKey: string): Promise<SessionCheckpoint> {
    const events = this.emitter.getBufferedEvents().filter((e) => e.session === sessionKey);
    const timestamp = new Date().toISOString();
    const lastEvent = events.length > 0 ? events[events.length - 1] : undefined;

    const cp: SessionCheckpoint = {
      sessionKey,
      timestamp,
      eventCount: events.length,
      lastEventId: lastEvent?.id,
    };

    const subject = sessionSubject(this.ns, sessionKey);

    // Ensure session status exists
    await this.updateField(subject, "status", "active");

    // Store checkpoint as JSON triple
    await this.client.createTriple({
      subject,
      predicate: sessionPredicate(this.ns, "checkpoint"),
      object: JSON.stringify(cp),
    });

    return cp;
  }

  /**
   * Fork a session — copy events from source to a new session key.
   */
  async fork(sessionKey: string, newSessionKey?: string): Promise<ForkResult> {
    const forkedKey = newSessionKey ?? `fork-${randomUUID().slice(0, 8)}`;
    const forkedAt = new Date().toISOString();

    // Query events for the source session
    const events = await this.getSessionEvents(sessionKey);

    // Re-emit events under the new session key
    for (const evt of events) {
      const forkedEvent: TraceEvent = {
        ...evt,
        id: randomUUID(),
        session: forkedKey,
      };
      this.emitter.emitRaw(forkedEvent);
    }

    // Record fork metadata
    const forkSubject = sessionSubject(this.ns, forkedKey);
    await this.client.createTriple({
      subject: forkSubject,
      predicate: sessionPredicate(this.ns, "parentSession"),
      object: sessionKey,
    });
    await this.client.createTriple({
      subject: forkSubject,
      predicate: sessionPredicate(this.ns, "forkedAt"),
      object: forkedAt,
    });
    await this.client.createTriple({
      subject: forkSubject,
      predicate: sessionPredicate(this.ns, "forkedFrom"),
      object: sessionKey,
    });
    await this.client.createTriple({
      subject: forkSubject,
      predicate: sessionPredicate(this.ns, "status"),
      object: "active",
    });

    // Mark source session as forked
    const sourceSubject = sessionSubject(this.ns, sessionKey);
    await this.updateField(sourceSubject, "status", "forked");

    return {
      originalSession: sessionKey,
      forkedSession: forkedKey,
      forkedAt,
      eventsCopied: events.length,
    };
  }

  /**
   * Rewind a session — mark events after a given timestamp as inactive.
   */
  async rewind(sessionKey: string, toTimestamp: string): Promise<RewindResult> {
    const events = await this.getSessionEvents(sessionKey);
    const cutoff = new Date(toTimestamp).getTime();

    let eventsRemoved = 0;
    let eventsRetained = 0;

    for (const evt of events) {
      const evtTime = new Date(evt.timestamp).getTime();
      if (evtTime > cutoff) {
        // Mark as rewound by creating an inactivity triple
        await this.client.createTriple({
          subject: `${this.ns}:event:${evt.id}`,
          predicate: `${this.ns}:event:rewound`,
          object: "true",
        });
        eventsRemoved++;
      } else {
        eventsRetained++;
      }
    }

    // Update session metadata
    const subject = sessionSubject(this.ns, sessionKey);
    await this.updateField(subject, "status", "rewound");
    await this.updateField(subject, "rewindPoint", toTimestamp);

    return {
      sessionKey,
      rewindPoint: toTimestamp,
      eventsRemoved,
      eventsRetained,
    };
  }

  /**
   * List fork/rewind history for a session (or all sessions).
   */
  async listForks(sessionKey?: string): Promise<SessionForkEntry[]> {
    const pred = sessionPredicate(this.ns, "status");
    const result = await this.client.patternQuery({
      predicate: pred,
      limit: 200,
    });

    const entries: SessionForkEntry[] = [];
    const prefix = `${this.ns}:session:`;

    for (const match of result.matches) {
      if (!match.subject.startsWith(prefix)) continue;

      const key = match.subject.slice(prefix.length);

      // Filter to requested session if specified
      if (sessionKey && key !== sessionKey) {
        // Also include forks of the requested session
        const parentResult = await this.client.listTriples({
          subject: match.subject,
          predicate: sessionPredicate(this.ns, "forkedFrom"),
        });
        const isChild = parentResult.triples.some((t) => String(t.object) === sessionKey);
        if (!isChild) continue;
      }

      const entry = await this.getSessionInfo(key);
      if (entry) entries.push(entry);
    }

    return entries;
  }

  /**
   * Reconstruct a SessionForkEntry from Cortex triples.
   */
  async getSessionInfo(sessionKey: string): Promise<SessionForkEntry | null> {
    const subject = sessionSubject(this.ns, sessionKey);

    const result = await this.client.listTriples({
      subject,
      limit: 100,
    });

    if (result.triples.length === 0) return null;

    let parentSession: string | undefined;
    let forkedAt: string | undefined;
    let status: "active" | "rewound" | "forked" = "active";
    const checkpoints: SessionCheckpoint[] = [];

    for (const t of result.triples) {
      const pred = String(t.predicate);
      const obj = String(t.object);

      if (pred === sessionPredicate(this.ns, "parentSession")) {
        parentSession = obj;
      } else if (pred === sessionPredicate(this.ns, "forkedAt")) {
        forkedAt = obj;
      } else if (pred === sessionPredicate(this.ns, "status")) {
        if (obj === "active" || obj === "rewound" || obj === "forked") {
          status = obj;
        }
      } else if (pred === sessionPredicate(this.ns, "checkpoint")) {
        try {
          checkpoints.push(JSON.parse(obj) as SessionCheckpoint);
        } catch {
          // Skip malformed checkpoints
        }
      }
    }

    return { sessionKey, parentSession, forkedAt, status, checkpoints };
  }

  // ---------- Private helpers ----------

  /**
   * Get events for a session from the emitter buffer and/or Cortex.
   *
   * Fetches Cortex events in pages of 50 instead of a single limit:5000 query.
   * Skips per-event listTriples calls for events that don't belong to the
   * requested session. The entire Cortex fetch is bounded by a 30-second timeout.
   */
  private async getSessionEvents(sessionKey: string, timeoutMs = 30_000): Promise<TraceEvent[]> {
    // First check the local buffer
    const buffered = this.emitter.getBufferedEvents().filter((e) => e.session === sessionKey);

    // Also query Cortex for previously flushed events
    const flushed = await this.fetchFlushedEvents(sessionKey, timeoutMs, buffered);

    return [...flushed, ...buffered].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
  }

  /**
   * Paginate through Cortex events in batches of 50, reconstructing only those
   * that belong to the requested session. Aborts if the timeout elapses.
   */
  private async fetchFlushedEvents(
    sessionKey: string,
    timeoutMs: number,
    buffered: TraceEvent[],
  ): Promise<TraceEvent[]> {
    const PAGE_SIZE = 50;
    const deadline = Date.now() + timeoutMs;

    try {
      const flushed: TraceEvent[] = [];
      const prefix = `${this.ns}:event:`;
      const bufferedIds = new Set(buffered.map((e) => e.id));

      let offset = 0;
      let hasMore = true;

      while (hasMore) {
        if (Date.now() >= deadline) break;

        const result = await this.client.patternQuery({
          predicate: `${this.ns}:event:type`,
          limit: PAGE_SIZE,
          ...(offset > 0 ? { offset } : {}),
        });

        const matches = result.matches;
        hasMore = matches.length === PAGE_SIZE;
        offset += matches.length;

        // Fetch triple detail for each candidate in parallel (capped at PAGE_SIZE)
        const candidates = matches.filter(
          (m) =>
            String(m.subject).startsWith(prefix) &&
            !bufferedIds.has(String(m.subject).slice(prefix.length)),
        );

        const reconstructed = await Promise.all(
          candidates.map((match) =>
            this.reconstructEventIfSession(match.subject, sessionKey, prefix),
          ),
        );

        for (const evt of reconstructed) {
          if (evt !== null) flushed.push(evt);
        }
      }

      return flushed;
    } catch {
      // Cortex unavailable — return empty; caller merges with buffered events
      return [];
    }
  }

  /**
   * Reconstruct a single TraceEvent from Cortex triples, returning null if the
   * event does not belong to the requested session.
   */
  private async reconstructEventIfSession(
    subject: unknown,
    sessionKey: string,
    prefix: string,
  ): Promise<TraceEvent | null> {
    const subjectStr = String(subject);
    const eventId = subjectStr.slice(prefix.length);

    const triples = await this.client.listTriples({
      subject: subjectStr,
      limit: 20,
    });

    let session: string | undefined;
    let timestamp = "";
    let type = "";
    let agentId = "";
    const fields: Record<string, string> = {};

    for (const t of triples.triples) {
      const p = String(t.predicate);
      const o = String(t.object);
      if (p.endsWith(":session")) session = o;
      else if (p.endsWith(":timestamp")) timestamp = o;
      else if (p.endsWith(":type")) type = o;
      else if (p.endsWith(":agentId")) agentId = o;
      else {
        const fieldName = p.split(":").pop() ?? p;
        fields[fieldName] = o;
      }
    }

    if (session !== sessionKey) return null;

    return {
      id: eventId,
      type: type as TraceEvent["type"],
      agentId,
      timestamp,
      session,
      fields,
    };
  }

  /**
   * Delete-then-create pattern for updating a field.
   */
  private async updateField(subject: string, field: string, value: string): Promise<void> {
    const pred = sessionPredicate(this.ns, field);

    // Delete existing
    const existing = await this.client.listTriples({ subject, predicate: pred });
    for (const t of existing.triples) {
      if (t.id) await this.client.deleteTriple(t.id);
    }

    // Create new
    await this.client.createTriple({ subject, predicate: pred, object: value });
  }
}

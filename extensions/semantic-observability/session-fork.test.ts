/**
 * Tests for SessionForkManager.
 *
 * Mocks CortexClient and TraceEmitter to verify checkpoint, fork,
 * rewind, listForks, and getSessionInfo behaviors.
 */

import { describe, test, expect, vi, beforeEach } from "vitest";
import { SessionForkManager, type SessionCheckpoint } from "./session-fork.js";
import type { CortexClient } from "../shared/cortex-client.js";
import type { TraceEmitter, TraceEvent } from "./trace-emitter.js";

// ============================================================================
// Mock factories
// ============================================================================

function makeEvent(overrides?: Partial<TraceEvent>): TraceEvent {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    type: "tool_call",
    agentId: "agent-1",
    timestamp: "2026-01-15T10:00:00Z",
    session: "session-1",
    fields: { toolName: "test" },
    ...overrides,
  };
}

type Triple = {
  id: string;
  subject: string;
  predicate: string;
  object: string;
};

function makeMockClient(): CortexClient & { _triples: Triple[] } {
  const triples: Triple[] = [];
  let nextId = 1;

  return {
    _triples: triples,
    createTriple: vi.fn(async (t: { subject: string; predicate: string; object: unknown }) => {
      const id = `t-${nextId++}`;
      triples.push({
        id,
        subject: t.subject,
        predicate: t.predicate,
        object: String(t.object),
      });
      return { ok: true, id };
    }),
    deleteTriple: vi.fn(async (id: string) => {
      const idx = triples.findIndex((t) => t.id === id);
      if (idx >= 0) triples.splice(idx, 1);
      return { ok: true };
    }),
    listTriples: vi.fn(async (query: { subject?: string; predicate?: string; limit?: number }) => {
      let matches = [...triples];
      if (query.subject) matches = matches.filter((t) => t.subject === query.subject);
      if (query.predicate) matches = matches.filter((t) => t.predicate === query.predicate);
      if (query.limit) matches = matches.slice(0, query.limit);
      return { triples: matches };
    }),
    patternQuery: vi.fn(async (query: { predicate?: string; object?: string; limit?: number }) => {
      let matches = [...triples];
      if (query.predicate) matches = matches.filter((t) => t.predicate === query.predicate);
      if (query.object) matches = matches.filter((t) => t.object === query.object);
      if (query.limit) matches = matches.slice(0, query.limit);
      return {
        matches: matches.map((t) => ({
          subject: t.subject,
          predicate: t.predicate,
          object: t.object,
        })),
      };
    }),
  } as unknown as CortexClient & { _triples: Triple[] };
}

function makeMockEmitter(events: TraceEvent[] = []): TraceEmitter {
  const buffer = [...events];
  return {
    getBufferedEvents: vi.fn(() => [...buffer]),
    emitRaw: vi.fn((evt: TraceEvent) => buffer.push(evt)),
    getBufferedEventCount: vi.fn((session?: string) =>
      session ? buffer.filter((e) => e.session === session).length : buffer.length,
    ),
  } as unknown as TraceEmitter;
}

// ============================================================================
// Tests
// ============================================================================

describe("SessionForkManager", () => {
  const ns = "mayros";
  let client: CortexClient & { _triples: Triple[] };
  let emitter: ReturnType<typeof makeMockEmitter>;
  let mgr: SessionForkManager;

  beforeEach(() => {
    client = makeMockClient();
    emitter = makeMockEmitter();
    mgr = new SessionForkManager(client, emitter, ns);
  });

  // ---------- checkpoint ----------

  test("checkpoint creates correct triples", async () => {
    const events = [makeEvent({ session: "s1" }), makeEvent({ session: "s1" })];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    const cp = await mgr.checkpoint("s1");

    expect(cp.sessionKey).toBe("s1");
    expect(cp.eventCount).toBe(2);
    expect(cp.lastEventId).toBe(events[1].id);
    expect(cp.timestamp).toBeDefined();

    // Should have created status and checkpoint triples
    const statusTriple = client._triples.find((t) => t.predicate === "mayros:session:status");
    expect(statusTriple).toBeDefined();
    expect(statusTriple!.object).toBe("active");

    const cpTriple = client._triples.find((t) => t.predicate === "mayros:session:checkpoint");
    expect(cpTriple).toBeDefined();
    const parsed = JSON.parse(cpTriple!.object) as SessionCheckpoint;
    expect(parsed.eventCount).toBe(2);
  });

  test("checkpoint with no events for session", async () => {
    const cp = await mgr.checkpoint("empty-session");
    expect(cp.eventCount).toBe(0);
    expect(cp.lastEventId).toBeUndefined();
  });

  // ---------- fork ----------

  test("fork copies events to new session", async () => {
    const events = [
      makeEvent({ id: "e1", session: "s1", timestamp: "2026-01-15T10:00:00Z" }),
      makeEvent({ id: "e2", session: "s1", timestamp: "2026-01-15T10:01:00Z" }),
    ];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    const result = await mgr.fork("s1", "s1-fork");

    expect(result.originalSession).toBe("s1");
    expect(result.forkedSession).toBe("s1-fork");
    expect(result.eventsCopied).toBe(2);
    expect(result.forkedAt).toBeDefined();

    // emitRaw should have been called for each event
    expect(emitter.emitRaw).toHaveBeenCalledTimes(2);
  });

  test("fork generates new session key if not provided", async () => {
    const events = [makeEvent({ session: "s1" })];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    const result = await mgr.fork("s1");

    expect(result.forkedSession).toMatch(/^fork-/);
  });

  test("fork records parent session triple", async () => {
    emitter = makeMockEmitter([makeEvent({ session: "s1" })]);
    mgr = new SessionForkManager(client, emitter, ns);

    const result = await mgr.fork("s1", "s1-fork");

    const parentTriple = client._triples.find(
      (t) =>
        t.subject === "mayros:session:s1-fork" && t.predicate === "mayros:session:parentSession",
    );
    expect(parentTriple).toBeDefined();
    expect(parentTriple!.object).toBe("s1");

    // Source session should be marked as forked
    const sourceStatus = client._triples.find(
      (t) =>
        t.subject === "mayros:session:s1" &&
        t.predicate === "mayros:session:status" &&
        t.object === "forked",
    );
    expect(sourceStatus).toBeDefined();
  });

  test("fork of empty session returns 0 events", async () => {
    const result = await mgr.fork("empty", "empty-fork");
    expect(result.eventsCopied).toBe(0);
    expect(emitter.emitRaw).not.toHaveBeenCalled();
  });

  // ---------- rewind ----------

  test("rewind marks events after timestamp", async () => {
    const events = [
      makeEvent({ id: "e1", session: "s1", timestamp: "2026-01-15T10:00:00Z" }),
      makeEvent({ id: "e2", session: "s1", timestamp: "2026-01-15T11:00:00Z" }),
      makeEvent({ id: "e3", session: "s1", timestamp: "2026-01-15T12:00:00Z" }),
    ];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    const result = await mgr.rewind("s1", "2026-01-15T10:30:00Z");

    expect(result.eventsRemoved).toBe(2);
    expect(result.eventsRetained).toBe(1);
    expect(result.rewindPoint).toBe("2026-01-15T10:30:00Z");
  });

  test("rewind returns correct counts", async () => {
    const events = [
      makeEvent({ id: "e1", session: "s1", timestamp: "2026-01-15T10:00:00Z" }),
      makeEvent({ id: "e2", session: "s1", timestamp: "2026-01-15T11:00:00Z" }),
    ];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    const result = await mgr.rewind("s1", "2026-01-15T10:30:00Z");
    expect(result.eventsRemoved).toBe(1);
    expect(result.eventsRetained).toBe(1);
  });

  test("rewind with no events after timestamp removes 0", async () => {
    const events = [makeEvent({ id: "e1", session: "s1", timestamp: "2026-01-15T10:00:00Z" })];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    const result = await mgr.rewind("s1", "2026-01-15T23:59:59Z");
    expect(result.eventsRemoved).toBe(0);
    expect(result.eventsRetained).toBe(1);
  });

  test("rewind updates session status", async () => {
    emitter = makeMockEmitter([makeEvent({ session: "s1" })]);
    mgr = new SessionForkManager(client, emitter, ns);

    await mgr.rewind("s1", "2026-01-15T09:00:00Z");

    const statusTriple = client._triples.find(
      (t) =>
        t.subject === "mayros:session:s1" &&
        t.predicate === "mayros:session:status" &&
        t.object === "rewound",
    );
    expect(statusTriple).toBeDefined();
  });

  test("empty session rewind", async () => {
    const result = await mgr.rewind("empty", "2026-01-15T10:00:00Z");
    expect(result.eventsRemoved).toBe(0);
    expect(result.eventsRetained).toBe(0);
  });

  // ---------- listForks ----------

  test("listForks returns fork history", async () => {
    // Set up session triples
    await client.createTriple({
      subject: "mayros:session:s1",
      predicate: "mayros:session:status",
      object: "forked",
    });
    await client.createTriple({
      subject: "mayros:session:s1-fork",
      predicate: "mayros:session:status",
      object: "active",
    });
    await client.createTriple({
      subject: "mayros:session:s1-fork",
      predicate: "mayros:session:forkedFrom",
      object: "s1",
    });

    const forks = await mgr.listForks();
    expect(forks.length).toBeGreaterThanOrEqual(2);
  });

  test("listForks filters by session key", async () => {
    await client.createTriple({
      subject: "mayros:session:s1",
      predicate: "mayros:session:status",
      object: "active",
    });
    await client.createTriple({
      subject: "mayros:session:other",
      predicate: "mayros:session:status",
      object: "active",
    });

    const forks = await mgr.listForks("s1");
    expect(forks).toHaveLength(1);
    expect(forks[0].sessionKey).toBe("s1");
  });

  // ---------- getSessionInfo ----------

  test("getSessionInfo reconstructs entry from triples", async () => {
    await client.createTriple({
      subject: "mayros:session:s1",
      predicate: "mayros:session:status",
      object: "active",
    });
    await client.createTriple({
      subject: "mayros:session:s1",
      predicate: "mayros:session:parentSession",
      object: "parent-1",
    });
    await client.createTriple({
      subject: "mayros:session:s1",
      predicate: "mayros:session:forkedAt",
      object: "2026-01-15T10:00:00Z",
    });

    const info = await mgr.getSessionInfo("s1");
    expect(info).not.toBeNull();
    expect(info!.sessionKey).toBe("s1");
    expect(info!.status).toBe("active");
    expect(info!.parentSession).toBe("parent-1");
    expect(info!.forkedAt).toBe("2026-01-15T10:00:00Z");
  });

  test("getSessionInfo returns null for nonexistent session", async () => {
    const info = await mgr.getSessionInfo("nonexistent");
    expect(info).toBeNull();
  });

  test("getSessionInfo parses checkpoints", async () => {
    const cp: SessionCheckpoint = {
      sessionKey: "s1",
      timestamp: "2026-01-15T10:00:00Z",
      eventCount: 5,
      lastEventId: "e-5",
    };
    await client.createTriple({
      subject: "mayros:session:s1",
      predicate: "mayros:session:status",
      object: "active",
    });
    await client.createTriple({
      subject: "mayros:session:s1",
      predicate: "mayros:session:checkpoint",
      object: JSON.stringify(cp),
    });

    const info = await mgr.getSessionInfo("s1");
    expect(info!.checkpoints).toHaveLength(1);
    expect(info!.checkpoints[0].eventCount).toBe(5);
  });

  // ---------- fork of fork ----------

  test("fork of fork (nested)", async () => {
    const events = [makeEvent({ session: "s1" })];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    const first = await mgr.fork("s1", "s1-fork1");
    expect(first.eventsCopied).toBe(1);

    // The forked event is now in the emitter buffer under s1-fork1
    const secondEvents = emitter
      .getBufferedEvents()
      .filter((e: TraceEvent) => e.session === "s1-fork1");
    expect(secondEvents.length).toBeGreaterThanOrEqual(1);

    const second = await mgr.fork("s1-fork1", "s1-fork2");
    expect(second.originalSession).toBe("s1-fork1");
    expect(second.forkedSession).toBe("s1-fork2");
  });

  // ---------- checkpoint after rewind ----------

  test("checkpoint after rewind still works", async () => {
    const events = [makeEvent({ session: "s1", timestamp: "2026-01-15T10:00:00Z" })];
    emitter = makeMockEmitter(events);
    mgr = new SessionForkManager(client, emitter, ns);

    await mgr.rewind("s1", "2026-01-15T09:00:00Z");
    const cp = await mgr.checkpoint("s1");
    expect(cp.sessionKey).toBe("s1");
    expect(cp.eventCount).toBe(1);
  });
});

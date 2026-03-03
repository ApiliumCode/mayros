import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentMailbox,
  isValidMailMessageType,
  isValidMailStatus,
  type MailMessage,
} from "./agent-mailbox.js";

// ============================================================================
// Mock CortexClient
// ============================================================================

type Triple = {
  id: string;
  subject: string;
  predicate: string;
  object: unknown;
};

function createMockClient() {
  const store: Triple[] = [];
  let nextId = 1;

  return {
    store,
    createTriple: vi.fn(async (params: { subject: string; predicate: string; object: unknown }) => {
      const id = String(nextId++);
      store.push({ id, ...params });
      return { id };
    }),
    deleteTriple: vi.fn(async (id: string) => {
      const idx = store.findIndex((t) => t.id === id);
      if (idx >= 0) store.splice(idx, 1);
    }),
    listTriples: vi.fn(async (params: { subject?: string; predicate?: string; limit?: number }) => {
      const filtered = store.filter((t) => {
        if (params.subject && t.subject !== params.subject) return false;
        if (params.predicate && t.predicate !== params.predicate) return false;
        return true;
      });
      return { triples: filtered.slice(0, params.limit ?? 100) };
    }),
    patternQuery: vi.fn(
      async (params: { predicate?: string; object?: unknown; limit?: number }) => {
        const objValue =
          typeof params.object === "object" && params.object !== null && "node" in params.object
            ? (params.object as { node: string }).node
            : params.object;

        const filtered = store.filter((t) => {
          if (params.predicate && t.predicate !== params.predicate) return false;
          if (objValue !== undefined) {
            const tVal =
              typeof t.object === "object" && t.object !== null && "node" in t.object
                ? (t.object as { node: string }).node
                : t.object;
            if (String(tVal) !== String(objValue)) return false;
          }
          return true;
        });

        return {
          matches: filtered.slice(0, params.limit ?? 100).map((t) => ({
            subject: t.subject,
            predicate: t.predicate,
            object: t.object,
          })),
        };
      },
    ),
  };
}

// ============================================================================
// Tests
// ============================================================================

describe("AgentMailbox", () => {
  let client: ReturnType<typeof createMockClient>;
  let mailbox: AgentMailbox;
  const ns = "test";

  beforeEach(() => {
    client = createMockClient();
    mailbox = new AgentMailbox(
      client as unknown as Parameters<typeof AgentMailbox.prototype.send>[0] extends never
        ? never
        : ConstructorParameters<typeof AgentMailbox>[0],
      ns,
    );
  });

  // ---------- send ----------

  it("send creates correct triples", async () => {
    const msg = await mailbox.send({
      from: "agent-a",
      to: "agent-b",
      content: "Hello!",
      type: "question",
    });

    expect(msg.from).toBe("agent-a");
    expect(msg.to).toBe("agent-b");
    expect(msg.content).toBe("Hello!");
    expect(msg.type).toBe("question");
    expect(msg.status).toBe("unread");
    expect(msg.id).toBeTruthy();
    expect(msg.sentAt).toBeTruthy();

    // Verify 6 triples created (from, to, content, type, sentAt, status)
    expect(client.createTriple).toHaveBeenCalledTimes(6);
  });

  it("send creates replyTo triple when provided", async () => {
    const msg = await mailbox.send({
      from: "agent-a",
      to: "agent-b",
      content: "Reply",
      replyTo: "parent-msg",
    });

    expect(msg.replyTo).toBe("parent-msg");
    // 7 triples: from, to, content, type, sentAt, status, replyTo
    expect(client.createTriple).toHaveBeenCalledTimes(7);
  });

  it("send defaults type to task", async () => {
    const msg = await mailbox.send({
      from: "a",
      to: "b",
      content: "do it",
    });

    expect(msg.type).toBe("task");
  });

  // ---------- inbox ----------

  it("inbox returns messages for agent", async () => {
    await mailbox.send({ from: "a1", to: "a2", content: "msg1" });
    await mailbox.send({ from: "a1", to: "a2", content: "msg2" });
    await mailbox.send({ from: "a1", to: "a3", content: "msg3" });

    const inbox = await mailbox.inbox({ agent: "a2" });
    expect(inbox.length).toBe(2);
    expect(inbox.every((m) => m.to === "a2")).toBe(true);
  });

  it("inbox filters by status", async () => {
    const msg = await mailbox.send({ from: "a1", to: "a2", content: "hello" });
    await mailbox.send({ from: "a1", to: "a2", content: "world" });

    await mailbox.markRead("a2", msg.id);

    const unread = await mailbox.inbox({ agent: "a2", status: "unread" });
    expect(unread.length).toBe(1);
    expect(unread[0].content).toBe("world");

    const read = await mailbox.inbox({ agent: "a2", status: "read" });
    expect(read.length).toBe(1);
    expect(read[0].content).toBe("hello");
  });

  it("inbox filters by type", async () => {
    await mailbox.send({ from: "a1", to: "a2", content: "q1", type: "question" });
    await mailbox.send({ from: "a1", to: "a2", content: "t1", type: "task" });

    const questions = await mailbox.inbox({ agent: "a2", type: "question" });
    expect(questions.length).toBe(1);
    expect(questions[0].type).toBe("question");
  });

  it("inbox filters by sender", async () => {
    await mailbox.send({ from: "a1", to: "a3", content: "from a1" });
    await mailbox.send({ from: "a2", to: "a3", content: "from a2" });

    const fromA1 = await mailbox.inbox({ agent: "a3", from: "a1" });
    expect(fromA1.length).toBe(1);
    expect(fromA1[0].from).toBe("a1");
  });

  it("inbox respects limit", async () => {
    await mailbox.send({ from: "a1", to: "a2", content: "m1" });
    await mailbox.send({ from: "a1", to: "a2", content: "m2" });
    await mailbox.send({ from: "a1", to: "a2", content: "m3" });

    const limited = await mailbox.inbox({ agent: "a2", limit: 2 });
    expect(limited.length).toBe(2);
  });

  it("inbox returns empty array when no agent specified", async () => {
    const result = await mailbox.inbox({});
    expect(result).toEqual([]);
  });

  it("inbox returns empty array for agent with no messages", async () => {
    const result = await mailbox.inbox({ agent: "nobody" });
    expect(result).toEqual([]);
  });

  // ---------- outbox ----------

  it("outbox returns sent messages", async () => {
    await mailbox.send({ from: "sender", to: "r1", content: "out1" });
    await mailbox.send({ from: "sender", to: "r2", content: "out2" });
    await mailbox.send({ from: "other", to: "r1", content: "other-msg" });

    const outbox = await mailbox.outbox("sender");
    expect(outbox.length).toBe(2);
    expect(outbox.every((m) => m.from === "sender")).toBe(true);
  });

  // ---------- markRead ----------

  it("markRead updates status and readAt", async () => {
    const msg = await mailbox.send({ from: "a1", to: "a2", content: "read me" });
    const ok = await mailbox.markRead("a2", msg.id);
    expect(ok).toBe(true);

    const updated = await mailbox.getMessage("a2", msg.id);
    expect(updated?.status).toBe("read");
    expect(updated?.readAt).toBeTruthy();
  });

  it("markRead returns false for nonexistent message", async () => {
    const ok = await mailbox.markRead("nobody", "fake-id");
    expect(ok).toBe(false);
  });

  // ---------- markArchived ----------

  it("markArchived updates status", async () => {
    const msg = await mailbox.send({ from: "a1", to: "a2", content: "archive me" });
    const ok = await mailbox.markArchived("a2", msg.id);
    expect(ok).toBe(true);

    const updated = await mailbox.getMessage("a2", msg.id);
    expect(updated?.status).toBe("archived");
  });

  it("markArchived returns false for nonexistent message", async () => {
    const ok = await mailbox.markArchived("nobody", "fake-id");
    expect(ok).toBe(false);
  });

  // ---------- getMessage ----------

  it("getMessage reconstructs message from triples", async () => {
    const sent = await mailbox.send({
      from: "a1",
      to: "a2",
      content: "reconstruct me",
      type: "finding",
    });

    const msg = await mailbox.getMessage("a2", sent.id);
    expect(msg).not.toBeNull();
    expect(msg!.from).toBe("a1");
    expect(msg!.to).toBe("a2");
    expect(msg!.content).toBe("reconstruct me");
    expect(msg!.type).toBe("finding");
    expect(msg!.status).toBe("unread");
  });

  it("getMessage returns null for nonexistent message", async () => {
    const msg = await mailbox.getMessage("nobody", "no-such-id");
    expect(msg).toBeNull();
  });

  // ---------- stats ----------

  it("stats returns correct counts", async () => {
    await mailbox.send({ from: "a1", to: "a2", content: "m1", type: "task" });
    const m2 = await mailbox.send({ from: "a1", to: "a2", content: "m2", type: "question" });
    await mailbox.send({ from: "a1", to: "a2", content: "m3", type: "task" });

    await mailbox.markRead("a2", m2.id);

    const s = await mailbox.stats("a2");
    expect(s.total).toBe(3);
    expect(s.unread).toBe(2);
    expect(s.read).toBe(1);
    expect(s.archived).toBe(0);
    expect(s.byType.task).toBe(2);
    expect(s.byType.question).toBe(1);
  });

  it("stats returns zeros for agent with no messages", async () => {
    const s = await mailbox.stats("empty-agent");
    expect(s.total).toBe(0);
    expect(s.unread).toBe(0);
    expect(s.byType).toEqual({});
  });

  // ---------- threading ----------

  it("preserves replyTo for threaded messages", async () => {
    const parent = await mailbox.send({ from: "a1", to: "a2", content: "original" });
    const reply = await mailbox.send({
      from: "a2",
      to: "a1",
      content: "reply",
      replyTo: parent.id,
    });

    const msg = await mailbox.getMessage("a1", reply.id);
    expect(msg?.replyTo).toBe(parent.id);
  });
});

// ============================================================================
// Validator tests
// ============================================================================

describe("isValidMailMessageType", () => {
  it("accepts valid types", () => {
    expect(isValidMailMessageType("task")).toBe(true);
    expect(isValidMailMessageType("finding")).toBe(true);
    expect(isValidMailMessageType("question")).toBe(true);
    expect(isValidMailMessageType("status")).toBe(true);
    expect(isValidMailMessageType("knowledge-share")).toBe(true);
    expect(isValidMailMessageType("delegation-context")).toBe(true);
  });

  it("rejects invalid types", () => {
    expect(isValidMailMessageType("invalid")).toBe(false);
    expect(isValidMailMessageType("")).toBe(false);
  });
});

describe("isValidMailStatus", () => {
  it("accepts valid statuses", () => {
    expect(isValidMailStatus("unread")).toBe(true);
    expect(isValidMailStatus("read")).toBe(true);
    expect(isValidMailStatus("archived")).toBe(true);
  });

  it("rejects invalid statuses", () => {
    expect(isValidMailStatus("deleted")).toBe(false);
    expect(isValidMailStatus("")).toBe(false);
  });
});

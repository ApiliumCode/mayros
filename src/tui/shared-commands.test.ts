import { describe, expect, it, vi } from "vitest";
import { handleSharedCommand } from "./shared-commands.js";
import type { GatewayChatClient } from "./gateway-chat.js";

/**
 * Unit tests for the shared slash-command core.
 *
 * The shared handler lets the accessible TUI reach parity with the graphical
 * TUI for commands that do not require a visual picker. These tests pin the
 * contract: each recognized command calls the right gateway method and
 * reports through the injected sink, while unrecognized commands fall through.
 */

function makeClientStub(overrides: Partial<GatewayChatClient> = {}): GatewayChatClient {
  const base = {
    abortChat: vi.fn().mockResolvedValue({ ok: true, aborted: true }),
    resetSession: vi.fn().mockResolvedValue({ ok: true }),
    compactSession: vi.fn().mockResolvedValue({ ok: true, compacted: true }),
    getStatus: vi.fn().mockResolvedValue({ version: "1.2.3", sessions: 2 }),
    listSessions: vi.fn().mockResolvedValue({
      sessions: [{ key: "main", title: "Main" }],
    }),
    listModels: vi
      .fn()
      .mockResolvedValue([{ id: "anthropic/claude", name: "Claude", provider: "anthropic" }]),
  };
  return { ...base, ...overrides } as unknown as GatewayChatClient;
}

function makeSink() {
  const messages: { kind: "info" | "error"; text: string }[] = [];
  return {
    sink: {
      info: (text: string) => messages.push({ kind: "info", text }),
      error: (text: string) => messages.push({ kind: "error", text }),
    },
    messages,
  };
}

describe("handleSharedCommand", () => {
  it("aborts the active run when one exists", async () => {
    const client = makeClientStub();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand(
      { client, sessionKey: "main", getActiveRunId: () => "run-1" },
      "abort",
      "",
      sink,
    );
    expect(result.handled).toBe(true);
    expect(client.abortChat).toHaveBeenCalledWith({ sessionKey: "main", runId: "run-1" });
    expect(messages).toContainEqual({ kind: "info", text: "aborted" });
  });

  it("reports no active run when getActiveRunId returns null", async () => {
    const client = makeClientStub();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand(
      { client, sessionKey: "main", getActiveRunId: () => null },
      "abort",
      "",
      sink,
    );
    expect(result.handled).toBe(true);
    expect(client.abortChat).not.toHaveBeenCalled();
    expect(messages[0]?.text).toBe("no active run");
  });

  it("resets the session on /new", async () => {
    const client = makeClientStub();
    const onSessionChanged = vi.fn();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand(
      { client, sessionKey: "main", onSessionChanged },
      "new",
      "",
      sink,
    );
    expect(result.handled).toBe(true);
    expect(client.resetSession).toHaveBeenCalledWith("main", "new");
    expect(messages[0]?.text).toBe("session reset");
    expect(onSessionChanged).toHaveBeenCalledWith("main");
  });

  it("compacts the session context", async () => {
    const client = makeClientStub();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand({ client, sessionKey: "main" }, "compact", "", sink);
    expect(result.handled).toBe(true);
    expect(client.compactSession).toHaveBeenCalledWith({ key: "main" });
    expect(messages[0]?.text).toBe("context compacted");
  });

  it("switches session when given an argument", async () => {
    const client = makeClientStub();
    const onSessionChanged = vi.fn();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand(
      { client, sessionKey: "main", onSessionChanged },
      "session",
      "work",
      sink,
    );
    expect(result.handled).toBe(true);
    expect(onSessionChanged).toHaveBeenCalledWith("work");
    expect(messages[0]?.text).toContain("work");
  });

  it("lists sessions when called without an argument", async () => {
    const client = makeClientStub();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand({ client, sessionKey: "main" }, "sessions", "", sink);
    expect(result.handled).toBe(true);
    expect(client.listSessions).toHaveBeenCalled();
    expect(messages[0]?.text).toContain("main");
  });

  it("lists available models", async () => {
    const client = makeClientStub();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand({ client, sessionKey: "main" }, "model", "", sink);
    expect(result.handled).toBe(true);
    expect(client.listModels).toHaveBeenCalled();
    expect(messages[0]?.text).toContain("anthropic/claude");
  });

  it("returns help text on /help", async () => {
    const client = makeClientStub();
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand({ client, sessionKey: "main" }, "help", "", sink);
    expect(result.handled).toBe(true);
    expect(messages[0]?.text).toContain("/abort");
    expect(messages[0]?.text).toContain("/compact");
  });

  it("reports errors through the sink when a gateway call fails", async () => {
    const client = makeClientStub({
      getStatus: vi.fn().mockRejectedValue(new Error("gateway down")),
    });
    const { sink, messages } = makeSink();
    const result = await handleSharedCommand({ client, sessionKey: "main" }, "status", "", sink);
    expect(result.handled).toBe(true);
    expect(messages[0]?.kind).toBe("error");
    expect(messages[0]?.text).toContain("status failed");
  });

  it("falls through (handled: false) for unknown commands", async () => {
    const client = makeClientStub();
    const { sink } = makeSink();
    const result = await handleSharedCommand(
      { client, sessionKey: "main" },
      "totally-unknown-command",
      "",
      sink,
    );
    expect(result.handled).toBe(false);
  });
});

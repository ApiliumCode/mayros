import { describe, it, expect, vi } from "vitest";
import { SessionManager, formatSessionList, formatSessionLine } from "./session-manager.js";

describe("SessionManager", () => {
  function createMockClient() {
    return {
      listSessions: vi.fn().mockResolvedValue({
        ts: Date.now(),
        path: "/sessions",
        count: 2,
        sessions: [
          {
            key: "s-abc",
            derivedTitle: "Fix login bug",
            updatedAt: Date.now() - 60000,
            lastMessagePreview: "I fixed the authentication issue",
            model: "gpt-4",
          },
          {
            key: "s-def",
            displayName: "Refactor CLI",
            updatedAt: Date.now() - 3600000,
            lastMessagePreview: "The CLI module has been restructured",
          },
        ],
      }),
      patchSession: vi.fn().mockResolvedValue({}),
      resetSession: vi.fn().mockResolvedValue({}),
    };
  }

  it("lists sessions with formatted summaries", async () => {
    const client = createMockClient();
    const mgr = new SessionManager({ client: client as never, currentAgentId: "default" });
    const sessions = await mgr.listSessions();
    expect(sessions).toHaveLength(2);
    expect(sessions[0].title).toBe("Fix login bug");
    expect(sessions[0].key).toBe("s-abc");
    expect(sessions[0].preview).toContain("authentication");
    expect(sessions[1].title).toBe("Refactor CLI");
  });

  it("passes limit and agentId to client", async () => {
    const client = createMockClient();
    const mgr = new SessionManager({ client: client as never, currentAgentId: "agent-1" });
    await mgr.listSessions({ limit: 10, agentId: "agent-2" });
    expect(client.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 10, agentId: "agent-2" }),
    );
  });

  it("defaults to 20 sessions and current agent", async () => {
    const client = createMockClient();
    const mgr = new SessionManager({ client: client as never, currentAgentId: "my-agent" });
    await mgr.listSessions();
    expect(client.listSessions).toHaveBeenCalledWith(
      expect.objectContaining({ limit: 20, agentId: "my-agent" }),
    );
  });

  it("renames a session", async () => {
    const client = createMockClient();
    const mgr = new SessionManager({ client: client as never, currentAgentId: "default" });
    await mgr.renameSession("s-abc", "New Name");
    expect(client.patchSession).toHaveBeenCalledWith({ key: "s-abc", displayName: "New Name" });
  });

  it("deletes a session via reset", async () => {
    const client = createMockClient();
    const mgr = new SessionManager({ client: client as never, currentAgentId: "default" });
    await mgr.deleteSession("s-abc");
    expect(client.resetSession).toHaveBeenCalledWith("s-abc", "reset");
  });

  it("handles empty session list", async () => {
    const client = {
      ...createMockClient(),
      listSessions: vi.fn().mockResolvedValue({
        ts: Date.now(),
        path: "/sessions",
        count: 0,
        sessions: [],
      }),
    };
    const mgr = new SessionManager({ client: client as never, currentAgentId: "default" });
    const sessions = await mgr.listSessions();
    expect(sessions).toEqual([]);
  });

  it("handles sessions without derived title", async () => {
    const client = {
      ...createMockClient(),
      listSessions: vi.fn().mockResolvedValue({
        ts: Date.now(),
        path: "/sessions",
        count: 1,
        sessions: [{ key: "s-xyz", updatedAt: null, lastMessagePreview: null }],
      }),
    };
    const mgr = new SessionManager({ client: client as never, currentAgentId: "default" });
    const sessions = await mgr.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0].title).toBe("s-xyz");
    expect(sessions[0].preview).toBe("");
  });

  it("truncates long previews", async () => {
    const longPreview = "A".repeat(200);
    const client = {
      ...createMockClient(),
      listSessions: vi.fn().mockResolvedValue({
        ts: Date.now(),
        path: "/sessions",
        count: 1,
        sessions: [{ key: "s-long", lastMessagePreview: longPreview, updatedAt: Date.now() }],
      }),
    };
    const mgr = new SessionManager({ client: client as never, currentAgentId: "default" });
    const sessions = await mgr.listSessions();
    expect(sessions[0].preview.length).toBeLessThanOrEqual(80);
  });
});

describe("formatSessionList", () => {
  it("formats sessions from gateway response", () => {
    const result = formatSessionList({
      ts: Date.now(),
      path: "/",
      count: 1,
      sessions: [
        {
          key: "test-key",
          derivedTitle: "Test Session",
          updatedAt: Date.now(),
          lastMessagePreview: "Hello world",
        },
      ],
    });
    expect(result).toHaveLength(1);
    expect(result[0].key).toBe("test-key");
    expect(result[0].title).toBe("Test Session");
  });
});

describe("formatSessionLine", () => {
  it("formats a session with all fields", () => {
    const line = formatSessionLine(
      {
        key: "s-abc",
        title: "My Session",
        updatedAt: "2m ago",
        preview: "Last message preview",
      },
      (k) => k.slice(0, 8),
    );
    expect(line).toContain("My Session");
    expect(line).toContain("s-abc");
    expect(line).toContain("2m ago");
    expect(line).toContain("Last message preview");
  });

  it("omits title when same as key", () => {
    const line = formatSessionLine(
      { key: "s-abc", title: "s-abc", updatedAt: "", preview: "" },
      (k) => k,
    );
    expect(line).toBe("[s-abc]");
  });

  it("omits time and preview when empty", () => {
    const line = formatSessionLine(
      { key: "k", title: "Title", updatedAt: "", preview: "" },
      (k) => k,
    );
    expect(line).toBe("Title [k]");
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";

/* ------------------------------------------------------------------ */
/*  Mock vscode module                                                 */
/* ------------------------------------------------------------------ */

const mockEventEmitter = {
  event: vi.fn(),
  fire: vi.fn(),
  dispose: vi.fn(),
};

vi.mock("vscode", () => ({
  EventEmitter: vi.fn(() => mockEventEmitter),
  TreeItem: class MockTreeItem {
    label: string;
    collapsibleState: number;
    contextValue?: string;
    iconPath?: unknown;
    tooltip?: string;
    description?: string;
    command?: unknown;
    constructor(label: string, collapsibleState: number) {
      this.label = label;
      this.collapsibleState = collapsibleState;
    }
  },
  TreeItemCollapsibleState: { None: 0, Collapsed: 1, Expanded: 2 },
  ThemeIcon: class MockThemeIcon {
    id: string;
    constructor(id: string) {
      this.id = id;
    }
  },
}));

import { SessionsTreeProvider } from "../src/views/sessions-tree.js";
import type { SessionInfo } from "../src/types.js";

/* ------------------------------------------------------------------ */
/*  Mock client                                                        */
/* ------------------------------------------------------------------ */

function createMockClient(
  overrides: {
    connected?: boolean;
    sessions?: SessionInfo[];
    error?: boolean;
  } = {},
) {
  return {
    connected: overrides.connected ?? true,
    listSessions: overrides.error
      ? vi.fn().mockRejectedValue(new Error("Network error"))
      : vi.fn().mockResolvedValue(overrides.sessions ?? []),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as import("../src/mayros-client.js").MayrosClient;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("SessionsTreeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Not connected' when client is disconnected", async () => {
    const client = createMockClient({ connected: false });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("Not connected");
    expect(children[0].contextValue).toBe("disconnected");
  });

  it("shows 'No sessions' when connected but empty", async () => {
    const client = createMockClient({ connected: true, sessions: [] });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("No sessions");
    expect(children[0].contextValue).toBe("empty");
  });

  it("renders sessions with agent id and message count", async () => {
    const sessions: SessionInfo[] = [
      {
        id: "s1",
        status: "active",
        agentId: "default",
        startedAt: "2025-01-01T00:00:00Z",
        messageCount: 5,
      },
      {
        id: "s2",
        status: "idle",
        agentId: "reviewer",
        startedAt: "2025-01-01T01:00:00Z",
        messageCount: 1,
      },
    ];
    const client = createMockClient({ sessions });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children).toHaveLength(2);
    expect(children[0].label).toBe("default (5 msgs)");
    expect(children[1].label).toBe("reviewer (1 msg)");
  });

  it("uses correct icon for active status", async () => {
    const sessions: SessionInfo[] = [
      { id: "s1", status: "active", agentId: "a", startedAt: "2025-01-01", messageCount: 0 },
    ];
    const client = createMockClient({ sessions });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect((children[0].iconPath as { id: string }).id).toBe("debug-start");
  });

  it("uses correct icon for idle status", async () => {
    const sessions: SessionInfo[] = [
      { id: "s1", status: "idle", agentId: "a", startedAt: "2025-01-01", messageCount: 0 },
    ];
    const client = createMockClient({ sessions });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect((children[0].iconPath as { id: string }).id).toBe("debug-pause");
  });

  it("uses correct icon for ended status", async () => {
    const sessions: SessionInfo[] = [
      { id: "s1", status: "ended", agentId: "a", startedAt: "2025-01-01", messageCount: 0 },
    ];
    const client = createMockClient({ sessions });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect((children[0].iconPath as { id: string }).id).toBe("debug-stop");
  });

  it("shows error message when listSessions fails", async () => {
    const client = createMockClient({ error: true });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("Error loading sessions");
    expect(children[0].contextValue).toBe("error");
  });

  it("returns empty array for nested children", async () => {
    const client = createMockClient();
    const provider = new SessionsTreeProvider(client);

    const fakeItem = { label: "test", contextValue: "active" };
    const children = await provider.getChildren(fakeItem as never);
    expect(children).toEqual([]);
  });

  it("fires onDidChangeTreeData on refresh()", () => {
    const client = createMockClient();
    const provider = new SessionsTreeProvider(client);

    provider.refresh();
    expect(mockEventEmitter.fire).toHaveBeenCalledWith(undefined);
  });

  it("setClient updates client and triggers refresh", () => {
    const client1 = createMockClient();
    const client2 = createMockClient();
    const provider = new SessionsTreeProvider(client1);

    provider.setClient(client2);
    expect(mockEventEmitter.fire).toHaveBeenCalledWith(undefined);
  });

  it("sets tooltip with session details", async () => {
    const sessions: SessionInfo[] = [
      {
        id: "s1",
        status: "active",
        agentId: "default",
        startedAt: "2025-01-01T00:00:00Z",
        messageCount: 3,
      },
    ];
    const client = createMockClient({ sessions });
    const provider = new SessionsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children[0].tooltip).toContain("Session: s1");
    expect(children[0].tooltip).toContain("Agent: default");
    expect(children[0].tooltip).toContain("Status: active");
    expect(children[0].tooltip).toContain("Messages: 3");
  });
});

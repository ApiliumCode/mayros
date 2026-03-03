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

import { AgentsTreeProvider } from "../src/views/agents-tree.js";
import type { AgentInfo } from "../src/types.js";

/* ------------------------------------------------------------------ */
/*  Mock client                                                        */
/* ------------------------------------------------------------------ */

function createMockClient(
  overrides: {
    connected?: boolean;
    agents?: AgentInfo[];
    error?: boolean;
  } = {},
) {
  return {
    connected: overrides.connected ?? true,
    listAgents: overrides.error
      ? vi.fn().mockRejectedValue(new Error("Network error"))
      : vi.fn().mockResolvedValue(overrides.agents ?? []),
    on: vi.fn(),
    off: vi.fn(),
  } as unknown as import("../src/mayros-client.js").MayrosClient;
}

/* ------------------------------------------------------------------ */
/*  Tests                                                              */
/* ------------------------------------------------------------------ */

describe("AgentsTreeProvider", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows 'Not connected' when client is disconnected", async () => {
    const client = createMockClient({ connected: false });
    const provider = new AgentsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("Not connected");
    expect(children[0].contextValue).toBe("disconnected");
  });

  it("shows 'No agents configured' when empty", async () => {
    const client = createMockClient({ agents: [] });
    const provider = new AgentsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children).toHaveLength(1);
    expect(children[0].label).toBe("No agents configured");
  });

  it("renders agents with name and default marker", async () => {
    const agents: AgentInfo[] = [
      { id: "default", name: "Default Agent", description: "The default agent", isDefault: true },
      { id: "reviewer", name: "Code Reviewer", description: "Reviews code", isDefault: false },
    ];
    const client = createMockClient({ agents });
    const provider = new AgentsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children).toHaveLength(2);
    expect(children[0].label).toBe("Default Agent *");
    expect(children[1].label).toBe("Code Reviewer");
  });

  it("highlights default agent with 'account' icon", async () => {
    const agents: AgentInfo[] = [
      { id: "default", name: "Default", description: "", isDefault: true },
    ];
    const client = createMockClient({ agents });
    const provider = new AgentsTreeProvider(client);

    const children = await provider.getChildren();
    expect((children[0].iconPath as { id: string }).id).toBe("account");
  });

  it("uses 'person' icon for non-default agents", async () => {
    const agents: AgentInfo[] = [
      { id: "helper", name: "Helper", description: "", isDefault: false },
    ];
    const client = createMockClient({ agents });
    const provider = new AgentsTreeProvider(client);

    const children = await provider.getChildren();
    expect((children[0].iconPath as { id: string }).id).toBe("person");
  });

  it("sets description to 'default' for default agent", async () => {
    const agents: AgentInfo[] = [
      { id: "default", name: "Default", description: "", isDefault: true },
    ];
    const client = createMockClient({ agents });
    const provider = new AgentsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children[0].description).toBe("default");
  });

  it("shows error on listAgents failure", async () => {
    const client = createMockClient({ error: true });
    const provider = new AgentsTreeProvider(client);

    const children = await provider.getChildren();
    expect(children[0].label).toBe("Error loading agents");
  });

  it("fires onDidChangeTreeData on refresh()", () => {
    const client = createMockClient();
    const provider = new AgentsTreeProvider(client);

    provider.refresh();
    expect(mockEventEmitter.fire).toHaveBeenCalledWith(undefined);
  });
});

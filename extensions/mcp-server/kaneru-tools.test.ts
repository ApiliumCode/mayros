import { describe, it, expect, vi, beforeEach } from "vitest";
import { createKaneruTools } from "./kaneru-tools.js";

// ── Mock KaneruFacade ────────────────────────────────────────────────

const mockFacade = {
  squadCreate: vi.fn(),
  squadRun: vi.fn(),
  squadStatus: vi.fn(),
  delegate: vi.fn(),
  consensusResolve: vi.fn(),
  route: vi.fn(),
  fuse: vi.fn(),
  mailboxSend: vi.fn(),
  mailboxCheck: vi.fn(),
  mailboxStats: vi.fn(),
  destroy: vi.fn(),
};

vi.mock("../agent-mesh/kaneru-facade.js", () => {
  return {
    KaneruFacade: class MockKaneruFacade {
      constructor() {
        return mockFacade;
      }
    },
  };
});

describe("Kaneru MCP Tools", () => {
  const deps = {
    cortexBaseUrl: "http://127.0.0.1:19090",
    namespace: "test",
    authToken: "tok-123",
  };
  let tools: ReturnType<typeof createKaneruTools>;

  beforeEach(() => {
    vi.clearAllMocks();
    tools = createKaneruTools(deps);
  });

  function findTool(name: string) {
    const tool = tools.find((t) => t.name === name);
    if (!tool) throw new Error(`Tool ${name} not found`);
    return tool;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function text(result: any): string {
    return result.content[0]!.text;
  }

  // ── Structure tests ──────────────────────────────────────────────

  it("returns an array of 8 tools", () => {
    expect(tools).toHaveLength(8);
  });

  it("each tool has name, description, parameters, and execute", () => {
    for (const tool of tools) {
      expect(tool.name).toBeTypeOf("string");
      expect(tool.description).toBeTypeOf("string");
      expect(tool.parameters).toBeDefined();
      expect(tool.execute).toBeTypeOf("function");
    }
  });

  it("contains all expected tool names", () => {
    const names = tools.map((t) => t.name);
    expect(names).toEqual([
      "kaneru_squad_create",
      "kaneru_squad_run",
      "kaneru_squad_status",
      "kaneru_delegate",
      "kaneru_consensus",
      "kaneru_route",
      "kaneru_fuse",
      "kaneru_mailbox",
    ]);
  });

  it("destroy() method exists and calls facade.destroy()", () => {
    expect(tools.destroy).toBeTypeOf("function");
    // Trigger facade creation by calling any tool first
    mockFacade.squadStatus.mockResolvedValue(null);
    findTool("kaneru_squad_status").execute("id", { squad: "sq-1" });
    tools.destroy();
    expect(mockFacade.destroy).toHaveBeenCalled();
  });

  it("destroy() is a no-op when facade was never created", () => {
    // No tool called yet, facade not instantiated
    expect(() => tools.destroy()).not.toThrow();
  });

  // ── kaneru_squad_create ──────────────────────────────────────────

  describe("kaneru_squad_create", () => {
    it("creates a squad and formats output", async () => {
      mockFacade.squadCreate.mockResolvedValue({
        id: "sq-1",
        name: "alpha-team",
        members: [{ agentId: "agent-a" }, { agentId: "agent-b" }],
        strategy: "additive",
        status: "active",
      });

      const result = await findTool("kaneru_squad_create").execute("id", {
        name: "alpha-team",
        agents: "agent-a, agent-b",
        strategy: "additive",
      });

      expect(text(result)).toContain("Squad created:");
      expect(text(result)).toContain("ID: sq-1");
      expect(text(result)).toContain("Name: alpha-team");
      expect(text(result)).toContain("agent-a, agent-b");
      expect(text(result)).toContain("Strategy: additive");
      expect(text(result)).toContain("Status: active");

      expect(mockFacade.squadCreate).toHaveBeenCalledWith({
        name: "alpha-team",
        agents: [
          { agentId: "agent-a", role: "member" },
          { agentId: "agent-b", role: "member" },
        ],
        strategy: "additive",
      });
    });

    it("splits agents correctly and trims whitespace", async () => {
      mockFacade.squadCreate.mockResolvedValue({
        id: "sq-2",
        name: "t",
        members: [],
        strategy: "additive",
        status: "active",
      });

      await findTool("kaneru_squad_create").execute("id", {
        name: "t",
        agents: " x , y , ,z ",
      });

      const args = mockFacade.squadCreate.mock.calls[0]![0];
      expect(args.agents).toEqual([
        { agentId: "x", role: "member" },
        { agentId: "y", role: "member" },
        { agentId: "z", role: "member" },
      ]);
    });

    it("returns error text on failure", async () => {
      mockFacade.squadCreate.mockRejectedValue(new Error("create failed"));
      const result = await findTool("kaneru_squad_create").execute("id", {
        name: "t",
        agents: "a",
      });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("create failed");
    });
  });

  // ── kaneru_squad_run ─────────────────────────────────────────────

  describe("kaneru_squad_run", () => {
    it("starts a workflow and formats output", async () => {
      mockFacade.squadRun.mockResolvedValue({
        id: "wf-1",
        name: "deploy-pipeline",
        state: "running",
        createdAt: "2026-03-16T10:00:00Z",
      });

      const result = await findTool("kaneru_squad_run").execute("id", {
        squad: "sq-1",
        mission: "deploy-pipeline",
      });

      expect(text(result)).toContain("Workflow started:");
      expect(text(result)).toContain("Workflow ID: wf-1");
      expect(text(result)).toContain("Name: deploy-pipeline");
      expect(text(result)).toContain("State: running");
      expect(mockFacade.squadRun).toHaveBeenCalledWith("sq-1", "deploy-pipeline");
    });

    it("returns error text on failure", async () => {
      mockFacade.squadRun.mockRejectedValue(new Error("run failed"));
      const result = await findTool("kaneru_squad_run").execute("id", {
        squad: "sq-1",
        mission: "m",
      });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("run failed");
    });
  });

  // ── kaneru_squad_status ──────────────────────────────────────────

  describe("kaneru_squad_status", () => {
    it("returns squad details when found", async () => {
      mockFacade.squadStatus.mockResolvedValue({
        id: "sq-1",
        name: "alpha",
        status: "active",
        strategy: "additive",
        members: [
          { agentId: "agent-a", role: "leader" },
          { agentId: "agent-b", role: "member" },
        ],
      });

      const result = await findTool("kaneru_squad_status").execute("id", { squad: "sq-1" });

      expect(text(result)).toContain("Squad sq-1:");
      expect(text(result)).toContain("Name: alpha");
      expect(text(result)).toContain("Members (2):");
      expect(text(result)).toContain("agent-a (leader)");
      expect(text(result)).toContain("agent-b (member)");
    });

    it("returns not-found message when squad is null", async () => {
      mockFacade.squadStatus.mockResolvedValue(null);
      const result = await findTool("kaneru_squad_status").execute("id", { squad: "nope" });
      expect(text(result)).toContain("Squad not found: nope");
    });

    it("returns error text on failure", async () => {
      mockFacade.squadStatus.mockRejectedValue(new Error("status failed"));
      const result = await findTool("kaneru_squad_status").execute("id", { squad: "sq-1" });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("status failed");
    });
  });

  // ── kaneru_delegate ──────────────────────────────────────────────

  describe("kaneru_delegate", () => {
    it("delegates and formats output with context keys", async () => {
      mockFacade.delegate.mockResolvedValue({
        mission: "analyze data",
        sourceAgent: "agent-a",
        history: [],
      });

      const result = await findTool("kaneru_delegate").execute("id", {
        from: "agent-a",
        to: "agent-b",
        mission: "analyze data",
      });

      expect(text(result)).toContain("Delegation complete:");
      expect(text(result)).toContain("From: agent-a");
      expect(text(result)).toContain("To: agent-b");
      expect(text(result)).toContain("Mission: analyze data");
      expect(text(result)).toContain("Context keys: mission, sourceAgent, history");
      expect(mockFacade.delegate).toHaveBeenCalledWith("agent-a", "agent-b", "analyze data");
    });

    it("returns error text on failure", async () => {
      mockFacade.delegate.mockRejectedValue(new Error("delegate failed"));
      const result = await findTool("kaneru_delegate").execute("id", {
        from: "a",
        to: "b",
        mission: "m",
      });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("delegate failed");
    });
  });

  // ── kaneru_consensus ─────────────────────────────────────────────

  describe("kaneru_consensus", () => {
    it("resolves consensus and formats output", async () => {
      mockFacade.consensusResolve.mockResolvedValue({
        resolved: true,
        strategy: "weighted",
        resolutions: [{ subject: "q1", chosen: "approve" }],
      });

      const result = await findTool("kaneru_consensus").execute("id", {
        squad: "sq-1",
        question: "Should we deploy?",
        strategy: "weighted",
      });

      expect(text(result)).toContain("Consensus result:");
      expect(text(result)).toContain("Resolved: true");
      expect(text(result)).toContain("Strategy: weighted");
      expect(text(result)).toContain("approve");
      expect(mockFacade.consensusResolve).toHaveBeenCalledWith({
        squadId: "sq-1",
        question: "Should we deploy?",
        strategy: "weighted",
      });
    });

    it("uses default strategy when not provided", async () => {
      mockFacade.consensusResolve.mockResolvedValue({
        resolved: false,
        strategy: "weighted",
        resolutions: [],
      });

      await findTool("kaneru_consensus").execute("id", {
        squad: "sq-1",
        question: "q",
      });

      const args = mockFacade.consensusResolve.mock.calls[0]![0];
      expect(args.strategy).toBeUndefined();
    });

    it("returns error text on failure", async () => {
      mockFacade.consensusResolve.mockRejectedValue(new Error("consensus failed"));
      const result = await findTool("kaneru_consensus").execute("id", {
        squad: "sq-1",
        question: "q",
      });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("consensus failed");
    });
  });

  // ── kaneru_route ─────────────────────────────────────────────────

  describe("kaneru_route", () => {
    it("routes a mission and formats output", async () => {
      mockFacade.route.mockResolvedValue({
        agentId: "agent-x",
        confidence: 0.85,
        taskType: "code-review",
        complexity: "medium",
        domain: "backend",
        routingId: "rt-1",
      });

      const result = await findTool("kaneru_route").execute("id", {
        mission: "review the PR",
        agents: "agent-x, agent-y",
        path: "/src/main.ts",
      });

      expect(text(result)).toContain("Routing decision:");
      expect(text(result)).toContain("Agent: agent-x");
      expect(text(result)).toContain("Confidence: 85.0%");
      expect(text(result)).toContain("Task type: code-review");
      expect(text(result)).toContain("Complexity: medium");
      expect(text(result)).toContain("Domain: backend");
      expect(text(result)).toContain("Routing ID: rt-1");
      expect(mockFacade.route).toHaveBeenCalledWith(
        "review the PR",
        ["agent-x", "agent-y"],
        "/src/main.ts",
      );
    });

    it("passes undefined agents when not provided", async () => {
      mockFacade.route.mockResolvedValue({
        agentId: "agent-z",
        confidence: 0.5,
        taskType: "general",
        complexity: "low",
        domain: "general",
        routingId: "rt-2",
      });

      await findTool("kaneru_route").execute("id", {
        mission: "do something",
      });

      expect(mockFacade.route).toHaveBeenCalledWith("do something", undefined, undefined);
    });

    it("returns error text on failure", async () => {
      mockFacade.route.mockRejectedValue(new Error("route failed"));
      const result = await findTool("kaneru_route").execute("id", { mission: "m" });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("route failed");
    });
  });

  // ── kaneru_fuse ──────────────────────────────────────────────────

  describe("kaneru_fuse", () => {
    it("fuses namespaces and formats output", async () => {
      mockFacade.fuse.mockResolvedValue({
        sourceNs: "ns-a",
        targetNs: "ns-b",
        strategy: "additive",
        added: 15,
        skipped: 3,
        conflicts: 1,
      });

      const result = await findTool("kaneru_fuse").execute("id", {
        source: "ns-a",
        target: "ns-b",
        strategy: "additive",
      });

      expect(text(result)).toContain("Fusion complete:");
      expect(text(result)).toContain("Source: ns-a");
      expect(text(result)).toContain("Target: ns-b");
      expect(text(result)).toContain("Added: 15");
      expect(text(result)).toContain("Skipped: 3");
      expect(text(result)).toContain("Conflicts: 1");
      expect(mockFacade.fuse).toHaveBeenCalledWith("ns-a", "ns-b", "additive");
    });

    it("passes undefined strategy when not provided", async () => {
      mockFacade.fuse.mockResolvedValue({
        sourceNs: "a",
        targetNs: "b",
        strategy: "additive",
        added: 0,
        skipped: 0,
        conflicts: 0,
      });

      await findTool("kaneru_fuse").execute("id", {
        source: "a",
        target: "b",
      });

      expect(mockFacade.fuse).toHaveBeenCalledWith("a", "b", undefined);
    });

    it("returns error text on failure", async () => {
      mockFacade.fuse.mockRejectedValue(new Error("fuse failed"));
      const result = await findTool("kaneru_fuse").execute("id", {
        source: "a",
        target: "b",
      });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("fuse failed");
    });
  });

  // ── kaneru_mailbox ───────────────────────────────────────────────

  describe("kaneru_mailbox", () => {
    describe("send action", () => {
      it("sends a message and formats output", async () => {
        mockFacade.mailboxSend.mockResolvedValue({
          id: "msg-1",
          type: "task",
        });

        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "send",
          agent: "agent-a",
          to: "agent-b",
          content: "Please review this",
          type: "task",
        });

        expect(text(result)).toContain("Message sent:");
        expect(text(result)).toContain("ID: msg-1");
        expect(text(result)).toContain("From: agent-a");
        expect(text(result)).toContain("To: agent-b");
        expect(text(result)).toContain("Type: task");
        expect(mockFacade.mailboxSend).toHaveBeenCalledWith(
          "agent-a",
          "agent-b",
          "Please review this",
          "task",
        );
      });

      it("returns error when 'to' is missing", async () => {
        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "send",
          agent: "agent-a",
          content: "hello",
        });
        expect(text(result)).toContain("'to' and 'content' are required");
      });

      it("returns error when 'content' is missing", async () => {
        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "send",
          agent: "agent-a",
          to: "agent-b",
        });
        expect(text(result)).toContain("'to' and 'content' are required");
      });
    });

    describe("check action", () => {
      it("lists unread messages", async () => {
        mockFacade.mailboxCheck.mockResolvedValue([
          { id: "m1", from: "agent-x", type: "task", content: "Do the thing" },
          { id: "m2", from: "agent-y", type: "question", content: "How?" },
        ]);

        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "check",
          agent: "agent-a",
        });

        expect(text(result)).toContain("2 unread message(s)");
        expect(text(result)).toContain("[task] from agent-x: Do the thing");
        expect(text(result)).toContain("[question] from agent-y: How?");
      });

      it("reports no unread messages when empty", async () => {
        mockFacade.mailboxCheck.mockResolvedValue([]);
        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "check",
          agent: "agent-a",
        });
        expect(text(result)).toContain('No unread messages for agent "agent-a"');
      });

      it("reports no unread messages when null", async () => {
        mockFacade.mailboxCheck.mockResolvedValue(null);
        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "check",
          agent: "agent-a",
        });
        expect(text(result)).toContain("No unread messages");
      });

      it("truncates long message content at 120 chars", async () => {
        const longContent = "A".repeat(200);
        mockFacade.mailboxCheck.mockResolvedValue([
          { id: "m1", from: "agent-x", type: "info", content: longContent },
        ]);

        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "check",
          agent: "agent-a",
        });

        expect(text(result)).toContain("A".repeat(120) + "...");
      });
    });

    describe("stats action", () => {
      it("returns mailbox stats", async () => {
        mockFacade.mailboxStats.mockResolvedValue({
          total: 50,
          unread: 5,
          read: 40,
          archived: 5,
        });

        const result = await findTool("kaneru_mailbox").execute("id", {
          action: "stats",
          agent: "agent-a",
        });

        expect(text(result)).toContain('Mailbox stats for "agent-a":');
        expect(text(result)).toContain("Total: 50");
        expect(text(result)).toContain("Unread: 5");
        expect(text(result)).toContain("Read: 40");
        expect(text(result)).toContain("Archived: 5");
      });
    });

    it("returns unknown action message for invalid action", async () => {
      const result = await findTool("kaneru_mailbox").execute("id", {
        action: "invalid",
        agent: "agent-a",
      });
      expect(text(result)).toContain("Unknown mailbox action: invalid");
    });

    it("returns error text on failure", async () => {
      mockFacade.mailboxStats.mockRejectedValue(new Error("mailbox failed"));
      const result = await findTool("kaneru_mailbox").execute("id", {
        action: "stats",
        agent: "agent-a",
      });
      expect(text(result)).toContain("Error:");
      expect(text(result)).toContain("mailbox failed");
    });
  });

  // ── parseBaseUrl (tested indirectly via facade construction) ────

  describe("parseBaseUrl handling", () => {
    it("parses valid URL and creates facade without error", async () => {
      const customTools = createKaneruTools({
        cortexBaseUrl: "http://10.0.0.1:9999",
      });
      // Trigger facade creation by invoking a tool
      mockFacade.squadStatus.mockResolvedValue(null);
      const result = await customTools
        .find((t) => t.name === "kaneru_squad_status")!
        .execute("id", { squad: "x" });
      expect(text(result)).toContain("Squad not found");
      customTools.destroy();
    });

    it("falls back to defaults for invalid URL without throwing", async () => {
      const badTools = createKaneruTools({
        cortexBaseUrl: "not-a-url",
      });
      mockFacade.squadStatus.mockResolvedValue(null);
      const result = await badTools
        .find((t) => t.name === "kaneru_squad_status")!
        .execute("id", { squad: "x" });
      // Should still work — fallback to 127.0.0.1:19090
      expect(text(result)).toContain("Squad not found");
      badTools.destroy();
    });
  });
});

import { describe, expect, it, vi, beforeEach } from "vitest";
import { createCommandHandlers } from "./tui-command-handlers.js";
import { getSlashCommands, helpText } from "./commands.js";

describe("tui command handlers", () => {
  it("forwards unknown slash commands to the gateway", async () => {
    const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
    const addUser = vi.fn();
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const setActivityStatus = vi.fn();

    const { handleCommand } = createCommandHandlers({
      client: { sendChat } as never,
      chatLog: { addUser, addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory: vi.fn(),
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus,
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/unknowncmd");

    expect(addSystem).not.toHaveBeenCalled();
    expect(addUser).toHaveBeenCalledWith("/unknowncmd");
    expect(sendChat).toHaveBeenCalledWith(
      expect.objectContaining({
        sessionKey: "agent:main:main",
        message: "/unknowncmd",
      }),
    );
    expect(requestRender).toHaveBeenCalled();
  });

  it("passes reset reason when handling /new and /reset", async () => {
    const resetSession = vi.fn().mockResolvedValue({ ok: true });
    const addSystem = vi.fn();
    const requestRender = vi.fn();
    const loadHistory = vi.fn().mockResolvedValue(undefined);

    const { handleCommand } = createCommandHandlers({
      client: { resetSession } as never,
      chatLog: { addSystem } as never,
      tui: { requestRender } as never,
      opts: {},
      state: {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
      } as never,
      deliverDefault: false,
      openOverlay: vi.fn(),
      closeOverlay: vi.fn(),
      refreshSessionInfo: vi.fn(),
      loadHistory,
      setSession: vi.fn(),
      refreshAgents: vi.fn(),
      abortActive: vi.fn(),
      setActivityStatus: vi.fn(),
      formatSessionKey: vi.fn(),
      applySessionInfoFromPatch: vi.fn(),
      noteLocalRunId: vi.fn(),
    });

    await handleCommand("/new");
    await handleCommand("/reset");

    expect(resetSession).toHaveBeenNthCalledWith(1, "agent:main:main", "new");
    expect(resetSession).toHaveBeenNthCalledWith(2, "agent:main:main", "reset");
    expect(loadHistory).toHaveBeenCalledTimes(2);
  });

  describe("/permission command", () => {
    function setup(initialMode?: "auto" | "ask" | "deny") {
      const addSystem = vi.fn();
      const requestRender = vi.fn();
      const stateObj = {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: {},
        permissionMode: initialMode ?? "auto",
        outputStyle: undefined,
      };
      const { handleCommand } = createCommandHandlers({
        client: {} as never,
        chatLog: { addSystem, getLastAssistantText: () => "" } as never,
        tui: { requestRender } as never,
        opts: {},
        state: stateObj as never,
        deliverDefault: false,
        openOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        refreshSessionInfo: vi.fn(),
        loadHistory: vi.fn(),
        setSession: vi.fn(),
        refreshAgents: vi.fn(),
        abortActive: vi.fn(),
        setActivityStatus: vi.fn(),
        formatSessionKey: vi.fn(),
        applySessionInfoFromPatch: vi.fn(),
        noteLocalRunId: vi.fn(),
      });
      return { handleCommand, addSystem, stateObj };
    }

    it("cycles through modes when called without args", async () => {
      const { handleCommand, addSystem, stateObj } = setup("auto");
      await handleCommand("/permission");
      expect(stateObj.permissionMode).toBe("ask");
      expect(addSystem).toHaveBeenCalledWith("permission mode: ask");

      await handleCommand("/permission");
      expect(stateObj.permissionMode).toBe("deny");

      await handleCommand("/permission");
      expect(stateObj.permissionMode).toBe("auto");
    });

    it("sets mode directly with a valid argument", async () => {
      const { handleCommand, addSystem, stateObj } = setup("auto");
      await handleCommand("/permission deny");
      expect(stateObj.permissionMode).toBe("deny");
      expect(addSystem).toHaveBeenCalledWith("permission mode set to deny");
    });

    it("shows usage on invalid argument", async () => {
      const { handleCommand, addSystem, stateObj } = setup("auto");
      await handleCommand("/permission invalid");
      expect(stateObj.permissionMode).toBe("auto");
      expect(addSystem).toHaveBeenCalledWith("usage: /permission <auto|ask|deny>");
    });
  });

  describe("/fast command", () => {
    function setup() {
      const addSystem = vi.fn();
      const requestRender = vi.fn();
      const patchSession = vi.fn().mockResolvedValue({});
      const applySessionInfoFromPatch = vi.fn();
      const stateObj = {
        currentSessionKey: "agent:main:main",
        activeChatRunId: null,
        sessionInfo: { thinkingLevel: "medium" },
        fastMode: false,
        previousThinkingLevel: undefined as string | undefined,
        outputStyle: undefined as string | undefined,
      };
      const { handleCommand } = createCommandHandlers({
        client: { patchSession } as never,
        chatLog: { addSystem, getLastAssistantText: () => "" } as never,
        tui: { requestRender } as never,
        opts: {},
        state: stateObj as never,
        deliverDefault: false,
        openOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        refreshSessionInfo: vi.fn(),
        loadHistory: vi.fn(),
        setSession: vi.fn(),
        refreshAgents: vi.fn(),
        abortActive: vi.fn(),
        setActivityStatus: vi.fn(),
        formatSessionKey: vi.fn(),
        applySessionInfoFromPatch,
        noteLocalRunId: vi.fn(),
      });
      return { handleCommand, addSystem, stateObj, patchSession, applySessionInfoFromPatch };
    }

    it("enables fast mode and sets thinking to off", async () => {
      const { handleCommand, addSystem, stateObj, patchSession } = setup();
      await handleCommand("/fast");
      expect(stateObj.fastMode).toBe(true);
      expect(stateObj.previousThinkingLevel).toBe("medium");
      expect(stateObj.outputStyle).toBe("standard");
      expect(patchSession).toHaveBeenCalledWith(expect.objectContaining({ thinkingLevel: "off" }));
      expect(addSystem).toHaveBeenCalledWith("fast mode enabled (thinking: off, style: standard)");
    });

    it("disables fast mode and restores previous thinking level", async () => {
      const { handleCommand, addSystem, stateObj, patchSession } = setup();
      // Enable first
      await handleCommand("/fast");
      patchSession.mockClear();

      // Disable
      await handleCommand("/fast");
      expect(stateObj.fastMode).toBe(false);
      expect(patchSession).toHaveBeenCalledWith(
        expect.objectContaining({ thinkingLevel: "medium" }),
      );
      expect(addSystem).toHaveBeenCalledWith("fast mode disabled (thinking: medium)");
    });
  });

  describe("/copy command", () => {
    it("shows message when nothing to copy", async () => {
      const addSystem = vi.fn();
      const { handleCommand } = createCommandHandlers({
        client: {} as never,
        chatLog: { addSystem, getLastAssistantText: () => "" } as never,
        tui: { requestRender: vi.fn() } as never,
        opts: {},
        state: {
          currentSessionKey: "agent:main:main",
          activeChatRunId: null,
          sessionInfo: {},
        } as never,
        deliverDefault: false,
        openOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        refreshSessionInfo: vi.fn(),
        loadHistory: vi.fn(),
        setSession: vi.fn(),
        refreshAgents: vi.fn(),
        abortActive: vi.fn(),
        setActivityStatus: vi.fn(),
        formatSessionKey: vi.fn(),
        applySessionInfoFromPatch: vi.fn(),
        noteLocalRunId: vi.fn(),
      });

      await handleCommand("/copy");
      expect(addSystem).toHaveBeenCalledWith("nothing to copy");
    });
  });

  describe("/export command", () => {
    it("shows message when nothing to export", async () => {
      const addSystem = vi.fn();
      const { handleCommand } = createCommandHandlers({
        client: {} as never,
        chatLog: { addSystem, getLastAssistantText: () => "" } as never,
        tui: { requestRender: vi.fn() } as never,
        opts: {},
        state: {
          currentSessionKey: "agent:main:main",
          activeChatRunId: null,
          sessionInfo: {},
        } as never,
        deliverDefault: false,
        openOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        refreshSessionInfo: vi.fn(),
        loadHistory: vi.fn(),
        setSession: vi.fn(),
        refreshAgents: vi.fn(),
        abortActive: vi.fn(),
        setActivityStatus: vi.fn(),
        formatSessionKey: vi.fn(),
        applySessionInfoFromPatch: vi.fn(),
        noteLocalRunId: vi.fn(),
      });

      await handleCommand("/export");
      expect(addSystem).toHaveBeenCalledWith("nothing to export");
    });
  });

  describe("ecosystem slash commands", () => {
    const ECOSYSTEM_COMMANDS = [
      "plan",
      "kg",
      "trace",
      "team",
      "tasks",
      "workflow",
      "rules",
      "mailbox",
      "onboard",
    ];

    it("registers all ecosystem commands in getSlashCommands()", () => {
      const commands = getSlashCommands();
      const names = commands.map((c) => c.name);
      for (const cmd of ECOSYSTEM_COMMANDS) {
        expect(names).toContain(cmd);
      }
    });

    it("includes ecosystem section in helpText()", () => {
      const text = helpText();
      expect(text).toContain("Mayros ecosystem:");
      expect(text).toContain("/plan [start|show|list]");
      expect(text).toContain("/kg <query>");
      expect(text).toContain("/trace [events|stats]");
      expect(text).toContain("/team");
      expect(text).toContain("/tasks");
      expect(text).toContain("/workflow [run|list] [name]");
      expect(text).toContain("/rules [list|add]");
      expect(text).toContain("/mailbox [list|send]");
      expect(text).toContain("/onboard");
    });

    function setupEcosystem() {
      const sendChat = vi.fn().mockResolvedValue({ runId: "r1" });
      const addUser = vi.fn();
      const addSystem = vi.fn();
      const requestRender = vi.fn();
      const setActivityStatus = vi.fn();

      const { handleCommand } = createCommandHandlers({
        client: { sendChat } as never,
        chatLog: { addUser, addSystem } as never,
        tui: { requestRender } as never,
        opts: {},
        state: {
          currentSessionKey: "agent:main:main",
          activeChatRunId: null,
          sessionInfo: {},
        } as never,
        deliverDefault: false,
        openOverlay: vi.fn(),
        closeOverlay: vi.fn(),
        refreshSessionInfo: vi.fn(),
        loadHistory: vi.fn(),
        setSession: vi.fn(),
        refreshAgents: vi.fn(),
        abortActive: vi.fn(),
        setActivityStatus,
        formatSessionKey: vi.fn(),
        applySessionInfoFromPatch: vi.fn(),
        noteLocalRunId: vi.fn(),
      });
      return { handleCommand, sendChat, addUser, addSystem };
    }

    it("/plan sends plan message to agent", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/plan start");
      expect(addUser).toHaveBeenCalledWith("/plan start");
    });

    it("/kg shows usage when no query provided", async () => {
      const { handleCommand, addSystem } = setupEcosystem();
      await handleCommand("/kg");
      expect(addSystem).toHaveBeenCalledWith("usage: /kg <query>");
    });

    it("/kg sends search message when query provided", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/kg auth flow");
      expect(addUser).toHaveBeenCalledWith("Search the knowledge graph for: auth flow");
    });

    it("/trace sends trace message", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/trace stats");
      expect(addUser).toHaveBeenCalledWith("Show trace stats summary for the current session");
    });

    it("/team sends dashboard message", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/team");
      expect(addUser).toHaveBeenCalledWith(
        "Show the team dashboard with current agent status and activity",
      );
    });

    it("/tasks sends tasks message", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/tasks");
      expect(addUser).toHaveBeenCalledWith("Show background tasks status and summary");
    });

    it("/workflow without args lists workflows", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/workflow");
      expect(addUser).toHaveBeenCalledWith("List available workflows and their status");
    });

    it("/workflow with args forwards them", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/workflow run code-review");
      expect(addUser).toHaveBeenCalledWith("/workflow run code-review");
    });

    it("/rules sends rules message", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/rules");
      expect(addUser).toHaveBeenCalledWith("Show active rules");
    });

    it("/mailbox without args checks inbox", async () => {
      const { handleCommand, addUser } = setupEcosystem();
      await handleCommand("/mailbox");
      expect(addUser).toHaveBeenCalledWith("Check my inbox for new messages and show unread count");
    });

    it("/onboard shows terminal hint", async () => {
      const { handleCommand, addSystem } = setupEcosystem();
      await handleCommand("/onboard");
      expect(addSystem).toHaveBeenCalledWith(
        "Run 'mayros onboard' from the terminal to start the setup wizard",
      );
    });
  });
});

import { describe, expect, it, vi } from "vitest";

const piTuiMocks = vi.hoisted(() => {
  const MockManager = vi.fn(function (
    this: Record<string, unknown>,
    config?: Record<string, unknown>,
  ) {
    this._config = config;
  }) as unknown as typeof import("@mariozechner/pi-tui").EditorKeybindingsManager &
    ReturnType<typeof vi.fn>;
  return {
    matchesKey: vi.fn((_data: string, _key: string) => false),
    setEditorKeybindings: vi.fn(),
    EditorKeybindingsManager: MockManager,
  };
});

vi.mock("@mariozechner/pi-tui", () => ({
  ...piTuiMocks,
  Key: { ctrl: (k: string) => `ctrl+${k}`, shift: (k: string) => `shift+${k}` },
}));

const {
  TuiKeybindingResolver,
  DEFAULT_TUI_KEYBINDINGS,
  applyKeybindingsFromConfig,
  createTuiResolver,
} = await import("./keybinding-resolver.js");

describe("TuiKeybindingResolver", () => {
  it("uses default keybindings when no overrides given", () => {
    const resolver = new TuiKeybindingResolver();
    expect(resolver.getKeys("selectAgent")).toEqual(["ctrl+g"]);
    expect(resolver.getKeys("selectModel")).toEqual(["ctrl+l"]);
    expect(resolver.getKeys("selectSession")).toEqual(["ctrl+p"]);
    expect(resolver.getKeys("toggleTools")).toEqual(["ctrl+o"]);
    expect(resolver.getKeys("toggleThinking")).toEqual(["ctrl+t"]);
  });

  it("allows overriding specific actions", () => {
    const resolver = new TuiKeybindingResolver({ selectAgent: "ctrl+a" });
    expect(resolver.getKeys("selectAgent")).toEqual(["ctrl+a"]);
    expect(resolver.getKeys("selectModel")).toEqual(["ctrl+l"]);
  });

  it("supports array overrides", () => {
    const resolver = new TuiKeybindingResolver({ selectAgent: ["ctrl+a", "ctrl+b"] });
    expect(resolver.getKeys("selectAgent")).toEqual(["ctrl+a", "ctrl+b"]);
  });

  it("matches delegates to matchesKey", () => {
    piTuiMocks.matchesKey.mockReturnValueOnce(true);
    const resolver = new TuiKeybindingResolver();
    expect(resolver.matches("\x07", "selectAgent")).toBe(true);
    expect(piTuiMocks.matchesKey).toHaveBeenCalledWith("\x07", "ctrl+g");
  });

  it("returns false when action has no keys", () => {
    const resolver = new TuiKeybindingResolver();
    expect(resolver.matches("\x00", "toggleVim")).toBe(false);
  });
});

describe("DEFAULT_TUI_KEYBINDINGS", () => {
  it("has all TUI actions", () => {
    expect(DEFAULT_TUI_KEYBINDINGS).toHaveProperty("selectAgent");
    expect(DEFAULT_TUI_KEYBINDINGS).toHaveProperty("selectModel");
    expect(DEFAULT_TUI_KEYBINDINGS).toHaveProperty("selectSession");
    expect(DEFAULT_TUI_KEYBINDINGS).toHaveProperty("toggleTools");
    expect(DEFAULT_TUI_KEYBINDINGS).toHaveProperty("toggleThinking");
    expect(DEFAULT_TUI_KEYBINDINGS).toHaveProperty("toggleVim");
  });
});

describe("applyKeybindingsFromConfig", () => {
  it("creates and sets an EditorKeybindingsManager", () => {
    piTuiMocks.setEditorKeybindings.mockClear();
    piTuiMocks.EditorKeybindingsManager.mockClear();
    applyKeybindingsFromConfig({ cursorUp: "ctrl+k" });
    expect(piTuiMocks.EditorKeybindingsManager).toHaveBeenCalledWith({ cursorUp: "ctrl+k" });
    expect(piTuiMocks.setEditorKeybindings).toHaveBeenCalled();
  });

  it("filters out TUI-specific actions from editor config", () => {
    piTuiMocks.EditorKeybindingsManager.mockClear();
    applyKeybindingsFromConfig({ selectAgent: "ctrl+a", cursorDown: "ctrl+j" });
    expect(piTuiMocks.EditorKeybindingsManager).toHaveBeenCalledWith({ cursorDown: "ctrl+j" });
  });
});

describe("createTuiResolver", () => {
  it("returns a resolver instance", () => {
    const resolver = createTuiResolver({ selectAgent: "ctrl+a" });
    expect(resolver).toBeInstanceOf(TuiKeybindingResolver);
    expect(resolver.getKeys("selectAgent")).toEqual(["ctrl+a"]);
  });
});

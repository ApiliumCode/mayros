import { describe, expect, it, vi } from "vitest";
import {
  detectKeyboardProtocol,
  detectTerminalColorScheme,
  enableKeyboardProtocol,
  relativeLuminance,
  type TerminalColorQuerier,
} from "./term-capabilities.js";

describe("detectKeyboardProtocol", () => {
  it("returns kitty for kitty/WezTerm/ghostty terminals", () => {
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "kitty" } as NodeJS.ProcessEnv)).toBe("kitty");
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "WezTerm" } as NodeJS.ProcessEnv)).toBe("kitty");
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "ghostty" } as NodeJS.ProcessEnv)).toBe("kitty");
  });

  it("returns modify-other-keys for iTerm/vscode/tmux/windows-terminal", () => {
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "iTerm.app" } as NodeJS.ProcessEnv)).toBe(
      "modify-other-keys",
    );
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "vscode" } as NodeJS.ProcessEnv)).toBe(
      "modify-other-keys",
    );
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "tmux" } as NodeJS.ProcessEnv)).toBe(
      "modify-other-keys",
    );
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "windows-terminal" } as NodeJS.ProcessEnv)).toBe(
      "modify-other-keys",
    );
  });

  it("prefers LC_TERMINAL over TERM_PROGRAM (survives tmux on macOS)", () => {
    expect(
      detectKeyboardProtocol({
        LC_TERMINAL: "iTerm.app",
        TERM_PROGRAM: "tmux",
      } as NodeJS.ProcessEnv),
    ).toBe("modify-other-keys");
  });

  it("returns none for terminals not in the allow-list", () => {
    expect(detectKeyboardProtocol({ TERM_PROGRAM: "xterm-256color" } as NodeJS.ProcessEnv)).toBe(
      "none",
    );
    expect(detectKeyboardProtocol({} as NodeJS.ProcessEnv)).toBe("none");
  });
});

describe("enableKeyboardProtocol", () => {
  it("returns a none-handle and writes nothing when protocol is none", () => {
    const written: string[] = [];
    const stream = { write: (s: string) => written.push(s) } as unknown as NodeJS.WritableStream;
    const handle = enableKeyboardProtocol(stream);
    expect(handle.protocol).toBe("none");
    expect(written).toHaveLength(0);
    handle.disable(); // no-op, does not throw
  });

  it("writes the kitty push sequence for kitty terminals", () => {
    const written: string[] = [];
    const stream = { write: (s: string) => written.push(s) } as unknown as NodeJS.WritableStream;
    const original = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = "kitty";
    try {
      const handle = enableKeyboardProtocol(stream);
      expect(handle.protocol).toBe("kitty");
      expect(written.join("")).toContain("\x1b[>1u");
      handle.disable();
      expect(written.join("")).toContain("\x1b[<u");
    } finally {
      if (original === undefined) delete process.env.TERM_PROGRAM;
      else process.env.TERM_PROGRAM = original;
    }
  });

  it("disable is idempotent (only writes pop once)", () => {
    const written: string[] = [];
    const stream = { write: (s: string) => written.push(s) } as unknown as NodeJS.WritableStream;
    const original = process.env.TERM_PROGRAM;
    process.env.TERM_PROGRAM = "kitty";
    try {
      const handle = enableKeyboardProtocol(stream);
      handle.disable();
      handle.disable();
      const popCount = written.filter((s) => s.includes("\x1b[<u")).length;
      expect(popCount).toBe(1);
    } finally {
      if (original === undefined) delete process.env.TERM_PROGRAM;
      else process.env.TERM_PROGRAM = original;
    }
  });
});

describe("relativeLuminance", () => {
  it("returns ~0 for black", () => {
    expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBeCloseTo(0, 1);
  });

  it("returns ~1 for white", () => {
    expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 1);
  });

  it("weights green more than red and blue (Rec. 709)", () => {
    const lum = relativeLuminance({ r: 0, g: 255, b: 0 });
    expect(lum).toBeGreaterThan(0.7);
  });

  it("classifies a dark navy background as dark (< 0.5)", () => {
    expect(relativeLuminance({ r: 30, g: 30, b: 40 })).toBeLessThan(0.5);
  });
});

describe("detectTerminalColorScheme", () => {
  function makeQuerier(
    scheme: "dark" | "light" | undefined,
    bg: { r: number; g: number; b: number } | undefined,
  ): TerminalColorQuerier {
    return {
      queryTerminalColorScheme: vi.fn().mockResolvedValue(scheme),
      queryTerminalBackgroundColor: vi.fn().mockResolvedValue(bg),
    };
  }

  it("returns the DSR scheme when available (dark)", async () => {
    const tui = makeQuerier("dark", undefined);
    expect(await detectTerminalColorScheme(tui)).toBe("dark");
  });

  it("returns the DSR scheme when available (light)", async () => {
    const tui = makeQuerier("light", undefined);
    expect(await detectTerminalColorScheme(tui)).toBe("light");
  });

  it("falls back to OSC 11 luminance when DSR is unsupported", async () => {
    // DSR returns undefined; bright background → light
    const tui = makeQuerier(undefined, { r: 250, g: 250, b: 250 });
    expect(await detectTerminalColorScheme(tui)).toBe("light");
  });

  it("classifies a dark background via OSC 11", async () => {
    const tui = makeQuerier(undefined, { r: 20, g: 20, b: 25 });
    expect(await detectTerminalColorScheme(tui)).toBe("dark");
  });

  it("falls back to dark when neither query responds", async () => {
    const tui = makeQuerier(undefined, undefined);
    expect(await detectTerminalColorScheme(tui)).toBe("dark");
  });
});

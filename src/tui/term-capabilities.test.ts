import { describe, expect, it } from "vitest";
import { detectKeyboardProtocol, enableKeyboardProtocol } from "./term-capabilities.js";

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

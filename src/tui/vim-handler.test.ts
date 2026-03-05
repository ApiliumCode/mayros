import { describe, expect, it, beforeEach } from "vitest";
import { VimHandler } from "./vim-handler.js";
import type { EditorBridge } from "./vim-handler.js";

function createMockBridge(initialText = ""): EditorBridge & {
  text: string;
  line: number;
  col: number;
} {
  const state = { text: initialText, line: 0, col: 0 };
  return {
    get text() {
      return state.text;
    },
    set text(v) {
      state.text = v;
    },
    get line() {
      return state.line;
    },
    set line(v) {
      state.line = v;
    },
    get col() {
      return state.col;
    },
    set col(v) {
      state.col = v;
    },
    getText: () => state.text,
    setText: (v) => {
      state.text = v;
    },
    getCursorPosition: () => ({ line: state.line, col: state.col }),
    setCursorPosition: (l, c) => {
      state.line = l;
      state.col = c;
    },
  };
}

describe("VimHandler", () => {
  let vim: VimHandler;
  let bridge: ReturnType<typeof createMockBridge>;

  beforeEach(() => {
    vim = new VimHandler();
    bridge = createMockBridge("hello world");
    vim.setBridge(bridge);
  });

  describe("mode management", () => {
    it("starts in insert mode", () => {
      expect(vim.getMode()).toBe("insert");
      expect(vim.isNormalMode()).toBe(false);
    });

    it("switches to normal mode on enable()", () => {
      vim.enable();
      expect(vim.getMode()).toBe("normal");
      expect(vim.isNormalMode()).toBe(true);
    });

    it("switches to insert mode on disable()", () => {
      vim.enable();
      vim.disable();
      expect(vim.getMode()).toBe("insert");
    });

    it("shows correct mode indicator", () => {
      expect(vim.getModeIndicator()).toBe("-- INSERT --");
      vim.enable();
      expect(vim.getModeIndicator()).toBe("-- NORMAL --");
    });
  });

  describe("insert mode", () => {
    it("does not consume regular keys", () => {
      expect(vim.handleKey("a")).toBe(false);
      expect(vim.handleKey("x")).toBe(false);
    });

    it("consumes Escape to switch to normal", () => {
      expect(vim.handleKey("\x1b")).toBe(true);
      expect(vim.getMode()).toBe("normal");
    });
  });

  describe("normal mode — mode switching", () => {
    beforeEach(() => {
      vim.enable();
    });

    it("i switches to insert", () => {
      expect(vim.handleKey("i")).toBe(true);
      expect(vim.getMode()).toBe("insert");
    });

    it("a switches to insert and moves cursor right", () => {
      bridge.col = 2;
      vim.handleKey("a");
      expect(vim.getMode()).toBe("insert");
      expect(bridge.col).toBe(3);
    });

    it("I switches to insert and moves to line start", () => {
      bridge.col = 5;
      vim.handleKey("I");
      expect(vim.getMode()).toBe("insert");
      expect(bridge.col).toBe(0);
    });

    it("A switches to insert and moves to line end", () => {
      vim.handleKey("A");
      expect(vim.getMode()).toBe("insert");
      expect(bridge.col).toBe(11); // "hello world".length
    });

    it("o inserts line below and enters insert mode", () => {
      vim.handleKey("o");
      expect(vim.getMode()).toBe("insert");
      expect(bridge.text).toBe("hello world\n");
      expect(bridge.line).toBe(1);
    });

    it("O inserts line above and enters insert mode", () => {
      vim.handleKey("O");
      expect(vim.getMode()).toBe("insert");
      expect(bridge.text).toBe("\nhello world");
      expect(bridge.line).toBe(0);
    });
  });

  describe("normal mode — cursor motions", () => {
    beforeEach(() => {
      vim.enable();
      bridge.col = 5;
    });

    it("h moves cursor left", () => {
      vim.handleKey("h");
      expect(bridge.col).toBe(4);
    });

    it("l moves cursor right", () => {
      vim.handleKey("l");
      expect(bridge.col).toBe(6);
    });

    it("0 moves to line start", () => {
      vim.handleKey("0");
      expect(bridge.col).toBe(0);
    });

    it("$ moves to line end", () => {
      vim.handleKey("$");
      expect(bridge.col).toBe(11);
    });

    it("j moves down", () => {
      bridge.text = "line1\nline2";
      bridge.line = 0;
      bridge.col = 2;
      vim.handleKey("j");
      expect(bridge.line).toBe(1);
    });

    it("k moves up", () => {
      bridge.text = "line1\nline2";
      bridge.line = 1;
      bridge.col = 0;
      vim.handleKey("k");
      expect(bridge.line).toBe(0);
    });

    it("w moves to next word", () => {
      bridge.col = 0;
      vim.handleKey("w");
      expect(bridge.col).toBe(6); // start of "world"
    });

    it("b moves to previous word start", () => {
      bridge.col = 8;
      vim.handleKey("b");
      expect(bridge.col).toBe(6); // start of "world"
    });
  });

  describe("normal mode — count prefix", () => {
    beforeEach(() => {
      vim.enable();
      bridge.col = 0;
    });

    it("3l moves cursor 3 right", () => {
      vim.handleKey("3");
      vim.handleKey("l");
      expect(bridge.col).toBe(3);
    });

    it("2h moves cursor 2 left", () => {
      bridge.col = 5;
      vim.handleKey("2");
      vim.handleKey("h");
      expect(bridge.col).toBe(3);
    });
  });

  describe("normal mode — editing", () => {
    beforeEach(() => {
      vim.enable();
    });

    it("x deletes char at cursor", () => {
      bridge.col = 0;
      vim.handleKey("x");
      expect(bridge.text).toBe("ello world");
    });

    it("D deletes to end of line", () => {
      bridge.col = 5;
      vim.handleKey("D");
      expect(bridge.text).toBe("hello");
    });

    it("C deletes to end and enters insert", () => {
      bridge.col = 5;
      vim.handleKey("C");
      expect(bridge.text).toBe("hello");
      expect(vim.getMode()).toBe("insert");
    });

    it("dd deletes entire line", () => {
      bridge.text = "first\nsecond\nthird";
      bridge.line = 1;
      vim.handleKey("d");
      vim.handleKey("d");
      expect(bridge.text).toBe("first\nthird");
    });

    it("cc deletes line and enters insert", () => {
      bridge.text = "first\nsecond\nthird";
      bridge.line = 1;
      vim.handleKey("c");
      vim.handleKey("c");
      expect(bridge.text).toBe("first\nthird");
      expect(vim.getMode()).toBe("insert");
    });

    it("yy + p yanks and pastes line", () => {
      bridge.text = "hello";
      bridge.col = 2;
      vim.handleKey("y");
      vim.handleKey("y");
      vim.handleKey("p");
      // Paste inserts after cursor (col 2): "hel" + "hello" + "lo"
      expect(bridge.text).toBe("helhellolo");
    });

    it("u undoes last edit", () => {
      bridge.col = 0;
      vim.handleKey("x");
      expect(bridge.text).toBe("ello world");
      vim.handleKey("u");
      expect(bridge.text).toBe("hello world");
    });
  });

  describe("normal mode — key consumption", () => {
    beforeEach(() => {
      vim.enable();
    });

    it("all known keys are consumed", () => {
      for (const key of [
        "h",
        "j",
        "k",
        "l",
        "w",
        "b",
        "0",
        "$",
        "i",
        "a",
        "x",
        "u",
        "p",
        "D",
        "C",
      ]) {
        const result = vim.handleKey(key);
        expect(result, `key '${key}' should be consumed`).toBe(true);
        vim.enable(); // Reset to normal mode
      }
    });

    it("unknown keys are still consumed in normal mode", () => {
      expect(vim.handleKey("z")).toBe(true);
    });
  });
});

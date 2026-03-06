import { describe, it, expect } from "vitest";
import {
  parseMouseSequence,
  extractMouseEvents,
  isMouseSequence,
  MOUSE_ENABLE_SEQUENCE,
  MOUSE_DISABLE_SEQUENCE,
} from "./mouse-parser.js";

// ============================================================================
// parseMouseSequence
// ============================================================================

describe("parseMouseSequence", () => {
  // 1
  it("parses left button press", () => {
    // ESC [ < 0 ; 10 ; 20 M
    const event = parseMouseSequence("\x1b[<0;10;20M");
    expect(event).not.toBeNull();
    expect(event!.button).toBe("left");
    expect(event!.action).toBe("press");
    expect(event!.col).toBe(9); // 0-based
    expect(event!.row).toBe(19); // 0-based
  });

  // 2
  it("parses middle button press", () => {
    const event = parseMouseSequence("\x1b[<1;5;5M");
    expect(event).not.toBeNull();
    expect(event!.button).toBe("middle");
    expect(event!.action).toBe("press");
  });

  // 3
  it("parses right button press", () => {
    const event = parseMouseSequence("\x1b[<2;1;1M");
    expect(event).not.toBeNull();
    expect(event!.button).toBe("right");
    expect(event!.action).toBe("press");
  });

  // 4
  it("parses button release (lowercase m)", () => {
    const event = parseMouseSequence("\x1b[<0;10;20m");
    expect(event).not.toBeNull();
    expect(event!.button).toBe("left");
    expect(event!.action).toBe("release");
  });

  // 5
  it("parses scroll up", () => {
    // 64 = scroll up
    const event = parseMouseSequence("\x1b[<64;10;20M");
    expect(event).not.toBeNull();
    expect(event!.action).toBe("scroll-up");
    expect(event!.button).toBe("none");
  });

  // 6
  it("parses scroll down", () => {
    // 65 = scroll down
    const event = parseMouseSequence("\x1b[<65;10;20M");
    expect(event).not.toBeNull();
    expect(event!.action).toBe("scroll-down");
    expect(event!.button).toBe("none");
  });

  // 7
  it("parses drag (motion with button)", () => {
    // 32 = motion flag + 0 = left button
    const event = parseMouseSequence("\x1b[<32;15;25M");
    expect(event).not.toBeNull();
    expect(event!.button).toBe("left");
    expect(event!.action).toBe("move");
  });

  // 8
  it("detects shift modifier", () => {
    // 4 = shift + 0 = left button
    const event = parseMouseSequence("\x1b[<4;1;1M");
    expect(event).not.toBeNull();
    expect(event!.shift).toBe(true);
    expect(event!.alt).toBe(false);
    expect(event!.ctrl).toBe(false);
  });

  // 9
  it("detects alt modifier", () => {
    // 8 = alt + 0 = left button
    const event = parseMouseSequence("\x1b[<8;1;1M");
    expect(event).not.toBeNull();
    expect(event!.alt).toBe(true);
  });

  // 10
  it("detects ctrl modifier", () => {
    // 16 = ctrl + 0 = left button
    const event = parseMouseSequence("\x1b[<16;1;1M");
    expect(event).not.toBeNull();
    expect(event!.ctrl).toBe(true);
  });

  // 11
  it("detects multiple modifiers", () => {
    // 28 = shift(4) + alt(8) + ctrl(16) + left button
    const event = parseMouseSequence("\x1b[<28;1;1M");
    expect(event).not.toBeNull();
    expect(event!.shift).toBe(true);
    expect(event!.alt).toBe(true);
    expect(event!.ctrl).toBe(true);
  });

  // 12
  it("handles large coordinates (SGR advantage)", () => {
    const event = parseMouseSequence("\x1b[<0;300;200M");
    expect(event).not.toBeNull();
    expect(event!.col).toBe(299);
    expect(event!.row).toBe(199);
  });

  // 13
  it("returns null for invalid sequence", () => {
    expect(parseMouseSequence("not a mouse sequence")).toBeNull();
    expect(parseMouseSequence("\x1b[<abc;1;1M")).toBeNull();
    expect(parseMouseSequence("\x1b[<0;1M")).toBeNull(); // Missing coordinate
  });

  // 14
  it("handles coordinate 1,1 as 0,0 (0-based)", () => {
    const event = parseMouseSequence("\x1b[<0;1;1M");
    expect(event).not.toBeNull();
    expect(event!.col).toBe(0);
    expect(event!.row).toBe(0);
  });
});

// ============================================================================
// extractMouseEvents
// ============================================================================

describe("extractMouseEvents", () => {
  // 15
  it("extracts single event", () => {
    const { events, remaining } = extractMouseEvents("\x1b[<0;10;20M");
    expect(events).toHaveLength(1);
    expect(events[0].button).toBe("left");
    expect(remaining).toBe("");
  });

  // 16
  it("extracts multiple events", () => {
    const data = "\x1b[<0;10;20M\x1b[<0;10;20m\x1b[<64;10;20M";
    const { events, remaining } = extractMouseEvents(data);
    expect(events).toHaveLength(3);
    expect(events[0].action).toBe("press");
    expect(events[1].action).toBe("release");
    expect(events[2].action).toBe("scroll-up");
    expect(remaining).toBe("");
  });

  // 17
  it("preserves non-mouse data as remaining", () => {
    const { events, remaining } = extractMouseEvents("hello");
    expect(events).toHaveLength(0);
    expect(remaining).toBe("hello");
  });

  // 18
  it("handles incomplete sequence", () => {
    const { events, remaining } = extractMouseEvents("\x1b[<0;10");
    expect(events).toHaveLength(0);
    expect(remaining).toBe("\x1b[<0;10");
  });

  // 19
  it("extracts events mixed with non-mouse data", () => {
    const data = "text\x1b[<0;1;1Mmore";
    const { events, remaining } = extractMouseEvents(data);
    expect(events).toHaveLength(1);
    expect(remaining).toBe("more");
  });
});

// ============================================================================
// isMouseSequence
// ============================================================================

describe("isMouseSequence", () => {
  // 20
  it("returns true for SGR prefix", () => {
    expect(isMouseSequence("\x1b[<0;1;1M")).toBe(true);
    expect(isMouseSequence("\x1b[<")).toBe(true);
  });

  // 21
  it("returns false for non-mouse data", () => {
    expect(isMouseSequence("hello")).toBe(false);
    expect(isMouseSequence("\x1b[A")).toBe(false); // Arrow key
  });
});

// ============================================================================
// Constants
// ============================================================================

describe("ANSI sequences", () => {
  // 22
  it("enable sequence contains required modes", () => {
    expect(MOUSE_ENABLE_SEQUENCE).toContain("?1000h");
    expect(MOUSE_ENABLE_SEQUENCE).toContain("?1002h");
    expect(MOUSE_ENABLE_SEQUENCE).toContain("?1006h");
  });

  // 23
  it("disable sequence contains required modes", () => {
    expect(MOUSE_DISABLE_SEQUENCE).toContain("?1000l");
    expect(MOUSE_DISABLE_SEQUENCE).toContain("?1002l");
    expect(MOUSE_DISABLE_SEQUENCE).toContain("?1006l");
  });
});

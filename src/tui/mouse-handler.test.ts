import { describe, it, expect, vi, beforeEach } from "vitest";
import { MouseHandler, createMouseInputListener } from "./mouse-handler.js";
import type { MouseEvent } from "./mouse-parser.js";

// ============================================================================
// MouseHandler
// ============================================================================

describe("MouseHandler", () => {
  let handler: MouseHandler;

  beforeEach(() => {
    handler = new MouseHandler({ scrollLines: 3 });
  });

  // 1
  it("starts disabled", () => {
    expect(handler.isEnabled()).toBe(false);
  });

  // 2
  it("processInput returns false when disabled", () => {
    const consumed = handler.processInput("\x1b[<0;1;1M");
    expect(consumed).toBe(false);
  });

  // 3
  it("enable/disable toggles state", () => {
    handler.enable();
    expect(handler.isEnabled()).toBe(true);
    handler.disable();
    expect(handler.isEnabled()).toBe(false);
  });

  // 4
  it("processInput consumes mouse sequences when enabled", () => {
    handler.enable();
    const consumed = handler.processInput("\x1b[<0;1;1M");
    expect(consumed).toBe(true);
  });

  // 5
  it("processInput passes through non-mouse data", () => {
    handler.enable();
    const consumed = handler.processInput("hello");
    expect(consumed).toBe(false);
  });

  // 6
  it("dispatches scroll-up events to scroll handlers", () => {
    handler.enable();
    const scrollFn = vi.fn();
    handler.onScroll(scrollFn);

    handler.processInput("\x1b[<64;10;20M");

    expect(scrollFn).toHaveBeenCalledWith("up", 3);
  });

  // 7
  it("dispatches scroll-down events to scroll handlers", () => {
    handler.enable();
    const scrollFn = vi.fn();
    handler.onScroll(scrollFn);

    handler.processInput("\x1b[<65;10;20M");

    expect(scrollFn).toHaveBeenCalledWith("down", 3);
  });

  // 8
  it("dispatches click events to click handlers", () => {
    handler.enable();
    const clickFn = vi.fn();
    handler.onClick(clickFn);

    handler.processInput("\x1b[<0;5;10M");

    expect(clickFn).toHaveBeenCalledOnce();
    const event: MouseEvent = clickFn.mock.calls[0][0];
    expect(event.button).toBe("left");
    expect(event.action).toBe("press");
    expect(event.col).toBe(4);
    expect(event.row).toBe(9);
  });

  // 9
  it("does not dispatch release events to click handlers", () => {
    handler.enable();
    const clickFn = vi.fn();
    handler.onClick(clickFn);

    handler.processInput("\x1b[<0;5;10m"); // release (lowercase m)

    expect(clickFn).not.toHaveBeenCalled();
  });

  // 10
  it("dispatches all events to raw handlers", () => {
    handler.enable();
    const rawFn = vi.fn();
    handler.onRaw(rawFn);

    handler.processInput("\x1b[<0;1;1M");
    handler.processInput("\x1b[<0;1;1m");
    handler.processInput("\x1b[<64;1;1M");

    expect(rawFn).toHaveBeenCalledTimes(3);
  });

  // 11
  it("unsubscribe removes handler", () => {
    handler.enable();
    const scrollFn = vi.fn();
    const unsub = handler.onScroll(scrollFn);

    handler.processInput("\x1b[<64;1;1M");
    expect(scrollFn).toHaveBeenCalledOnce();

    unsub();
    handler.processInput("\x1b[<64;1;1M");
    expect(scrollFn).toHaveBeenCalledOnce(); // Still 1 call
  });

  // 12
  it("handles multiple events in single input", () => {
    handler.enable();
    const rawFn = vi.fn();
    handler.onRaw(rawFn);

    handler.processInput("\x1b[<0;1;1M\x1b[<0;2;2M");

    expect(rawFn).toHaveBeenCalledTimes(2);
  });

  // 13
  it("processes right-click events", () => {
    handler.enable();
    const clickFn = vi.fn();
    handler.onClick(clickFn);

    handler.processInput("\x1b[<2;5;5M");

    expect(clickFn).toHaveBeenCalledOnce();
    expect(clickFn.mock.calls[0][0].button).toBe("right");
  });

  // 14
  it("processes modifier keys", () => {
    handler.enable();
    const clickFn = vi.fn();
    handler.onClick(clickFn);

    // ctrl + left click: 16 + 0 = 16
    handler.processInput("\x1b[<16;1;1M");

    const event: MouseEvent = clickFn.mock.calls[0][0];
    expect(event.ctrl).toBe(true);
    expect(event.shift).toBe(false);
  });
});

// ============================================================================
// Scroll Acceleration
// ============================================================================

describe("Scroll Acceleration", () => {
  // 15
  it("accelerates on rapid consecutive scrolls", async () => {
    const handler = new MouseHandler({
      scrollLines: 3,
      scrollAcceleration: true,
      accelerationWindowMs: 200,
      maxAcceleration: 3,
    });
    handler.enable();

    const scrollFn = vi.fn();
    handler.onScroll(scrollFn);

    // Rapid scrolls
    handler.processInput("\x1b[<64;1;1M"); // 3 lines (1x)
    handler.processInput("\x1b[<64;1;1M"); // 6 lines (2x)
    handler.processInput("\x1b[<64;1;1M"); // 9 lines (3x, max)
    handler.processInput("\x1b[<64;1;1M"); // 9 lines (still 3x)

    expect(scrollFn).toHaveBeenCalledTimes(4);
    expect(scrollFn.mock.calls[0][1]).toBe(3);
    expect(scrollFn.mock.calls[1][1]).toBe(6);
    expect(scrollFn.mock.calls[2][1]).toBe(9);
    expect(scrollFn.mock.calls[3][1]).toBe(9);
  });

  // 16
  it("does not accelerate when disabled", () => {
    const handler = new MouseHandler({
      scrollLines: 3,
      scrollAcceleration: false,
    });
    handler.enable();

    const scrollFn = vi.fn();
    handler.onScroll(scrollFn);

    handler.processInput("\x1b[<64;1;1M");
    handler.processInput("\x1b[<64;1;1M");

    // Both calls should have base scroll lines
    expect(scrollFn.mock.calls[0][1]).toBe(3);
    expect(scrollFn.mock.calls[1][1]).toBe(3);
  });
});

// ============================================================================
// createMouseInputListener
// ============================================================================

describe("createMouseInputListener", () => {
  // 17
  it("returns consume:true for mouse data", () => {
    const handler = new MouseHandler();
    handler.enable();
    const listener = createMouseInputListener(handler);

    const result = listener("\x1b[<0;1;1M");
    expect(result).toEqual({ consume: true });
  });

  // 18
  it("returns undefined for non-mouse data", () => {
    const handler = new MouseHandler();
    handler.enable();
    const listener = createMouseInputListener(handler);

    const result = listener("hello");
    expect(result).toBeUndefined();
  });

  // 19
  it("returns undefined when handler is disabled", () => {
    const handler = new MouseHandler();
    const listener = createMouseInputListener(handler);

    const result = listener("\x1b[<0;1;1M");
    expect(result).toBeUndefined();
  });
});

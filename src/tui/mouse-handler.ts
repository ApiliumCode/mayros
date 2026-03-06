/**
 * Mouse Handler — TUI mouse event dispatch and management.
 *
 * Integrates with pi-tui's input listener pipeline to intercept mouse
 * sequences, parse them, and dispatch to registered handlers.
 *
 * Features:
 * - SGR 1006 sequence interception from stdin
 * - Scroll event dispatch (wheel up/down)
 * - Click event dispatch (left/middle/right)
 * - Enable/disable mouse tracking at terminal level
 * - Scroll acceleration (consecutive scroll events within 100ms)
 */

import {
  type MouseEvent,
  type MouseAction,
  extractMouseEvents,
  isMouseSequence,
  MOUSE_ENABLE_SEQUENCE,
  MOUSE_DISABLE_SEQUENCE,
} from "./mouse-parser.js";

// ============================================================================
// Types
// ============================================================================

export type MouseEventHandler = (event: MouseEvent) => void;

export type ScrollHandler = (direction: "up" | "down", lines: number) => void;

export type ClickHandler = (event: MouseEvent) => void;

export type MouseHandlerConfig = {
  /** Lines to scroll per wheel event (default: 3). */
  scrollLines?: number;
  /** Enable scroll acceleration (default: true). */
  scrollAcceleration?: boolean;
  /** Acceleration window in ms (default: 100). */
  accelerationWindowMs?: number;
  /** Max acceleration multiplier (default: 5). */
  maxAcceleration?: number;
};

// ============================================================================
// MouseHandler
// ============================================================================

export class MouseHandler {
  private enabled = false;
  private buffer = "";
  private scrollLines: number;
  private scrollAcceleration: boolean;
  private accelerationWindowMs: number;
  private maxAcceleration: number;
  private lastScrollAt = 0;
  private consecutiveScrolls = 0;

  private readonly scrollHandlers: ScrollHandler[] = [];
  private readonly clickHandlers: ClickHandler[] = [];
  private readonly rawHandlers: MouseEventHandler[] = [];

  constructor(config: MouseHandlerConfig = {}) {
    this.scrollLines = config.scrollLines ?? 3;
    this.scrollAcceleration = config.scrollAcceleration ?? true;
    this.accelerationWindowMs = config.accelerationWindowMs ?? 100;
    this.maxAcceleration = config.maxAcceleration ?? 5;
  }

  /**
   * Enable mouse tracking in the terminal.
   */
  enable(): void {
    if (this.enabled) return;
    this.enabled = true;
    if (process.stdout.isTTY) {
      process.stdout.write(MOUSE_ENABLE_SEQUENCE);
    }
  }

  /**
   * Disable mouse tracking in the terminal.
   */
  disable(): void {
    if (!this.enabled) return;
    this.enabled = false;
    this.buffer = "";
    this.consecutiveScrolls = 0;
    if (process.stdout.isTTY) {
      process.stdout.write(MOUSE_DISABLE_SEQUENCE);
    }
  }

  isEnabled(): boolean {
    return this.enabled;
  }

  // ========================================================================
  // Handler Registration
  // ========================================================================

  /**
   * Register a scroll handler (called on wheel up/down events).
   */
  onScroll(handler: ScrollHandler): () => void {
    this.scrollHandlers.push(handler);
    return () => {
      const idx = this.scrollHandlers.indexOf(handler);
      if (idx >= 0) this.scrollHandlers.splice(idx, 1);
    };
  }

  /**
   * Register a click handler (called on mouse press events).
   */
  onClick(handler: ClickHandler): () => void {
    this.clickHandlers.push(handler);
    return () => {
      const idx = this.clickHandlers.indexOf(handler);
      if (idx >= 0) this.clickHandlers.splice(idx, 1);
    };
  }

  /**
   * Register a raw mouse event handler (called for ALL events).
   */
  onRaw(handler: MouseEventHandler): () => void {
    this.rawHandlers.push(handler);
    return () => {
      const idx = this.rawHandlers.indexOf(handler);
      if (idx >= 0) this.rawHandlers.splice(idx, 1);
    };
  }

  // ========================================================================
  // Input Processing (pi-tui input listener integration)
  // ========================================================================

  /**
   * Process input data from the terminal. Returns true if the data
   * was consumed (was a mouse sequence), false if it should be passed through.
   *
   * This is designed to be called from tui.addInputListener().
   */
  processInput(data: string): boolean {
    if (!this.enabled) return false;

    // Quick check: does this look like a mouse sequence?
    const combined = this.buffer + data;
    if (!isMouseSequence(combined) && !this.buffer) {
      return false;
    }

    const { events, remaining } = extractMouseEvents(combined);
    this.buffer = remaining;

    if (events.length === 0 && remaining.length > 0) {
      // Partial sequence — buffer it and consume
      return isMouseSequence(remaining);
    }

    for (const event of events) {
      this.dispatch(event);
    }

    return events.length > 0;
  }

  // ========================================================================
  // Dispatch
  // ========================================================================

  private dispatch(event: MouseEvent): void {
    // Raw handlers get everything
    for (const handler of this.rawHandlers) {
      handler(event);
    }

    // Scroll events
    if (event.action === "scroll-up" || event.action === "scroll-down") {
      const direction = event.action === "scroll-up" ? "up" : "down";
      const lines = this.calculateScrollLines();
      for (const handler of this.scrollHandlers) {
        handler(direction, lines);
      }
      return;
    }

    // Click events (press only)
    if (event.action === "press") {
      for (const handler of this.clickHandlers) {
        handler(event);
      }
    }
  }

  private calculateScrollLines(): number {
    const now = Date.now();
    if (this.scrollAcceleration && now - this.lastScrollAt < this.accelerationWindowMs) {
      this.consecutiveScrolls = Math.min(this.consecutiveScrolls + 1, this.maxAcceleration);
    } else {
      this.consecutiveScrolls = 1;
    }
    this.lastScrollAt = now;
    return this.scrollLines * this.consecutiveScrolls;
  }
}

/**
 * Create a pi-tui input listener function that intercepts mouse events.
 *
 * Usage:
 * ```typescript
 * const mouseHandler = new MouseHandler();
 * tui.addInputListener(createMouseInputListener(mouseHandler));
 * ```
 */
export function createMouseInputListener(
  handler: MouseHandler,
): (data: string) => { consume?: boolean; data?: string } | undefined {
  return (data: string) => {
    if (handler.processInput(data)) {
      return { consume: true };
    }
    return undefined;
  };
}

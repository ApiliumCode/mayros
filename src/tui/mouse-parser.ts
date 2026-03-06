/**
 * Mouse Event Parser — SGR 1006 terminal mouse protocol.
 *
 * Parses SGR extended mouse reporting sequences:
 *   ESC [ < Cb ; Cx ; Cy M  (press/motion)
 *   ESC [ < Cb ; Cx ; Cy m  (release)
 *
 * Where:
 *   Cb = button + modifiers encoded as integer
 *   Cx = 1-based column
 *   Cy = 1-based row
 *
 * Button encoding (Cb):
 *   0 = left button
 *   1 = middle button
 *   2 = right button
 *   32 = motion (added to button value during drag)
 *   64 = scroll up
 *   65 = scroll down
 *   Modifiers: +4 = shift, +8 = alt/meta, +16 = ctrl
 */

// ============================================================================
// Types
// ============================================================================

export type MouseButton = "left" | "middle" | "right" | "none";
export type MouseAction = "press" | "release" | "move" | "scroll-up" | "scroll-down";

export type MouseEvent = {
  button: MouseButton;
  action: MouseAction;
  col: number; // 0-based
  row: number; // 0-based
  shift: boolean;
  alt: boolean;
  ctrl: boolean;
};

// ============================================================================
// Constants
// ============================================================================

/** SGR mouse sequence prefix: ESC [ < */
const SGR_PREFIX = "\x1b[<";

/** Regex to match a complete SGR mouse sequence. */
const SGR_MOUSE_REGEX = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])$/;

// ============================================================================
// Parser
// ============================================================================

/**
 * Check if a data chunk starts with an SGR mouse sequence prefix.
 */
export function isMouseSequence(data: string): boolean {
  return data.startsWith(SGR_PREFIX);
}

/**
 * Extract all complete SGR mouse sequences from a data buffer.
 *
 * Returns an array of parsed events and the remaining unconsumed buffer.
 */
export function extractMouseEvents(data: string): {
  events: MouseEvent[];
  remaining: string;
} {
  const events: MouseEvent[] = [];
  let remaining = data;

  while (remaining.length > 0) {
    // Find the next SGR prefix
    const start = remaining.indexOf(SGR_PREFIX);
    if (start === -1) break;

    // Find the terminator (M or m)
    let end = -1;
    for (let i = start + SGR_PREFIX.length; i < remaining.length; i++) {
      const ch = remaining[i];
      if (ch === "M" || ch === "m") {
        end = i;
        break;
      }
      // Only digits and semicolons are valid between prefix and terminator
      if (ch !== ";" && (ch < "0" || ch > "9")) break;
    }

    if (end === -1) {
      // Incomplete sequence — keep in buffer
      remaining = remaining.slice(start);
      break;
    }

    const sequence = remaining.slice(start, end + 1);
    const parsed = parseMouseSequence(sequence);
    if (parsed) {
      events.push(parsed);
    }

    // If there was non-mouse data before this sequence, discard it
    remaining = remaining.slice(end + 1);
  }

  return { events, remaining };
}

/**
 * Parse a single SGR mouse sequence into a MouseEvent.
 */
export function parseMouseSequence(sequence: string): MouseEvent | null {
  const match = SGR_MOUSE_REGEX.exec(sequence);
  if (!match) return null;

  const cb = parseInt(match[1], 10);
  const cx = parseInt(match[2], 10);
  const cy = parseInt(match[3], 10);
  const isRelease = match[4] === "m";

  // Extract modifiers
  const shift = (cb & 4) !== 0;
  const alt = (cb & 8) !== 0;
  const ctrl = (cb & 16) !== 0;

  // Extract button and action
  const baseButton = cb & 3; // Lower 2 bits
  const isMotion = (cb & 32) !== 0;
  const isScroll = (cb & 64) !== 0;

  let button: MouseButton;
  let action: MouseAction;

  if (isScroll) {
    button = "none";
    action = baseButton === 0 ? "scroll-up" : "scroll-down";
  } else if (isRelease) {
    button = decodeButton(baseButton);
    action = "release";
  } else if (isMotion) {
    button = decodeButton(baseButton);
    action = "move";
  } else {
    button = decodeButton(baseButton);
    action = "press";
  }

  return {
    button,
    action,
    col: cx - 1, // Convert to 0-based
    row: cy - 1, // Convert to 0-based
    shift,
    alt,
    ctrl,
  };
}

function decodeButton(value: number): MouseButton {
  switch (value) {
    case 0:
      return "left";
    case 1:
      return "middle";
    case 2:
      return "right";
    default:
      return "none";
  }
}

// ============================================================================
// Enable/Disable Sequences
// ============================================================================

/**
 * ANSI sequence to enable SGR 1006 mouse tracking with button events.
 *
 * Enables:
 * - ?1000h — Basic mouse tracking (press/release)
 * - ?1002h — Button event tracking (track drag)
 * - ?1006h — SGR extended mode (for coordinates > 223)
 */
export const MOUSE_ENABLE_SEQUENCE = "\x1b[?1000h\x1b[?1002h\x1b[?1006h";

/**
 * ANSI sequence to disable mouse tracking.
 */
export const MOUSE_DISABLE_SEQUENCE = "\x1b[?1000l\x1b[?1002l\x1b[?1006l";

/**
 * ANSI sequence to enable full mouse tracking (including motion without button).
 * Use with caution — generates many events.
 */
export const MOUSE_FULL_ENABLE_SEQUENCE = "\x1b[?1000h\x1b[?1003h\x1b[?1006h";

/**
 * Terminal extended-keyboard capability detection and lifecycle.
 *
 * Modern terminals support extended keyboard protocols that preserve modifier
 * combinations (Shift+Enter, Ctrl+Shift+key, Cmd-modifiers) which a plain
 * raw-mode stdin collapses. This module enables the best supported protocol at
 * startup and disables it on exit, with terminal-cleanup hygiene: leaving the
 * protocol armed after exit corrupts subsequent shell input.
 *
 * Supported protocols, in preference order:
 *   1. Kitty keyboard protocol (CSI > 1 u push / CSI < u pop)
 *   2. xterm modifyOtherKeys level 2 (CSI > 4 ; 2 u / CSI < 4 u)
 *
 * Detection is conservative: only terminals in the known-good allow-list are
 * upgraded, so we never emit escape sequences a terminal cannot parse back.
 */

import process from "node:process";

/** Minimal surface of the TUI instance needed for terminal color queries. */
export type TerminalColorQuerier = {
  queryTerminalColorScheme(opts: { timeoutMs: number }): Promise<"dark" | "light" | undefined>;
  queryTerminalBackgroundColor(opts: {
    timeoutMs: number;
  }): Promise<{ r: number; g: number; b: number } | undefined>;
};

/** Terminal identifiers that reliably support an extended keyboard protocol. */
const EXTENDED_KEY_TERMINALS = new Set([
  "iTerm.app",
  "kitty",
  "WezTerm",
  "ghostty",
  "tmux",
  "vscode",
  "windows-terminal",
  "Apple_Terminal",
]);

type Protocol = "kitty" | "modify-other-keys" | "none";

function detectTerminal(): string {
  // LC_TERMINAL survives tmux on macOS where TERM_PROGRAM is overwritten.
  return (
    process.env.LC_TERMINAL || process.env.TERM_PROGRAM || process.env.TERM_PROGRAM_VERSION || ""
  );
}

/** Decide which protocol to enable, if any, for the current terminal. */
export function detectKeyboardProtocol(env: NodeJS.ProcessEnv = process.env): Protocol {
  const id = env.LC_TERMINAL || env.TERM_PROGRAM || "";
  if (!id || !EXTENDED_KEY_TERMINALS.has(id)) {
    return "none";
  }
  // Kitty, WezTerm, Ghostty implement the kitty protocol natively.
  // iTerm, vscode, Apple Terminal, tmux, windows-terminal support modifyOtherKeys.
  if (id === "kitty" || id === "WezTerm" || id === "ghostty") {
    return "kitty";
  }
  return "modify-other-keys";
}

/** Escape: CSI */
const CSI = "\x1b[";

function pushSequence(protocol: Protocol): string {
  switch (protocol) {
    case "kitty":
      // Kitty keyboard protocol: push flags 1 (disambiguate escape keys).
      return `${CSI}>1u`;
    case "modify-other-keys":
      // xterm modifyOtherKeys level 2.
      return `${CSI}>4;2u`;
    default:
      return "";
  }
}

function popSequence(protocol: Protocol): string {
  switch (protocol) {
    case "kitty":
      return `${CSI}<u`;
    case "modify-other-keys":
      return `${CSI}<4u`;
    default:
      return "";
  }
}

export type KeyboardProtocolHandle = {
  /** The protocol that was enabled, or "none" if no upgrade applied. */
  protocol: Protocol;
  /** Restore the terminal to its default keyboard mode. Safe to call once. */
  disable: () => void;
};

/**
 * Enable the best supported extended keyboard protocol on the given stream
 * (defaults to stdout). Returns a handle whose `disable()` pops the protocol;
 * call it on exit, on every signal, and on uncaught errors.
 */
export function enableKeyboardProtocol(
  stream: NodeJS.WritableStream = process.stdout,
): KeyboardProtocolHandle {
  const protocol = detectKeyboardProtocol();
  const push = pushSequence(protocol);
  if (push) {
    try {
      stream.write(push);
    } catch {
      // Writing to a closed stream must never break startup.
    }
  }
  let disabled = false;
  return {
    protocol,
    disable: () => {
      if (disabled || protocol === "none") return;
      disabled = true;
      const pop = popSequence(protocol);
      if (pop) {
        try {
          stream.write(pop);
        } catch {
          // Best-effort cleanup.
        }
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Terminal color-scheme detection (dark/light auto-theme)
// ---------------------------------------------------------------------------

/**
 * Compute the relative luminance of an RGB color using the Rec. 709 weighting.
 * Values >= 0.5 are considered "light" backgrounds.
 */
export function relativeLuminance(rgb: { r: number; g: number; b: number }): number {
  return (0.2126 * rgb.r + 0.7152 * rgb.g + 0.0722 * rgb.b) / 255;
}

/**
 * Detect whether the terminal has a dark or light background, using the best
 * available signal. Returns "dark" when no signal is available (the prior
 * default).
 *
 * Query ladder, fastest signal wins:
 *   1. DSR color-scheme (`CSI ? 996 n`) — terminals reply with a direct
 *      dark/light answer. Cleanest signal when supported.
 *   2. OSC 11 background color — parse the RGB reply and compute luminance.
 *   3. Fallback to "dark".
 *
 * Both queries are run concurrently and each has a 150 ms timeout, so an
 * unresponsive terminal adds at most ~150 ms to startup before falling back.
 */
export async function detectTerminalColorScheme(
  tui: TerminalColorQuerier,
): Promise<"dark" | "light"> {
  const [scheme, bg] = await Promise.all([
    tui.queryTerminalColorScheme({ timeoutMs: 150 }),
    tui.queryTerminalBackgroundColor({ timeoutMs: 150 }),
  ]);
  if (scheme === "dark" || scheme === "light") return scheme;
  if (bg) return relativeLuminance(bg) >= 0.5 ? "light" : "dark";
  return "dark";
}

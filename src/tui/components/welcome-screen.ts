import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth } from "@earendil-works/pi-tui";
import chalk from "chalk";
import { visibleWidth } from "../../terminal/ansi.js";
import type { TuiStateAccess } from "../tui-types.js";
import { theme } from "../theme/theme.js";

// ── Shield mascot (5 lines, cute Mayros shield with face) ──────────

const SHIELD_RAW = ["▄▄▄▄█████▄▄▄▄", "██  ●   ●  ██", "██    ◡    ██", "█▄       ▄█", "▀███████▀"];

type ColorFn = (text: string) => string;

/**
 * Returns the raw shield art lines (no color).
 */
export function buildShieldArt(): string[] {
  return SHIELD_RAW.slice();
}

/**
 * Applies a 3-zone golden gradient to the shield mascot.
 * Zone 1 (lines 0-1): accent gold — shield crown + eyes
 * Zone 2 (line 2): accentSoft amber — smile
 * Zone 3 (lines 3-4): bronze — shield base
 */
export function colorShieldArt(opts?: {
  gold?: ColorFn;
  amber?: ColorFn;
  bronze?: ColorFn;
}): string[] {
  const gold = opts?.gold ?? theme.accent;
  const amber = opts?.amber ?? theme.accentSoft;
  const bronze = opts?.bronze ?? ((t: string) => chalk.hex("#CC7722")(t));
  const raw = buildShieldArt();
  return raw.map((line, i) => {
    if (i <= 1) return gold(line);
    if (i <= 2) return amber(line);
    return bronze(line);
  });
}

/**
 * Pad a string (possibly with ANSI codes) to exactly `width` visible chars.
 * Truncates if too long, pads with spaces if too short.
 */
export function padToWidth(text: string, width: number): string {
  const vis = visibleWidth(text);
  if (vis >= width) {
    return truncateToWidth(text, width);
  }
  return text + " ".repeat(width - vis);
}

/**
 * Center a string within `width` visible columns.
 * Returns the padded string.
 */
export function centerInWidth(text: string, width: number): string {
  const vis = visibleWidth(text);
  if (vis >= width) {
    return truncateToWidth(text, width);
  }
  const left = Math.floor((width - vis) / 2);
  const right = width - vis - left;
  return " ".repeat(left) + text + " ".repeat(right);
}

// ── WelcomeScreen Component ────────────────────────────────────────

export type WelcomeScreenProps = {
  version: string;
  getState: () => TuiStateAccess;
};

const MIN_TWO_COL_WIDTH = 70;

export class WelcomeScreen implements Component {
  private readonly version: string;
  private readonly getState: () => TuiStateAccess;

  constructor(props: WelcomeScreenProps) {
    this.version = props.version;
    this.getState = props.getState;
  }

  invalidate(): void {
    // no cache
  }

  render(width: number): string[] {
    if (width < MIN_TWO_COL_WIDTH) {
      return this.renderSingleColumn(width);
    }
    return this.renderTwoColumn(width);
  }

  // ── two-column layout ──────────────────────────────────────────

  private renderTwoColumn(width: number): string[] {
    const innerWidth = Math.max(40, width - 2); // minus border chars
    const rightWidth = Math.max(20, Math.floor(innerWidth * 0.4));
    const leftWidth = innerWidth - rightWidth - 1; // -1 for divider

    const border = theme.border;
    const accent = theme.accent;
    const dim = theme.dim;
    const fg = theme.fg;
    const bold = theme.bold;

    const hBar = "─";
    const vBar = "│";
    const tl = "╭";
    const tr = "╮";
    const bl = "╰";
    const br = "╯";
    // Build left column content
    const shieldLines = colorShieldArt();
    const state = this.getState();
    const model = state.sessionInfo.model ?? "unknown";
    const agent = `agent:${state.currentAgentId}`;
    const cwd = this.shortenPath(process.cwd());

    const leftContent: string[] = [
      "", // top padding
      ...shieldLines.map((l) => centerInWidth(l, leftWidth)),
      "",
      centerInWidth(bold(accent("Welcome to Mayros")), leftWidth),
      "",
      centerInWidth(dim(`${model} · ${agent}`), leftWidth),
      centerInWidth(dim(cwd), leftWidth),
    ];

    // Build right column content
    const tipHeader = bold(accent("Quick Start"));
    const tips = [
      ["/help", "all commands"],
      ["/agents", "switch agents"],
      ["Ctrl+V", "paste images"],
      ["Esc", "abort run"],
    ];

    const sessionHeader = bold(accent("Session"));
    const sessionKey = state.currentSessionKey || `agent:${state.currentAgentId}:main`;

    const tipKeyWidth = 8;
    const formatTip = (key: string, desc: string) => {
      const paddedKey = key + " ".repeat(Math.max(0, tipKeyWidth - key.length));
      return `${fg(paddedKey)} ${dim(desc)}`;
    };

    const rightContent: string[] = [
      "", // top padding
      "",
      tipHeader,
      ...tips.map(([key, desc]) => formatTip(key!, desc!)),
      "",
      sessionHeader,
      dim(sessionKey),
    ];

    // Normalize heights
    const maxRows = Math.max(leftContent.length, rightContent.length);
    while (leftContent.length < maxRows) leftContent.push("");
    while (rightContent.length < maxRows) rightContent.push("");

    // Compose lines
    const lines: string[] = [];

    // Top border: ╭─ Mayros v{version} ─...─╮
    const title = ` Mayros v${this.version} `;
    const titleLen = title.length;
    const remainingTop = innerWidth - 1 - titleLen; // -1 for initial ─
    const topBar =
      border(tl + hBar) + bold(accent(title)) + border(hBar.repeat(Math.max(0, remainingTop)) + tr);
    lines.push(topBar);

    // Content rows
    for (let i = 0; i < maxRows; i++) {
      const leftCell = padToWidth(leftContent[i] ?? "", leftWidth);
      const rightCell = padToWidth(rightContent[i] ?? "", rightWidth);
      lines.push(border(vBar) + leftCell + border(vBar) + rightCell + border(vBar));
    }

    // Bottom border: ╰─...─╯
    const bottomBar = border(bl + hBar.repeat(innerWidth) + br);
    lines.push(bottomBar);

    return ["", ...lines, ""];
  }

  // ── single-column layout ───────────────────────────────────────

  private renderSingleColumn(width: number): string[] {
    const border = theme.border;
    const accent = theme.accent;
    const dim = theme.dim;
    const fg = theme.fg;
    const bold = theme.bold;
    const innerWidth = Math.max(10, width - 2);

    const hBar = "─";
    const tl = "╭";
    const tr = "╮";
    const bl = "╰";
    const br = "╯";
    const vBar = "│";

    const shieldLines = colorShieldArt();
    const state = this.getState();
    const model = state.sessionInfo.model ?? "unknown";
    const agent = `agent:${state.currentAgentId}`;
    const cwd = this.shortenPath(process.cwd());

    const lines: string[] = [];

    // Top border
    const title = ` Mayros v${this.version} `;
    const remaining = innerWidth - 1 - title.length;
    lines.push(
      border(tl + hBar) + bold(accent(title)) + border(hBar.repeat(Math.max(0, remaining)) + tr),
    );

    // Fox + info
    const contentLines = [
      "",
      ...shieldLines.map((l) => centerInWidth(l, innerWidth)),
      "",
      centerInWidth(bold(accent("Welcome to Mayros")), innerWidth),
      "",
      centerInWidth(dim(`${model} · ${agent}`), innerWidth),
      centerInWidth(dim(cwd), innerWidth),
      "",
      padToWidth(`  ${fg("/help")}  ${dim("all commands")}`, innerWidth),
      padToWidth(`  ${fg("/agents")}  ${dim("switch agents")}`, innerWidth),
      "",
    ];

    for (const line of contentLines) {
      lines.push(border(vBar) + padToWidth(line, innerWidth) + border(vBar));
    }

    // Bottom border
    lines.push(border(bl + hBar.repeat(innerWidth) + br));

    return ["", ...lines, ""];
  }

  private shortenPath(fullPath: string): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "";
    if (home && fullPath.startsWith(home)) {
      return "~" + fullPath.slice(home.length);
    }
    return fullPath;
  }
}

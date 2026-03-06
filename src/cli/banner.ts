import { resolveCommitHash } from "../infra/git-commit.js";
import { visibleWidth } from "../terminal/ansi.js";
import { isRich, theme } from "../terminal/theme.js";
import { hasRootVersionAlias } from "./argv.js";
import { pickTagline, type TaglineOptions } from "./tagline.js";

type BannerOptions = TaglineOptions & {
  argv?: string[];
  commit?: string | null;
  columns?: number;
  richTty?: boolean;
};

let bannerEmitted = false;

const graphemeSegmenter =
  typeof Intl !== "undefined" && "Segmenter" in Intl
    ? new Intl.Segmenter(undefined, { granularity: "grapheme" })
    : null;

function splitGraphemes(value: string): string[] {
  if (!graphemeSegmenter) {
    return Array.from(value);
  }
  try {
    return Array.from(graphemeSegmenter.segment(value), (seg) => seg.segment);
  } catch {
    return Array.from(value);
  }
}

const hasJsonFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--json" || arg.startsWith("--json="));

const hasVersionFlag = (argv: string[]) =>
  argv.some((arg) => arg === "--version" || arg === "-V") || hasRootVersionAlias(argv);

export function formatCliBannerLine(version: string, options: BannerOptions = {}): string {
  const commit = options.commit ?? resolveCommitHash({ env: options.env });
  const commitLabel = commit ?? "unknown";
  const tagline = pickTagline(options);
  const rich = options.richTty ?? isRich();
  const title = "⚡🛡️ Mayros";
  const prefix = "⚡🛡️ ";
  const columns = options.columns ?? process.stdout.columns ?? 120;
  const plainFullLine = `${title} ${version} (${commitLabel}) — ${tagline}`;
  const fitsOnOneLine = visibleWidth(plainFullLine) <= columns;
  if (rich) {
    if (fitsOnOneLine) {
      return `${theme.heading(title)} ${theme.info(version)} ${theme.muted(
        `(${commitLabel})`,
      )} ${theme.muted("—")} ${theme.accentDim(tagline)}`;
    }
    const line1 = `${theme.heading(title)} ${theme.info(version)} ${theme.muted(
      `(${commitLabel})`,
    )}`;
    const line2 = `${" ".repeat(prefix.length)}${theme.accentDim(tagline)}`;
    return `${line1}\n${line2}`;
  }
  if (fitsOnOneLine) {
    return plainFullLine;
  }
  const line1 = `${title} ${version} (${commitLabel})`;
  const line2 = `${" ".repeat(prefix.length)}${tagline}`;
  return `${line1}\n${line2}`;
}

// Mayros pixel avatar — gold(G) orange(O) dark(D) face
// Rendered with ANSI colors in formatCliBannerArt()
const MAYROS_AVATAR = [
  "          ▄▄██████▄▄          ",
  "        ██▓▓▓▓▓▓▓▓▓▓██        ",
  "      ██▓▓▓▓▓▓▓▓▓▓▓▓▓▓██      ",
  "    ██▓▓██████████████▓▓██    ",
  "  ▄▄▓▓██              ██▓▓▄▄  ",
  "  ██░░██    ▓▓    ▓▓    ██░░██  ",
  "  ██░░██              ██░░██  ",
  "  ▀▀▓▓██    ╰━━╯    ██▓▓▀▀  ",
  "    ██▓▓██████████████▓▓██    ",
  "      ██░░░░░░░░░░░░░░██      ",
  "        ██░░░░░░░░░░██        ",
  "          ▀▀██████▀▀          ",
];

export function formatCliBannerArt(options: BannerOptions = {}): string {
  const rich = options.richTty ?? isRich();
  const label = "        ⚡🛡️ MAYROS ⚡🛡️";
  if (!rich) {
    return [...MAYROS_AVATAR, label].join("\n");
  }

  // Gold = ▓▓ parts (helmet/frame), Orange = ░░ (chin/sides)
  // Dark = ██ inside face, █/▀/▄ = outline
  const colorChar = (ch: string, _idx: number, line: string, charIdx: number) => {
    // Detect context: ▓▓ = gold, ░░ = orange, ██ inside = dark face
    if (ch === "▓") return theme.accentBright(ch);
    if (ch === "░") return theme.accent(ch);
    if (ch === "█" || ch === "▄" || ch === "▀") return theme.muted(ch);
    if (ch === "╰" || ch === "━" || ch === "╯") return theme.accentBright(ch);
    if (ch === " " && charIdx > 4 && charIdx < line.length - 4) return ch;
    return ch;
  };

  const colored = MAYROS_AVATAR.map((line) => {
    return splitGraphemes(line)
      .map((ch, idx) => colorChar(ch, idx, line, idx))
      .join("");
  });
  const labelLine =
    theme.muted("        ") + theme.accent("⚡🛡️") + theme.info(" MAYROS ") + theme.accent("⚡🛡️");
  return [...colored, labelLine].join("\n");
}

export function emitCliBanner(version: string, options: BannerOptions = {}) {
  if (bannerEmitted) {
    return;
  }
  const argv = options.argv ?? process.argv;
  if (!process.stdout.isTTY) {
    return;
  }
  if (hasJsonFlag(argv)) {
    return;
  }
  if (hasVersionFlag(argv)) {
    return;
  }
  const line = formatCliBannerLine(version, options);
  process.stdout.write(`\n${line}\n\n`);
  bannerEmitted = true;
}

export function hasEmittedCliBanner(): boolean {
  return bannerEmitted;
}

export function resetBannerEmittedForTest(): void {
  bannerEmitted = false;
}

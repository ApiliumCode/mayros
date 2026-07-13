// Mayros palette tokens for CLI/UI theming. "mayros seam" == use this palette.
// Values are derived from the TUI dark palette (src/tui/theme/palettes.ts) so
// the CLI and the terminal UI share the same identity. Keep in sync with
// docs/cli/index.md (CLI palette section).
export const MAYROS_PALETTE = {
  accent: "#F6C453",
  accentBright: "#F2A65A",
  accentDim: "#C49A3E",
  info: "#F2A65A",
  success: "#7DD3A5",
  warn: "#F0C987",
  error: "#F97066",
  muted: "#7B7F87",
} as const;

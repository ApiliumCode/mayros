/** Built-in theme presets shipped with the TUI. */
export type BuiltinPreset =
  | "dark"
  | "light"
  | "high-contrast"
  | "colorblind-dark"
  | "colorblind-light"
  | "monochrome"
  | "dracula"
  | "github-dark"
  | "github-light"
  | "solarized-dark"
  | "solarized-light"
  | "atom-one-dark"
  | "ayu-dark";

/**
 * A theme preset name. Either a built-in or a custom theme loaded from
 * `~/.mayros/themes/*.json`. The string is resolved through the palette
 * registry (builtin switch → custom registry → dark fallback).
 */
export type ThemePreset = string;

export type Palette = {
  text: string;
  dim: string;
  accent: string;
  accentSoft: string;
  border: string;
  userBg: string;
  userText: string;
  systemText: string;
  toolPendingBg: string;
  toolSuccessBg: string;
  toolErrorBg: string;
  toolTitle: string;
  toolOutput: string;
  quote: string;
  quoteBorder: string;
  code: string;
  codeBlock: string;
  codeBorder: string;
  link: string;
  filePath: string;
  error: string;
  success: string;
};

export const DARK_PALETTE: Palette = {
  text: "#E8E3D5",
  dim: "#7B7F87",
  accent: "#F6C453",
  accentSoft: "#F2A65A",
  border: "#3C414B",
  userBg: "#2B2F36",
  userText: "#F3EEE0",
  systemText: "#9BA3B2",
  toolPendingBg: "#1F2A2F",
  toolSuccessBg: "#1E2D23",
  toolErrorBg: "#2F1F1F",
  toolTitle: "#F6C453",
  toolOutput: "#E1DACB",
  quote: "#8CC8FF",
  quoteBorder: "#3B4D6B",
  code: "#F0C987",
  codeBlock: "#1E232A",
  codeBorder: "#343A45",
  link: "#7DD3A5",
  filePath: "#87CEEB",
  error: "#F97066",
  success: "#7DD3A5",
};

export const LIGHT_PALETTE: Palette = {
  text: "#2C2C2C",
  dim: "#6B6B6B",
  accent: "#B8860B",
  accentSoft: "#CC7722",
  border: "#C0C0C0",
  userBg: "#F0F0F0",
  userText: "#1A1A1A",
  systemText: "#555555",
  toolPendingBg: "#E8F0F8",
  toolSuccessBg: "#E8F5E8",
  toolErrorBg: "#F8E8E8",
  toolTitle: "#B8860B",
  toolOutput: "#333333",
  quote: "#2266AA",
  quoteBorder: "#88AACC",
  code: "#8B4513",
  codeBlock: "#F5F5F5",
  codeBorder: "#D0D0D0",
  link: "#2E8B57",
  filePath: "#1E6091",
  error: "#CC3333",
  success: "#2E8B57",
};

export const HIGH_CONTRAST_PALETTE: Palette = {
  text: "#FFFFFF",
  dim: "#AAAAAA",
  accent: "#FFFF00",
  accentSoft: "#FF8800",
  border: "#888888",
  userBg: "#000033",
  userText: "#FFFFFF",
  systemText: "#CCCCCC",
  toolPendingBg: "#000044",
  toolSuccessBg: "#003300",
  toolErrorBg: "#440000",
  toolTitle: "#FFFF00",
  toolOutput: "#FFFFFF",
  quote: "#00CCFF",
  quoteBorder: "#0088CC",
  code: "#FFCC00",
  codeBlock: "#111111",
  codeBorder: "#666666",
  link: "#00FF88",
  filePath: "#00BFFF",
  error: "#FF4444",
  success: "#00FF88",
};

export const DRACULA_PALETTE: Palette = {
  text: "#F8F8F2",
  dim: "#6272A4",
  accent: "#BD93F9",
  accentSoft: "#FF79C6",
  border: "#44475A",
  userBg: "#282A36",
  userText: "#F8F8F2",
  systemText: "#6272A4",
  toolPendingBg: "#21222C",
  toolSuccessBg: "#1E2D23",
  toolErrorBg: "#3B1F2B",
  toolTitle: "#BD93F9",
  toolOutput: "#F8F8F2",
  quote: "#8BE9FD",
  quoteBorder: "#44475A",
  code: "#F1FA8C",
  codeBlock: "#21222C",
  codeBorder: "#44475A",
  link: "#8BE9FD",
  filePath: "#BD93F9",
  error: "#FF5555",
  success: "#50FA7B",
};

export const GITHUB_DARK_PALETTE: Palette = {
  text: "#C9D1D9",
  dim: "#8B949E",
  accent: "#58A6FF",
  accentSoft: "#79C0FF",
  border: "#30363D",
  userBg: "#0D1117",
  userText: "#C9D1D9",
  systemText: "#8B949E",
  toolPendingBg: "#0C1318",
  toolSuccessBg: "#0D1F14",
  toolErrorBg: "#1F0C0C",
  toolTitle: "#58A6FF",
  toolOutput: "#C9D1D9",
  quote: "#A5D6FF",
  quoteBorder: "#1F3044",
  code: "#FFA657",
  codeBlock: "#161B22",
  codeBorder: "#30363D",
  link: "#58A6FF",
  filePath: "#79C0FF",
  error: "#F85149",
  success: "#3FB950",
};

export const GITHUB_LIGHT_PALETTE: Palette = {
  text: "#24292F",
  dim: "#57606A",
  accent: "#0969DA",
  accentSoft: "#218BFF",
  border: "#D0D7DE",
  userBg: "#FFFFFF",
  userText: "#24292F",
  systemText: "#57606A",
  toolPendingBg: "#DDF4FF",
  toolSuccessBg: "#DAFBE1",
  toolErrorBg: "#FFEBE9",
  toolTitle: "#0969DA",
  toolOutput: "#24292F",
  quote: "#0550AE",
  quoteBorder: "#A8C8E8",
  code: "#953800",
  codeBlock: "#F6F8FA",
  codeBorder: "#D0D7DE",
  link: "#0969DA",
  filePath: "#0550AE",
  error: "#CF222E",
  success: "#1A7F37",
};

export const SOLARIZED_DARK_PALETTE: Palette = {
  text: "#839496",
  dim: "#586E75",
  accent: "#B58900",
  accentSoft: "#CB4B16",
  border: "#073642",
  userBg: "#002B36",
  userText: "#93A1A1",
  systemText: "#657B83",
  toolPendingBg: "#002731",
  toolSuccessBg: "#002B1A",
  toolErrorBg: "#2B0E00",
  toolTitle: "#B58900",
  toolOutput: "#839496",
  quote: "#2AA198",
  quoteBorder: "#073642",
  code: "#859900",
  codeBlock: "#073642",
  codeBorder: "#094959",
  link: "#268BD2",
  filePath: "#268BD2",
  error: "#DC322F",
  success: "#859900",
};

export const SOLARIZED_LIGHT_PALETTE: Palette = {
  text: "#657B83",
  dim: "#93A1A1",
  accent: "#B58900",
  accentSoft: "#CB4B16",
  border: "#EEE8D5",
  userBg: "#FDF6E3",
  userText: "#586E75",
  systemText: "#93A1A1",
  toolPendingBg: "#ECF1F5",
  toolSuccessBg: "#ECF5E8",
  toolErrorBg: "#F5E8E8",
  toolTitle: "#B58900",
  toolOutput: "#657B83",
  quote: "#2AA198",
  quoteBorder: "#EEE8D5",
  code: "#859900",
  codeBlock: "#EEE8D5",
  codeBorder: "#DDD6C1",
  link: "#268BD2",
  filePath: "#268BD2",
  error: "#DC322F",
  success: "#859900",
};

export const ATOM_ONE_DARK_PALETTE: Palette = {
  text: "#ABB2BF",
  dim: "#5C6370",
  accent: "#61AFEF",
  accentSoft: "#C678DD",
  border: "#3E4451",
  userBg: "#282C34",
  userText: "#ABB2BF",
  systemText: "#5C6370",
  toolPendingBg: "#21252B",
  toolSuccessBg: "#1D2A1D",
  toolErrorBg: "#2D1B1E",
  toolTitle: "#61AFEF",
  toolOutput: "#ABB2BF",
  quote: "#56B6C2",
  quoteBorder: "#3E4451",
  code: "#D19A66",
  codeBlock: "#21252B",
  codeBorder: "#3E4451",
  link: "#61AFEF",
  filePath: "#61AFEF",
  error: "#E06C75",
  success: "#98C379",
};

export const AYU_DARK_PALETTE: Palette = {
  text: "#B3B1AD",
  dim: "#5C6773",
  accent: "#FF8F40",
  accentSoft: "#E6B450",
  border: "#1D2530",
  userBg: "#0A0E14",
  userText: "#B3B1AD",
  systemText: "#5C6773",
  toolPendingBg: "#0D1119",
  toolSuccessBg: "#0D1A0F",
  toolErrorBg: "#1A0D0D",
  toolTitle: "#FF8F40",
  toolOutput: "#B3B1AD",
  quote: "#95E6CB",
  quoteBorder: "#1D2530",
  code: "#E6B450",
  codeBlock: "#0D1016",
  codeBorder: "#1D2530",
  link: "#39BAE6",
  filePath: "#39BAE6",
  error: "#FF3333",
  success: "#AAD94C",
};

/**
 * Colorblind-optimized dark palette using Okabe-Ito hues.
 * Avoids red/green pairing for error/success — error uses vermilion
 * (orange-red), success uses sky blue. Accent is amber.
 */
export const COLORBLIND_DARK_PALETTE: Palette = {
  text: "#E8E3D5",
  dim: "#7B7F87",
  accent: "#E69F00",
  accentSoft: "#F0E442",
  border: "#3C414B",
  userBg: "#2B2F36",
  userText: "#F3EEE0",
  systemText: "#9BA3B2",
  toolPendingBg: "#1F2A2F",
  toolSuccessBg: "#1E2D23",
  toolErrorBg: "#2F1F1F",
  toolTitle: "#E69F00",
  toolOutput: "#E1DACB",
  quote: "#56B4E9",
  quoteBorder: "#3B4D6B",
  code: "#F0E442",
  codeBlock: "#1E232A",
  codeBorder: "#343A45",
  link: "#56B4E9",
  filePath: "#56B4E9",
  error: "#D55E00",
  success: "#56B4E9",
};

/** Colorblind-optimized light palette (Okabe-Ito on light background). */
export const COLORBLIND_LIGHT_PALETTE: Palette = {
  text: "#2B2F36",
  dim: "#6B7080",
  accent: "#0072B2",
  accentSoft: "#009E73",
  border: "#D0D5DD",
  userBg: "#F0F1F3",
  userText: "#2B2F36",
  systemText: "#6B7080",
  toolPendingBg: "#EDF0F3",
  toolSuccessBg: "#E6F4EA",
  toolErrorBg: "#FCE8E6",
  toolTitle: "#0072B2",
  toolOutput: "#3C414B",
  quote: "#0072B2",
  quoteBorder: "#B8CCE0",
  code: "#D55E00",
  codeBlock: "#EDF0F3",
  codeBorder: "#D0D5DD",
  link: "#0072B2",
  filePath: "#0072B2",
  error: "#D55E00",
  success: "#0072B2",
};

/**
 * Monochrome palette — all tokens use the same foreground. Semantic
 * differentiation is lost (no color), useful for `NO_COLOR` environments
 * or users who prefer a minimal terminal.
 */
export const MONOCHROME_PALETTE: Palette = {
  text: "#FFFFFF",
  dim: "#AAAAAA",
  accent: "#FFFFFF",
  accentSoft: "#CCCCCC",
  border: "#888888",
  userBg: "#666666",
  userText: "#FFFFFF",
  systemText: "#CCCCCC",
  toolPendingBg: "#444444",
  toolSuccessBg: "#444444",
  toolErrorBg: "#444444",
  toolTitle: "#FFFFFF",
  toolOutput: "#CCCCCC",
  quote: "#CCCCCC",
  quoteBorder: "#888888",
  code: "#FFFFFF",
  codeBlock: "#333333",
  codeBorder: "#666666",
  link: "#FFFFFF",
  filePath: "#FFFFFF",
  error: "#FFFFFF",
  success: "#FFFFFF",
};

export const BUILTIN_THEME_PRESETS: BuiltinPreset[] = [
  "dark",
  "light",
  "high-contrast",
  "colorblind-dark",
  "colorblind-light",
  "monochrome",
  "dracula",
  "github-dark",
  "github-light",
  "solarized-dark",
  "solarized-light",
  "atom-one-dark",
  "ayu-dark",
];

/** Backward-compatible alias for the built-in preset list. */
export const THEME_PRESETS: BuiltinPreset[] = BUILTIN_THEME_PRESETS;

// --- Custom theme registry -------------------------------------------------

/** Registry of custom palettes loaded from `~/.mayros/themes/*.json`. */
const customPaletteRegistry = new Map<string, Palette>();

/** Register a custom palette under a name. */
export function registerCustomPalette(name: string, palette: Palette): void {
  customPaletteRegistry.set(name, palette);
}

/** Clear all custom palettes (used by the theme loader before re-scanning). */
export function clearCustomPalettes(): void {
  customPaletteRegistry.clear();
}

/** List all currently registered custom theme names. */
export function listCustomThemeNames(): string[] {
  return [...customPaletteRegistry.keys()];
}

export function resolvePalette(preset: ThemePreset): Palette {
  switch (preset) {
    case "light":
      return LIGHT_PALETTE;
    case "high-contrast":
      return HIGH_CONTRAST_PALETTE;
    case "colorblind-dark":
      return COLORBLIND_DARK_PALETTE;
    case "colorblind-light":
      return COLORBLIND_LIGHT_PALETTE;
    case "monochrome":
      return MONOCHROME_PALETTE;
    case "dracula":
      return DRACULA_PALETTE;
    case "github-dark":
      return GITHUB_DARK_PALETTE;
    case "github-light":
      return GITHUB_LIGHT_PALETTE;
    case "solarized-dark":
      return SOLARIZED_DARK_PALETTE;
    case "solarized-light":
      return SOLARIZED_LIGHT_PALETTE;
    case "atom-one-dark":
      return ATOM_ONE_DARK_PALETTE;
    case "ayu-dark":
      return AYU_DARK_PALETTE;
    default: {
      const custom = customPaletteRegistry.get(preset);
      if (custom) return custom;
      return DARK_PALETTE;
    }
  }
}

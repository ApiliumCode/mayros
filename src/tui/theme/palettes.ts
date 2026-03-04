export type ThemePreset = "dark" | "light" | "high-contrast";

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
  error: "#FF4444",
  success: "#00FF88",
};

export const THEME_PRESETS: ThemePreset[] = ["dark", "light", "high-contrast"];

export function resolvePalette(preset: ThemePreset): Palette {
  switch (preset) {
    case "light":
      return LIGHT_PALETTE;
    case "high-contrast":
      return HIGH_CONTRAST_PALETTE;
    default:
      return DARK_PALETTE;
  }
}

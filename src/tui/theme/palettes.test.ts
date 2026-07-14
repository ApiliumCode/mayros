import { describe, it, expect } from "vitest";
import { resolvePalette, THEME_PRESETS, type ThemePreset, type Palette } from "./palettes.js";

const PALETTE_KEYS: (keyof Palette)[] = [
  "text",
  "dim",
  "accent",
  "accentSoft",
  "border",
  "userBg",
  "userText",
  "systemText",
  "toolPendingBg",
  "toolSuccessBg",
  "toolErrorBg",
  "toolTitle",
  "toolOutput",
  "quote",
  "quoteBorder",
  "code",
  "codeBlock",
  "codeBorder",
  "link",
  "filePath",
  "error",
  "success",
];

describe("Theme Palettes", () => {
  it("has the expected number of theme presets", () => {
    expect(THEME_PRESETS).toHaveLength(13);
  });

  it("includes all expected presets", () => {
    expect(THEME_PRESETS).toContain("dark");
    expect(THEME_PRESETS).toContain("dracula");
    expect(THEME_PRESETS).toContain("github-dark");
    expect(THEME_PRESETS).toContain("github-light");
    expect(THEME_PRESETS).toContain("solarized-dark");
    expect(THEME_PRESETS).toContain("solarized-light");
    expect(THEME_PRESETS).toContain("atom-one-dark");
    expect(THEME_PRESETS).toContain("ayu-dark");
    expect(THEME_PRESETS).toContain("colorblind-dark");
    expect(THEME_PRESETS).toContain("colorblind-light");
    expect(THEME_PRESETS).toContain("monochrome");
  });

  for (const preset of [
    "dark",
    "light",
    "high-contrast",
    "dracula",
    "github-dark",
    "github-light",
    "solarized-dark",
    "solarized-light",
    "atom-one-dark",
    "ayu-dark",
  ] as ThemePreset[]) {
    it(`resolvePalette("${preset}") has all 22 keys`, () => {
      const palette = resolvePalette(preset);
      for (const key of PALETTE_KEYS) {
        expect(palette[key]).toBeDefined();
        expect(typeof palette[key]).toBe("string");
        expect(palette[key].length).toBeGreaterThan(0);
      }
    });
  }

  it("default preset falls back to dark", () => {
    const unknown = resolvePalette("nonexistent" as ThemePreset);
    const dark = resolvePalette("dark");
    expect(unknown).toEqual(dark);
  });

  it("all palettes have valid hex colors", () => {
    for (const preset of THEME_PRESETS) {
      const palette = resolvePalette(preset);
      for (const [key, value] of Object.entries(palette)) {
        expect(value, `${preset}.${key} should be hex color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

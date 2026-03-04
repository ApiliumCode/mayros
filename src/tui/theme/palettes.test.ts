import { describe, expect, it } from "vitest";
import {
  DARK_PALETTE,
  HIGH_CONTRAST_PALETTE,
  LIGHT_PALETTE,
  THEME_PRESETS,
  resolvePalette,
} from "./palettes.js";

describe("palettes", () => {
  it("resolves dark preset", () => {
    expect(resolvePalette("dark")).toBe(DARK_PALETTE);
  });

  it("resolves light preset", () => {
    expect(resolvePalette("light")).toBe(LIGHT_PALETTE);
  });

  it("resolves high-contrast preset", () => {
    expect(resolvePalette("high-contrast")).toBe(HIGH_CONTRAST_PALETTE);
  });

  it("lists all preset names", () => {
    expect(THEME_PRESETS).toEqual(["dark", "light", "high-contrast"]);
  });

  it("all palettes have the same keys", () => {
    const darkKeys = Object.keys(DARK_PALETTE).sort();
    expect(Object.keys(LIGHT_PALETTE).sort()).toEqual(darkKeys);
    expect(Object.keys(HIGH_CONTRAST_PALETTE).sort()).toEqual(darkKeys);
  });

  it("palette values are valid hex colors", () => {
    for (const palette of [DARK_PALETTE, LIGHT_PALETTE, HIGH_CONTRAST_PALETTE]) {
      for (const [key, value] of Object.entries(palette)) {
        expect(value, `${key} should be hex color`).toMatch(/^#[0-9A-Fa-f]{6}$/);
      }
    }
  });
});

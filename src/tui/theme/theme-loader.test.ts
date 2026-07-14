import { describe, expect, it } from "vitest";
import { validatePalette } from "./theme-loader.js";
import type { Palette } from "./palettes.js";

/**
 * Theme loader unit tests.
 *
 * The discoverCustomThemes function hits the filesystem and is tested
 * implicitly via integration; these tests cover the pure validation logic
 * that gates which JSON files become registered palettes.
 */

const VALID_PALETTE: Palette = {
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

describe("validatePalette", () => {
  it("accepts a valid palette with all 22 hex tokens", () => {
    expect(validatePalette(VALID_PALETTE)).not.toBeNull();
  });

  it("rejects null", () => {
    expect(validatePalette(null)).toBeNull();
  });

  it("rejects a non-object", () => {
    expect(validatePalette("not a palette")).toBeNull();
  });

  it("rejects a palette missing a key", () => {
    const incomplete = { ...VALID_PALETTE } as Partial<Palette>;
    delete incomplete.success;
    expect(validatePalette(incomplete)).toBeNull();
  });

  it("rejects a palette with a non-hex color", () => {
    const bad = { ...VALID_PALETTE, accent: "red" };
    expect(validatePalette(bad)).toBeNull();
  });

  it("rejects a palette with a 3-digit hex", () => {
    const bad = { ...VALID_PALETTE, accent: "#F63" };
    expect(validatePalette(bad)).toBeNull();
  });

  it("accepts lowercase hex", () => {
    const lower = { ...VALID_PALETTE, accent: "#f6c453" };
    expect(validatePalette(lower)).not.toBeNull();
  });
});

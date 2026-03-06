import { describe, expect, it, vi } from "vitest";

const cliHighlightMocks = vi.hoisted(() => ({
  highlight: vi.fn((code: string) => code),
  supportsLanguage: vi.fn((_lang: string) => true),
}));

vi.mock("cli-highlight", () => cliHighlightMocks);

const { createThemeSet } = await import("./theme-factory.js");
const { DARK_PALETTE, LIGHT_PALETTE } = await import("./palettes.js");

const stripAnsi = (str: string) =>
  str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

describe("createThemeSet", () => {
  it("returns all expected keys", () => {
    const set = createThemeSet(DARK_PALETTE);
    expect(set).toHaveProperty("theme");
    expect(set).toHaveProperty("markdownTheme");
    expect(set).toHaveProperty("editorTheme");
    expect(set).toHaveProperty("selectListTheme");
    expect(set).toHaveProperty("filterableSelectListTheme");
    expect(set).toHaveProperty("settingsListTheme");
    expect(set).toHaveProperty("searchableSelectListTheme");
  });

  it("theme functions produce text with correct content", () => {
    const set = createThemeSet(DARK_PALETTE);
    const styled = set.theme.accent("hello");
    expect(stripAnsi(styled)).toBe("hello");
  });

  it("assistantText is identity", () => {
    const set = createThemeSet(DARK_PALETTE);
    expect(set.theme.assistantText("test")).toBe("test");
  });

  it("creates independent themes for different palettes", () => {
    const dark = createThemeSet(DARK_PALETTE);
    const light = createThemeSet(LIGHT_PALETTE);
    expect(dark.theme.accent).not.toBe(light.theme.accent);
    expect(stripAnsi(dark.theme.accent("x"))).toBe("x");
    expect(stripAnsi(light.theme.accent("x"))).toBe("x");
  });

  it("highlightCode falls back gracefully", () => {
    cliHighlightMocks.highlight.mockImplementation(() => {
      throw new Error("fail");
    });
    const set = createThemeSet(DARK_PALETTE);
    const result = set.markdownTheme.highlightCode!("code", "js");
    expect(result).toHaveLength(1);
    expect(stripAnsi(result[0] ?? "")).toBe("code");
  });

  it("selectListTheme functions produce output", () => {
    const set = createThemeSet(DARK_PALETTE);
    expect(stripAnsi(set.selectListTheme.selectedPrefix(">"))).toBe(">");
    expect(stripAnsi(set.selectListTheme.selectedText("item"))).toBe("item");
  });

  it("theme.filePath is a function", () => {
    const set = createThemeSet(DARK_PALETTE);
    expect(typeof set.theme.filePath).toBe("function");
    const styled = set.theme.filePath("src/foo.ts");
    expect(stripAnsi(styled)).toBe("src/foo.ts");
  });

  it("markdownTheme.link detects autolinks (URL text)", () => {
    const set = createThemeSet(DARK_PALETTE);
    const result = set.markdownTheme.link("https://example.com");
    // Without TTY it falls back, but the URL should be in the output
    expect(result).toContain("https://example.com");
  });

  it("markdownTheme.link leaves non-URL text as colored text", () => {
    const set = createThemeSet(DARK_PALETTE);
    const result = set.markdownTheme.link("click here");
    // Should NOT contain OSC 8 (not a URL)
    expect(result).not.toContain("\x1b]8;;");
    expect(stripAnsi(result)).toBe("click here");
  });

  it("markdownTheme.linkUrl extracts URL from parenthesized format", () => {
    const set = createThemeSet(DARK_PALETTE);
    const result = set.markdownTheme.linkUrl(" (https://example.com)");
    // Without TTY it falls back but URL should be preserved
    expect(result).toContain("https://example.com");
  });

  it("markdownTheme.linkUrl falls back for non-URL text", () => {
    const set = createThemeSet(DARK_PALETTE);
    const result = set.markdownTheme.linkUrl(" (not a url)");
    expect(result).not.toContain("\x1b]8;;");
  });
});

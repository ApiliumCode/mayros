import { DARK_PALETTE, resolvePalette } from "./palettes.js";
import type { ThemePreset } from "./palettes.js";
import { createThemeSet } from "./theme-factory.js";

let currentPreset: ThemePreset = "dark";
let current = createThemeSet(DARK_PALETTE);

export function setThemePreset(preset: ThemePreset): void {
  currentPreset = preset;
  const palette = resolvePalette(preset);
  const next = createThemeSet(palette);
  // Mutate the exported objects so existing references stay valid.
  Object.assign(theme, next.theme);
  Object.assign(markdownTheme, next.markdownTheme);
  Object.assign(selectListTheme, next.selectListTheme);
  Object.assign(filterableSelectListTheme, next.filterableSelectListTheme);
  Object.assign(settingsListTheme, next.settingsListTheme);
  Object.assign(editorTheme, next.editorTheme);
  Object.assign(searchableSelectListTheme, next.searchableSelectListTheme);
}

export function getThemePreset(): ThemePreset {
  return currentPreset;
}

export const theme = { ...current.theme };
export const markdownTheme = { ...current.markdownTheme };
export const selectListTheme = { ...current.selectListTheme };
export const filterableSelectListTheme = { ...current.filterableSelectListTheme };
export const settingsListTheme = { ...current.settingsListTheme };
export const editorTheme = { ...current.editorTheme };
export const searchableSelectListTheme = { ...current.searchableSelectListTheme };

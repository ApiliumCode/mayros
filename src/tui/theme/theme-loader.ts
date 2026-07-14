/**
 * Custom theme loader.
 *
 * Discovers user-defined theme palettes from `~/.mayros/themes/*.json` and
 * registers them so they can be selected via `/theme <name>` or configured
 * as `config.ui.theme = "<name>"`. Each file must contain a JSON object with
 * the 22 palette color tokens (all `#RRGGBB` hex strings).
 *
 * The loader caches by file mtime and rescans on demand, mirroring the
 * markdown-commands discovery pattern.
 */

import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { resolveStateDir } from "../../config/paths.js";
import {
  clearCustomPalettes,
  listCustomThemeNames,
  registerCustomPalette,
  type Palette,
} from "./palettes.js";

const HEX_COLOR = /^#[0-9A-Fa-f]{6}$/;

const PALETTE_KEYS: ReadonlyArray<keyof Palette> = [
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

/** Cache entry: the parsed palette + the file mtime that produced it. */
type CacheEntry = { palette: Palette; mtimeMs: number };

const cache = new Map<string, CacheEntry>();
let lastScanMtime = 0;

/** Resolve the user themes directory (`~/.mayros/themes`). */
export function resolveUserThemesDir(): string {
  return path.join(resolveStateDir(), "themes");
}

/** Validate that a value is a valid palette object with all 22 hex tokens. */
export function validatePalette(value: unknown): Palette | null {
  if (typeof value !== "object" || value === null) return null;
  const obj = value as Record<string, unknown>;
  const palette = {} as Palette;
  for (const key of PALETTE_KEYS) {
    const val = obj[key];
    if (typeof val !== "string" || !HEX_COLOR.test(val)) return null;
    palette[key] = val;
  }
  return palette;
}

/**
 * Scan `~/.mayros/themes/*.json`, validate each file, and register valid
 * palettes. Returns the list of names that were registered. Invalid files
 * are silently skipped (best-effort, like other config discovery).
 */
export async function discoverCustomThemes(): Promise<string[]> {
  const dir = resolveUserThemesDir();
  let entries: import("node:fs").Dirent[];
  try {
    const { readdir } = await import("node:fs/promises");
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    // Directory doesn't exist or is unreadable — no custom themes.
    clearCustomPalettes();
    cache.clear();
    return [];
  }

  // Track the newest mtime to know if a rescan is needed.
  let newestMtime = 0;
  const validFiles = entries.filter((e) => e.isFile() && e.name.endsWith(".json"));

  // Clear and re-register from scratch (simplest correct approach).
  clearCustomPalettes();
  const registered: string[] = [];

  for (const entry of validFiles) {
    const filePath = path.join(dir, entry.name);
    const themeName = entry.name.slice(0, -5); // strip .json

    try {
      const stats = await stat(filePath);
      newestMtime = Math.max(newestMtime, stats.mtimeMs);

      // Use cache if the file hasn't changed.
      const cached = cache.get(themeName);
      if (cached && cached.mtimeMs === stats.mtimeMs) {
        registerCustomPalette(themeName, cached.palette);
        registered.push(themeName);
        continue;
      }

      const content = await readFile(filePath, "utf8");
      const parsed: unknown = JSON.parse(content);
      const palette = validatePalette(parsed);
      if (palette) {
        cache.set(themeName, { palette, mtimeMs: stats.mtimeMs });
        registerCustomPalette(themeName, palette);
        registered.push(themeName);
      }
    } catch {
      // Invalid JSON, unreadable file, or validation failure — skip.
    }
  }

  // Clean stale cache entries for files that no longer exist.
  const validNames = new Set(registered);
  for (const name of cache.keys()) {
    if (!validNames.has(name)) cache.delete(name);
  }

  lastScanMtime = newestMtime;
  return registered;
}

/** List all theme names available: builtins + custom. */
export function allThemeNames(builtins: readonly string[]): string[] {
  return [...builtins, ...listCustomThemeNames()];
}

/** Check if a rescan is needed by comparing directory mtime. */
export function needsRescan(): boolean {
  return lastScanMtime === 0;
}

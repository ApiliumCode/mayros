/**
 * ManagedSettingsLoader — Enterprise managed settings hierarchy.
 *
 * Hierarchy (descending priority):
 * 1. Enterprise managed (enforced) — can't be overridden
 * 2. User config — user editable
 * 3. Project config — project-level
 * 4. Runtime defaults — hardcoded
 *
 * Managed settings file: ~/.mayros/managed-settings.json
 */

import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { resolveRequiredHomeDir } from "../infra/home-dir.js";
import { isBlockedObjectKey } from "./prototype-keys.js";

export type ManagedSettingsFile = {
  version: 1;
  enforced: Record<string, unknown>;
  defaults: Record<string, unknown>;
  lockedKeys: string[];
};

export type ManagedSettingsResult = {
  hasManaged: boolean;
  enforced: Record<string, unknown>;
  defaults: Record<string, unknown>;
  lockedKeys: Set<string>;
};

const MANAGED_SETTINGS_FILENAME = "managed-settings.json";

/**
 * Deep merge two objects (patch into base).
 * null values in patch delete the key.
 */
function deepMerge(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const result: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (isBlockedObjectKey(key)) continue;
    if (value === null || value === undefined) {
      delete result[key];
    } else if (
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof result[key] === "object" &&
      result[key] !== null &&
      !Array.isArray(result[key])
    ) {
      result[key] = deepMerge(
        result[key] as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Get a nested value by dot-path from an object.
 */
function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const keys = path.split(".");
  let current: unknown = obj;
  for (const key of keys) {
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/**
 * Set a nested value by dot-path in an object.
 */
function setByPath(obj: Record<string, unknown>, path: string, value: unknown): void {
  const keys = path.split(".");
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    const key = keys[i];
    if (typeof current[key] !== "object" || current[key] === null) {
      current[key] = {};
    }
    current = current[key] as Record<string, unknown>;
  }
  current[keys[keys.length - 1]] = value;
}

/**
 * Resolve the path to the managed settings file.
 */
export function resolveManagedSettingsPath(env?: Record<string, string | undefined>): string {
  const homeDir = resolveRequiredHomeDir(env);
  return join(homeDir, ".mayros", MANAGED_SETTINGS_FILENAME);
}

/**
 * Load managed settings from disk.
 */
export function loadManagedSettings(settingsPath?: string): ManagedSettingsResult {
  const path = settingsPath ?? resolveManagedSettingsPath();

  if (!existsSync(path)) {
    return {
      hasManaged: false,
      enforced: {},
      defaults: {},
      lockedKeys: new Set(),
    };
  }

  try {
    const raw = readFileSync(path, "utf-8");
    const parsed = JSON.parse(raw) as Partial<ManagedSettingsFile>;

    // Validate version
    if (parsed.version !== 1) {
      return {
        hasManaged: false,
        enforced: {},
        defaults: {},
        lockedKeys: new Set(),
      };
    }

    return {
      hasManaged: true,
      enforced:
        parsed.enforced && typeof parsed.enforced === "object"
          ? (parsed.enforced as Record<string, unknown>)
          : {},
      defaults:
        parsed.defaults && typeof parsed.defaults === "object"
          ? (parsed.defaults as Record<string, unknown>)
          : {},
      lockedKeys: new Set(
        Array.isArray(parsed.lockedKeys)
          ? parsed.lockedKeys.filter((k): k is string => typeof k === "string")
          : [],
      ),
    };
  } catch {
    return {
      hasManaged: false,
      enforced: {},
      defaults: {},
      lockedKeys: new Set(),
    };
  }
}

/**
 * Apply managed settings to a user config.
 *
 * 1. Merge defaults under the user config (user wins)
 * 2. Overlay enforced on top (enforced wins)
 */
export function applyManagedSettings(
  userConfig: Record<string, unknown>,
  managed: ManagedSettingsResult,
): Record<string, unknown> {
  if (!managed.hasManaged) return userConfig;

  // Step 1: defaults as base, user config on top
  let result = deepMerge(managed.defaults, userConfig);

  // Step 2: enforced on top of everything
  result = deepMerge(result, managed.enforced);

  return result;
}

/**
 * Check if a config key is locked by managed settings.
 */
export function isKeyLocked(key: string, managed: ManagedSettingsResult): boolean {
  if (!managed.hasManaged) return false;

  // Direct match
  if (managed.lockedKeys.has(key)) return true;

  // Check if any parent path is locked
  const parts = key.split(".");
  for (let i = 1; i < parts.length; i++) {
    const parentPath = parts.slice(0, i).join(".");
    if (managed.lockedKeys.has(parentPath)) return true;
  }

  // Check if the key is set in enforced (only leaf values lock the key;
  // intermediate objects allow sub-keys to be individually unlocked)
  const enforcedValue = getByPath(managed.enforced, key);
  if (enforcedValue !== undefined) {
    return (
      typeof enforcedValue !== "object" || enforcedValue === null || Array.isArray(enforcedValue)
    );
  }
  return false;
}

/**
 * Filter out locked keys from a config write patch.
 * Returns the filtered patch and a list of blocked keys.
 */
export function filterLockedKeys(
  patch: Record<string, unknown>,
  managed: ManagedSettingsResult,
  prefix: string = "",
): { filtered: Record<string, unknown>; blockedKeys: string[] } {
  const filtered: Record<string, unknown> = {};
  const blockedKeys: string[] = [];

  for (const [key, value] of Object.entries(patch)) {
    const fullKey = prefix ? `${prefix}.${key}` : key;

    if (isKeyLocked(fullKey, managed)) {
      blockedKeys.push(fullKey);
      continue;
    }

    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const nested = filterLockedKeys(value as Record<string, unknown>, managed, fullKey);
      if (Object.keys(nested.filtered).length > 0) {
        filtered[key] = nested.filtered;
      }
      blockedKeys.push(...nested.blockedKeys);
    } else {
      filtered[key] = value;
    }
  }

  return { filtered, blockedKeys };
}

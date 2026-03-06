import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  loadManagedSettings,
  applyManagedSettings,
  isKeyLocked,
  filterLockedKeys,
  type ManagedSettingsResult,
} from "./managed-settings.js";

describe("loadManagedSettings", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "managed-test-"));
  });

  afterEach(() => {
    try {
      rmSync(tempDir, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });

  it("returns empty result when file does not exist", () => {
    const result = loadManagedSettings(join(tempDir, "nonexistent.json"));
    expect(result.hasManaged).toBe(false);
    expect(result.enforced).toEqual({});
    expect(result.defaults).toEqual({});
    expect(result.lockedKeys.size).toBe(0);
  });

  it("loads valid managed settings", () => {
    const settingsPath = join(tempDir, "managed.json");
    writeFileSync(
      settingsPath,
      JSON.stringify({
        version: 1,
        enforced: { auth: { provider: "okta" } },
        defaults: { ui: { theme: "dark" } },
        lockedKeys: ["auth.provider", "security.level"],
      }),
    );
    const result = loadManagedSettings(settingsPath);
    expect(result.hasManaged).toBe(true);
    expect(result.enforced).toEqual({ auth: { provider: "okta" } });
    expect(result.defaults).toEqual({ ui: { theme: "dark" } });
    expect(result.lockedKeys.has("auth.provider")).toBe(true);
    expect(result.lockedKeys.has("security.level")).toBe(true);
  });

  it("rejects invalid version", () => {
    const settingsPath = join(tempDir, "managed.json");
    writeFileSync(settingsPath, JSON.stringify({ version: 2, enforced: {}, defaults: {} }));
    const result = loadManagedSettings(settingsPath);
    expect(result.hasManaged).toBe(false);
  });

  it("handles malformed JSON gracefully", () => {
    const settingsPath = join(tempDir, "managed.json");
    writeFileSync(settingsPath, "not json{{{");
    const result = loadManagedSettings(settingsPath);
    expect(result.hasManaged).toBe(false);
  });

  it("handles missing fields gracefully", () => {
    const settingsPath = join(tempDir, "managed.json");
    writeFileSync(settingsPath, JSON.stringify({ version: 1 }));
    const result = loadManagedSettings(settingsPath);
    expect(result.hasManaged).toBe(true);
    expect(result.enforced).toEqual({});
    expect(result.defaults).toEqual({});
    expect(result.lockedKeys.size).toBe(0);
  });
});

describe("applyManagedSettings", () => {
  it("returns user config when no managed settings", () => {
    const userConfig = { ui: { theme: "light" } };
    const managed: ManagedSettingsResult = {
      hasManaged: false,
      enforced: {},
      defaults: {},
      lockedKeys: new Set(),
    };
    const result = applyManagedSettings(userConfig, managed);
    expect(result).toEqual(userConfig);
  });

  it("applies defaults under user config", () => {
    const userConfig = { ui: { theme: "light" } };
    const managed: ManagedSettingsResult = {
      hasManaged: true,
      enforced: {},
      defaults: { ui: { theme: "dark", vim: true }, logging: { level: "info" } },
      lockedKeys: new Set(),
    };
    const result = applyManagedSettings(userConfig, managed);
    // User's theme should win over default
    expect((result.ui as Record<string, unknown>).theme).toBe("light");
    // Default vim should be applied
    expect((result.ui as Record<string, unknown>).vim).toBe(true);
    // Default logging should be applied
    expect((result.logging as Record<string, unknown>).level).toBe("info");
  });

  it("enforced overrides user config", () => {
    const userConfig = { auth: { provider: "github" }, ui: { theme: "light" } };
    const managed: ManagedSettingsResult = {
      hasManaged: true,
      enforced: { auth: { provider: "okta" } },
      defaults: {},
      lockedKeys: new Set(["auth.provider"]),
    };
    const result = applyManagedSettings(userConfig, managed);
    // Enforced should override user
    expect((result.auth as Record<string, unknown>).provider).toBe("okta");
    // Non-enforced should remain
    expect((result.ui as Record<string, unknown>).theme).toBe("light");
  });

  it("full hierarchy: defaults → user → enforced", () => {
    const userConfig = { a: "user", b: "user" };
    const managed: ManagedSettingsResult = {
      hasManaged: true,
      enforced: { b: "enforced", c: "enforced" },
      defaults: { a: "default", d: "default" },
      lockedKeys: new Set(["b"]),
    };
    const result = applyManagedSettings(userConfig, managed);
    expect(result.a).toBe("user"); // user wins over default
    expect(result.b).toBe("enforced"); // enforced wins over user
    expect(result.c).toBe("enforced"); // enforced, no user value
    expect(result.d).toBe("default"); // default, no user value
  });
});

describe("isKeyLocked", () => {
  const managed: ManagedSettingsResult = {
    hasManaged: true,
    enforced: { auth: { provider: "okta" } },
    defaults: {},
    lockedKeys: new Set(["auth.provider", "security"]),
  };

  it("detects directly locked keys", () => {
    expect(isKeyLocked("auth.provider", managed)).toBe(true);
    expect(isKeyLocked("security", managed)).toBe(true);
  });

  it("detects child keys of locked parents", () => {
    expect(isKeyLocked("security.level", managed)).toBe(true);
    expect(isKeyLocked("security.audit.enabled", managed)).toBe(true);
  });

  it("detects keys set in enforced", () => {
    expect(isKeyLocked("auth.provider", managed)).toBe(true);
  });

  it("allows unlocked keys", () => {
    expect(isKeyLocked("ui.theme", managed)).toBe(false);
    expect(isKeyLocked("logging", managed)).toBe(false);
  });

  it("returns false when no managed settings", () => {
    const empty: ManagedSettingsResult = {
      hasManaged: false,
      enforced: {},
      defaults: {},
      lockedKeys: new Set(),
    };
    expect(isKeyLocked("anything", empty)).toBe(false);
  });
});

describe("filterLockedKeys", () => {
  const managed: ManagedSettingsResult = {
    hasManaged: true,
    enforced: { auth: { provider: "okta" } },
    defaults: {},
    lockedKeys: new Set(["auth.provider", "security"]),
  };

  it("removes locked keys from patch", () => {
    const patch = { auth: { provider: "github", token: "abc" }, ui: { theme: "light" } };
    const { filtered, blockedKeys } = filterLockedKeys(patch, managed);
    expect(blockedKeys).toContain("auth.provider");
    expect((filtered.auth as Record<string, unknown>)?.token).toBe("abc");
    expect((filtered.auth as Record<string, unknown>)?.provider).toBeUndefined();
    expect((filtered.ui as Record<string, unknown>).theme).toBe("light");
  });

  it("blocks entire subtree of locked parent", () => {
    const patch = { security: { level: "high", audit: true } };
    const { filtered, blockedKeys } = filterLockedKeys(patch, managed);
    expect(blockedKeys).toContain("security");
    expect(filtered.security).toBeUndefined();
  });

  it("returns empty blockedKeys when nothing locked", () => {
    const patch = { ui: { theme: "dark" } };
    const { filtered, blockedKeys } = filterLockedKeys(patch, managed);
    expect(blockedKeys).toHaveLength(0);
    expect(filtered).toEqual(patch);
  });
});

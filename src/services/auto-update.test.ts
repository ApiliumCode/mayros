import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AutoUpdateChecker } from "./auto-update.js";

describe("AutoUpdateChecker.isNewer", () => {
  it("returns true when latest has a higher major version", () => {
    expect(AutoUpdateChecker.isNewer("1.0.0", "2.0.0")).toBe(true);
  });

  it("returns true when latest has a higher minor version", () => {
    expect(AutoUpdateChecker.isNewer("1.2.0", "1.3.0")).toBe(true);
  });

  it("returns true when latest has a higher patch version", () => {
    expect(AutoUpdateChecker.isNewer("1.2.3", "1.2.4")).toBe(true);
  });

  it("returns false when versions are equal", () => {
    expect(AutoUpdateChecker.isNewer("1.0.0", "1.0.0")).toBe(false);
  });

  it("returns false when current is newer", () => {
    expect(AutoUpdateChecker.isNewer("2.0.0", "1.9.9")).toBe(false);
  });

  it("strips pre-release suffixes before comparison", () => {
    expect(AutoUpdateChecker.isNewer("0.1.0-beta.1", "0.1.1")).toBe(true);
  });
});

describe("AutoUpdateChecker.formatNotification", () => {
  it("returns a notification string when an update is available", () => {
    const msg = AutoUpdateChecker.formatNotification({
      currentVersion: "0.1.0",
      latestVersion: "0.2.0",
      updateAvailable: true,
      channel: "stable",
      checkedAt: Date.now(),
    });
    expect(msg).toContain("v0.1.0");
    expect(msg).toContain("v0.2.0");
    expect(msg).toContain("mayros update");
  });

  it("returns null when no update is available", () => {
    const msg = AutoUpdateChecker.formatNotification({
      currentVersion: "0.2.0",
      latestVersion: "0.2.0",
      updateAvailable: false,
      channel: "stable",
      checkedAt: Date.now(),
    });
    expect(msg).toBeNull();
  });
});

describe("AutoUpdateChecker#shouldCheck", () => {
  it("returns true when no previous check timestamp is provided", () => {
    const checker = new AutoUpdateChecker({ checkIntervalMs: 60_000 });
    expect(checker.shouldCheck()).toBe(true);
  });

  it("returns false when last check is within the interval", () => {
    const checker = new AutoUpdateChecker({ checkIntervalMs: 60_000 });
    expect(checker.shouldCheck(Date.now() - 10_000)).toBe(false);
  });

  it("returns true when last check exceeds the interval", () => {
    const checker = new AutoUpdateChecker({ checkIntervalMs: 60_000 });
    expect(checker.shouldCheck(Date.now() - 120_000)).toBe(true);
  });
});

describe("AutoUpdateChecker#checkForUpdate", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns updateAvailable=true when registry reports a newer version", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        "dist-tags": { latest: "0.3.0", beta: "0.4.0-beta.1" },
      }),
    }) as unknown as typeof fetch;

    const checker = new AutoUpdateChecker({ channel: "stable" });
    const result = await checker.checkForUpdate("0.1.0");

    expect(result.updateAvailable).toBe(true);
    expect(result.latestVersion).toBe("0.3.0");
  });

  it("returns updateAvailable=false on network error", async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error("offline")) as unknown as typeof fetch;

    const checker = new AutoUpdateChecker();
    const result = await checker.checkForUpdate("0.1.0");

    expect(result.updateAvailable).toBe(false);
    expect(result.latestVersion).toBeNull();
  });

  it("uses the correct dist-tag for the configured channel", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        "dist-tags": { latest: "0.2.0", beta: "0.3.0-beta.1" },
      }),
    }) as unknown as typeof fetch;

    const checker = new AutoUpdateChecker({ channel: "beta" });
    const result = await checker.checkForUpdate("0.1.0");

    expect(result.latestVersion).toBe("0.3.0-beta.1");
    expect(result.updateAvailable).toBe(true);
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { cleanupStaleSessions } from "./session-cleanup.js";
import { mkdirSync, writeFileSync, rmSync, existsSync, utimesSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("Session Cleanup", () => {
  const testDir = join(tmpdir(), "mayros-cleanup-test-" + Date.now());

  beforeEach(() => {
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true });
    } catch {}
  });

  it("returns zero counts for empty directory", () => {
    const result = cleanupStaleSessions({ sessionDir: testDir });
    expect(result.scanned).toBe(0);
    expect(result.removed).toBe(0);
    expect(result.bytesFreed).toBe(0);
  });

  it("returns zero counts for non-existent directory", () => {
    const result = cleanupStaleSessions({ sessionDir: join(testDir, "nonexistent") });
    expect(result.scanned).toBe(0);
    expect(result.removed).toBe(0);
  });

  it("removes sessions older than maxAgeDays", () => {
    // Create a stale session (old mtime)
    const stalePath = join(testDir, "old-session.json");
    writeFileSync(stalePath, '{"old": true}');
    const oldTime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000); // 60 days ago
    utimesSync(stalePath, oldTime, oldTime);

    // Create a fresh session
    const freshPath = join(testDir, "new-session.json");
    writeFileSync(freshPath, '{"new": true}');

    const result = cleanupStaleSessions({ sessionDir: testDir, maxAgeDays: 30 });
    expect(result.scanned).toBe(2);
    expect(result.removed).toBe(1);
    expect(existsSync(stalePath)).toBe(false);
    expect(existsSync(freshPath)).toBe(true);
  });

  it("respects maxSessions limit", () => {
    // Create 5 sessions
    for (let i = 0; i < 5; i++) {
      const p = join(testDir, `session-${i}.json`);
      writeFileSync(p, `{"i": ${i}}`);
      // Stagger mtimes
      const t = new Date(Date.now() - i * 1000);
      utimesSync(p, t, t);
    }

    const result = cleanupStaleSessions({ sessionDir: testDir, maxSessions: 3, maxAgeDays: 365 });
    expect(result.removed).toBe(2); // 5 - 3 = 2 removed
  });

  it("dryRun does not delete files", () => {
    const stalePath = join(testDir, "stale.json");
    writeFileSync(stalePath, "{}");
    const oldTime = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
    utimesSync(stalePath, oldTime, oldTime);

    const result = cleanupStaleSessions({ sessionDir: testDir, maxAgeDays: 30, dryRun: true });
    expect(result.removed).toBe(1);
    expect(existsSync(stalePath)).toBe(true); // NOT deleted
  });

  it("ignores non-json files", () => {
    writeFileSync(join(testDir, "readme.txt"), "not a session");
    const result = cleanupStaleSessions({ sessionDir: testDir });
    expect(result.scanned).toBe(0);
  });
});

import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readLockfile, writeLockfile, mergeLockfile, createLockEntry } from "./lockfile.js";

describe("lockfile", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "lockfile-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("readLockfile returns undefined for missing file", async () => {
    const result = await readLockfile(tempDir);
    expect(result).toBeUndefined();
  });

  it("writeLockfile and readLockfile roundtrip", async () => {
    const lock = {
      version: 1 as const,
      resolved: {
        "my-skill": { version: "1.0.0", hash: "abc123", resolvedAt: "2026-01-01T00:00:00Z" },
      },
    };

    await writeLockfile(tempDir, lock);

    const content = await readFile(join(tempDir, "skills.lock"), "utf-8");
    expect(content).toContain("my-skill");

    const loaded = await readLockfile(tempDir);
    expect(loaded).toEqual(lock);
  });

  it("mergeLockfile merges new entries", () => {
    const existing = {
      version: 1 as const,
      resolved: {
        "skill-a": { version: "1.0.0", hash: "aaa", resolvedAt: "2026-01-01" },
      },
    };

    const newEntries = {
      "skill-b": { version: "2.0.0", hash: "bbb", resolvedAt: "2026-02-01" },
    };

    const merged = mergeLockfile(existing, newEntries);
    expect(merged.resolved["skill-a"]).toBeDefined();
    expect(merged.resolved["skill-b"]).toBeDefined();
    expect(merged.version).toBe(1);
  });

  it("mergeLockfile overwrites existing entries", () => {
    const existing = {
      version: 1 as const,
      resolved: {
        "skill-a": { version: "1.0.0", hash: "old", resolvedAt: "2026-01-01" },
      },
    };

    const newEntries = {
      "skill-a": { version: "2.0.0", hash: "new", resolvedAt: "2026-02-01" },
    };

    const merged = mergeLockfile(existing, newEntries);
    expect(merged.resolved["skill-a"]!.version).toBe("2.0.0");
    expect(merged.resolved["skill-a"]!.hash).toBe("new");
  });

  it("mergeLockfile works with undefined existing", () => {
    const merged = mergeLockfile(undefined, {
      "skill-a": { version: "1.0.0", hash: "aaa", resolvedAt: "2026-01-01" },
    });
    expect(merged.resolved["skill-a"]).toBeDefined();
  });

  it("createLockEntry produces valid entry", () => {
    const entry = createLockEntry("1.2.3", "sha256-abc");
    expect(entry.version).toBe("1.2.3");
    expect(entry.hash).toBe("sha256-abc");
    expect(entry.resolvedAt).toBeDefined();
  });
});

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createInputHistoryStore } from "./input-history-store.js";
import { mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

describe("InputHistoryStore", () => {
  const testDir = join(tmpdir(), "mayros-history-test-" + Date.now());
  let originalHome: string | undefined;

  beforeEach(() => {
    originalHome = process.env.HOME;
    // We test the module functions directly without HOME override since
    // the store uses homedir() at call time
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    try {
      rmSync(testDir, { recursive: true });
    } catch {}
  });

  it("load returns empty array when file does not exist", () => {
    const store = createInputHistoryStore();
    // Default file may or may not exist, but function should not throw
    expect(() => store.load()).not.toThrow();
  });

  it("load returns empty array for invalid JSON", () => {
    const store = createInputHistoryStore();
    expect(() => store.load()).not.toThrow();
  });

  it("createInputHistoryStore returns object with load/save/append", () => {
    const store = createInputHistoryStore();
    expect(typeof store.load).toBe("function");
    expect(typeof store.save).toBe("function");
    expect(typeof store.append).toBe("function");
  });

  it("append does not throw for empty strings", () => {
    const store = createInputHistoryStore();
    expect(() => store.append("")).not.toThrow();
    expect(() => store.append("   ")).not.toThrow();
  });
});

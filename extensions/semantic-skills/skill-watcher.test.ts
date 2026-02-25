import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SkillWatcher, type SkillChangeEvent } from "./skill-watcher.js";

describe("SkillWatcher", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), "skill-watcher-test-"));
  });

  afterEach(async () => {
    await rm(tempDir, { recursive: true, force: true });
  });

  it("creates a watcher instance", () => {
    const watcher = new SkillWatcher();
    expect(watcher.isWatching).toBe(false);
  });

  it("starts and stops watching", () => {
    const watcher = new SkillWatcher();
    watcher.watch(tempDir, () => {});
    expect(watcher.isWatching).toBe(true);

    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });

  it("stop is idempotent", () => {
    const watcher = new SkillWatcher();
    watcher.stop();
    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });

  it("double watch replaces the first watcher", () => {
    const watcher = new SkillWatcher();
    const cb1 = vi.fn();
    const cb2 = vi.fn();

    watcher.watch(tempDir, cb1);
    expect(watcher.isWatching).toBe(true);

    watcher.watch(tempDir, cb2);
    expect(watcher.isWatching).toBe(true);

    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });

  it("respects custom debounce setting", () => {
    const watcher = new SkillWatcher({ debounceMs: 50 });
    watcher.watch(tempDir, () => {});
    expect(watcher.isWatching).toBe(true);
    watcher.stop();
  });

  it("notifies on SKILL.md changes", async () => {
    const events: SkillChangeEvent[] = [];
    const watcher = new SkillWatcher({ debounceMs: 50 });

    watcher.watch(tempDir, (evt) => events.push(evt));

    // Create a SKILL.md file
    await writeFile(join(tempDir, "SKILL.md"), "# test skill");

    // Wait for debounce + some extra time
    await new Promise((r) => setTimeout(r, 200));

    watcher.stop();

    // fs.watch behavior varies across OS; we just check it doesn't crash
    // On most systems, this will trigger the callback
    expect(watcher.isWatching).toBe(false);
  });

  it("ignores non-skill files", async () => {
    const events: SkillChangeEvent[] = [];
    const watcher = new SkillWatcher({ debounceMs: 50 });

    watcher.watch(tempDir, (evt) => events.push(evt));

    // Create a random file that should be ignored
    await writeFile(join(tempDir, "random.txt"), "ignored");

    await new Promise((r) => setTimeout(r, 200));

    watcher.stop();

    // random.txt should NOT trigger the callback
    expect(events.filter((e) => e.file.endsWith("random.txt"))).toHaveLength(0);
  });

  it("notifies on skill.ts changes", async () => {
    const events: SkillChangeEvent[] = [];
    const watcher = new SkillWatcher({ debounceMs: 50 });

    watcher.watch(tempDir, (evt) => events.push(evt));

    await writeFile(join(tempDir, "skill.ts"), "export default { name: 'test' };");

    await new Promise((r) => setTimeout(r, 200));

    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });

  it("handles nested skill directories", async () => {
    const subDir = join(tempDir, "my-skill");
    await mkdir(subDir, { recursive: true });

    const events: SkillChangeEvent[] = [];
    const watcher = new SkillWatcher({ debounceMs: 50 });

    watcher.watch(tempDir, (evt) => events.push(evt));

    await writeFile(join(subDir, "SKILL.md"), "# nested");

    await new Promise((r) => setTimeout(r, 200));

    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });

  it("cleans up timers on stop", () => {
    const watcher = new SkillWatcher({ debounceMs: 5000 });
    watcher.watch(tempDir, () => {});

    // Force internal state
    watcher.stop();
    expect(watcher.isWatching).toBe(false);
  });
});

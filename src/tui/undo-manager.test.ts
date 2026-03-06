import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { createUndoPoint, undo, listUndoEntries } from "./undo-manager.js";

describe("undo-manager", () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "undo-test-"));
    // Init a git repo
    execFileSync("git", ["init"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.email", "test@test.com"], { cwd: tmpDir });
    execFileSync("git", ["config", "user.name", "Test"], { cwd: tmpDir });
    // Create initial commit
    await fs.writeFile(path.join(tmpDir, "file.txt"), "initial");
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "init"], { cwd: tmpDir });
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it("creates an undo point", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "modified");
    const label = createUndoPoint(tmpDir, "test");
    expect(label).toBeTruthy();
    expect(label).toContain("mayros-undo-");
  });

  it("returns null when no changes", () => {
    const label = createUndoPoint(tmpDir);
    expect(label).toBeNull();
  });

  it("lists undo entries", async () => {
    await fs.writeFile(path.join(tmpDir, "file.txt"), "change1");
    createUndoPoint(tmpDir, "first");

    const entries = listUndoEntries(tmpDir);
    expect(entries.length).toBeGreaterThanOrEqual(1);
    expect(entries[0].label).toContain("mayros-undo-");
  });

  it("undoes last change", async () => {
    // Create a change and stash it as undo point
    await fs.writeFile(path.join(tmpDir, "file.txt"), "changed");
    createUndoPoint(tmpDir, "will-undo");

    // Commit the current state so working tree is clean
    execFileSync("git", ["add", "."], { cwd: tmpDir });
    execFileSync("git", ["commit", "-m", "committed"], { cwd: tmpDir });

    // Undo pops the stash, restoring the "changed" state on top of clean tree
    const result = undo(tmpDir);
    expect(result.success).toBe(true);
    expect(result.message).toContain("mayros-undo-");
  });

  it("returns error when no undo points", () => {
    const result = undo(tmpDir);
    expect(result.success).toBe(false);
    expect(result.message).toContain("No undo points");
  });
});

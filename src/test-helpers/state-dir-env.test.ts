import fs from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  restoreStateDirEnv,
  setStateDirEnv,
  snapshotStateDirEnv,
  withStateDirEnv,
} from "./state-dir-env.js";

describe("state-dir-env helpers", () => {
  it("set/snapshot/restore round-trips MAYROS_STATE_DIR", () => {
    const prevMayros = process.env.MAYROS_STATE_DIR;
    const snapshot = snapshotStateDirEnv();

    setStateDirEnv("/tmp/mayros-state-dir-test");
    expect(process.env.MAYROS_STATE_DIR).toBe("/tmp/mayros-state-dir-test");

    restoreStateDirEnv(snapshot);
    expect(process.env.MAYROS_STATE_DIR).toBe(prevMayros);
  });

  it("withStateDirEnv sets env for callback and cleans up temp root", async () => {
    const prevMayros = process.env.MAYROS_STATE_DIR;

    let capturedTempRoot = "";
    let capturedStateDir = "";
    await withStateDirEnv("mayros-state-dir-env-", async ({ tempRoot, stateDir }) => {
      capturedTempRoot = tempRoot;
      capturedStateDir = stateDir;
      expect(process.env.MAYROS_STATE_DIR).toBe(stateDir);
      await fs.writeFile(path.join(stateDir, "probe.txt"), "ok", "utf8");
    });

    expect(process.env.MAYROS_STATE_DIR).toBe(prevMayros);
    await expect(fs.stat(capturedStateDir)).rejects.toThrow();
    await expect(fs.stat(capturedTempRoot)).rejects.toThrow();
  });

  it("withStateDirEnv restores env and cleans temp root when callback throws", async () => {
    const prevMayros = process.env.MAYROS_STATE_DIR;

    let capturedTempRoot = "";
    let capturedStateDir = "";
    await expect(
      withStateDirEnv("mayros-state-dir-env-", async ({ tempRoot, stateDir }) => {
        capturedTempRoot = tempRoot;
        capturedStateDir = stateDir;
        throw new Error("boom");
      }),
    ).rejects.toThrow("boom");

    expect(process.env.MAYROS_STATE_DIR).toBe(prevMayros);
    await expect(fs.stat(capturedStateDir)).rejects.toThrow();
    await expect(fs.stat(capturedTempRoot)).rejects.toThrow();
  });
});

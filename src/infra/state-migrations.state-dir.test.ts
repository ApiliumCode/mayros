import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  autoMigrateLegacyStateDir,
  resetAutoMigrateLegacyStateDirForTest,
} from "./state-migrations.js";

let tempRoot: string | null = null;

async function makeTempRoot() {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "mayros-state-dir-"));
  tempRoot = root;
  return root;
}

afterEach(async () => {
  resetAutoMigrateLegacyStateDirForTest();
  if (!tempRoot) {
    return;
  }
  await fs.promises.rm(tempRoot, { recursive: true, force: true });
  tempRoot = null;
});

describe("state dir auto-migration", () => {
  it("reports no migration when no legacy dirs exist", async () => {
    const root = await makeTempRoot();

    const result = await autoMigrateLegacyStateDir({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    expect(result.migrated).toBe(false);
  });

  it("skips migration when .mayros already exists", async () => {
    const root = await makeTempRoot();
    const mayrosDir = path.join(root, ".mayros");
    fs.mkdirSync(mayrosDir, { recursive: true });
    fs.writeFileSync(path.join(mayrosDir, "marker.txt"), "ok", "utf-8");

    const result = await autoMigrateLegacyStateDir({
      env: {} as NodeJS.ProcessEnv,
      homedir: () => root,
    });

    expect(result.migrated).toBe(false);
    expect(fs.readFileSync(path.join(mayrosDir, "marker.txt"), "utf-8")).toBe("ok");
  });
});

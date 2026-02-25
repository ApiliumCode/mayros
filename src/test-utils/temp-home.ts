import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { captureEnv } from "./env.js";

const HOME_ENV_KEYS = ["HOME", "USERPROFILE", "HOMEDRIVE", "HOMEPATH", "MAYROS_STATE_DIR"] as const;

export type TempHomeEnv = {
  home: string;
  restore: () => Promise<void>;
};

export async function createTempHomeEnv(prefix: string): Promise<TempHomeEnv> {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  await fs.mkdir(path.join(home, ".mayros"), { recursive: true });

  const snapshot = captureEnv([...HOME_ENV_KEYS]);
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  process.env.MAYROS_STATE_DIR = path.join(home, ".mayros");

  if (process.platform === "win32") {
    const match = home.match(/^([A-Za-z]:)(.*)$/);
    if (match) {
      process.env.HOMEDRIVE = match[1];
      process.env.HOMEPATH = match[2] || "\\";
    }
  }

  return {
    home,
    restore: async () => {
      snapshot.restore();
      await fs.rm(home, { recursive: true, force: true });
    },
  };
}

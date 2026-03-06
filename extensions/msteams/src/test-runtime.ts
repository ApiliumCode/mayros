/**
 * Test-only stub — provides a minimal PluginRuntime for unit tests.
 *
 * This file lives in src/ (not a test directory) because vitest resolves
 * imports relative to the source tree and the test files import it via
 * `./test-runtime.js`.  It is NOT used at runtime; it is only imported
 * by *.test.ts files.
 */

import os from "node:os";
import path from "node:path";
import type { PluginRuntime } from "mayros/plugin-sdk";

export const msteamsRuntimeStub = {
  state: {
    resolveStateDir: (env: NodeJS.ProcessEnv = process.env, homedir?: () => string) => {
      const override = env.MAYROS_STATE_DIR?.trim();
      if (override) {
        return override;
      }
      const resolvedHome = homedir ? homedir() : os.homedir();
      return path.join(resolvedHome, ".mayros");
    },
  },
} as unknown as PluginRuntime;

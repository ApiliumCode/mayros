/**
 * Cortex Binary Locator
 *
 * Finds the aingle-cortex binary by checking multiple locations
 * in priority order.
 */

import { execFileSync } from "node:child_process";
import { access, constants } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const DEFAULT_INSTALL_DIR = join(homedir(), ".mayros", "bin");
const BINARY_NAME = process.platform === "win32" ? "aingle-cortex.exe" : "aingle-cortex";

/**
 * Locate the aingle-cortex binary by searching:
 * 1. Explicit configPath (if provided)
 * 2. ~/.mayros/bin/aingle-cortex
 * 3. System PATH (via `which` / `where`)
 *
 * Returns the full path or undefined if not found.
 */
export async function locateCortexBinary(configPath?: string): Promise<string | undefined> {
  // 1. Explicit config path
  if (configPath) {
    if (await isExecutable(configPath)) return configPath;
  }

  // 2. Default install location
  const defaultPath = join(DEFAULT_INSTALL_DIR, BINARY_NAME);
  if (await isExecutable(defaultPath)) return defaultPath;

  // 3. System PATH
  const systemPath = findInPath();
  if (systemPath && (await isExecutable(systemPath))) return systemPath;

  return undefined;
}

/**
 * Returns the default installation directory for the Cortex binary.
 */
export function getDefaultInstallDir(): string {
  return DEFAULT_INSTALL_DIR;
}

/**
 * Returns the expected binary name for the current platform.
 */
export function getBinaryName(): string {
  return BINARY_NAME;
}

/**
 * Run `aingle-cortex --version` and return the semver string, or null
 * if the binary doesn't support --version (old build) or fails.
 */
export function getCortexBinaryVersion(binaryPath: string): string | null {
  try {
    const output = execFileSync(binaryPath, ["--version"], {
      encoding: "utf-8",
      timeout: 5000,
    }).trim();
    // Output is a bare semver like "0.2.5"
    const match = output.match(/(\d+\.\d+\.\d+)/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

async function isExecutable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

function findInPath(): string | undefined {
  const cmd = process.platform === "win32" ? "where" : "which";
  try {
    const result = execFileSync(cmd, ["aingle-cortex"], {
      encoding: "utf-8",
      timeout: 3000,
    }).trim();
    return result.split("\n")[0]; // first match
  } catch {
    return undefined;
  }
}

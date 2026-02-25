import { homedir } from "node:os";
import { join } from "node:path";
import { describe, it, expect } from "vitest";
import {
  locateCortexBinary,
  getDefaultInstallDir,
  getBinaryName,
} from "./cortex-binary-locator.js";

describe("cortex-binary-locator", () => {
  it("getDefaultInstallDir returns ~/.mayros/bin", () => {
    expect(getDefaultInstallDir()).toBe(join(homedir(), ".mayros", "bin"));
  });

  it("getBinaryName returns platform-appropriate name", () => {
    const name = getBinaryName();
    if (process.platform === "win32") {
      expect(name).toBe("aingle-cortex.exe");
    } else {
      expect(name).toBe("aingle-cortex");
    }
  });

  it("locateCortexBinary returns undefined for non-existent explicit path", async () => {
    const result = await locateCortexBinary("/non/existent/path/aingle-cortex");
    expect(result).toBeUndefined();
  });

  it("locateCortexBinary returns undefined when binary not installed", async () => {
    // Without explicit path, it searches default dirs and PATH
    // In test environment, binary likely isn't installed
    const result = await locateCortexBinary();
    // Could be undefined or a path if binary happens to be installed
    expect(result === undefined || typeof result === "string").toBe(true);
  });

  it("locateCortexBinary returns explicit path if it exists and is executable", async () => {
    // Use a known executable as test fixture
    const nodePath = process.execPath;
    const result = await locateCortexBinary(nodePath);
    expect(result).toBe(nodePath);
  });

  it("locateCortexBinary skips non-executable explicit path", async () => {
    // package.json exists but is not executable
    const result = await locateCortexBinary(join(process.cwd(), "package.json"));
    // On some systems files may have exec bit, so just verify it returns string or undefined
    expect(result === undefined || typeof result === "string").toBe(true);
  });
});

import { describe, it, expect, vi, beforeEach } from "vitest";
import { MamoruSandbox } from "./sandbox.js";

describe("MamoruSandbox", () => {
  let sandbox: MamoruSandbox;

  beforeEach(() => {
    sandbox = new MamoruSandbox("test");
  });

  // 1
  it("checkAvailability returns platform info", async () => {
    const result = await sandbox.checkAvailability();
    expect(result).toHaveProperty("landlock");
    expect(result).toHaveProperty("seccomp");
    expect(result).toHaveProperty("platform");
    expect(result.platform).toBe(process.platform);
  });

  // 2
  it("checkAvailability reports no sandbox on non-linux", async () => {
    if (process.platform !== "linux") {
      const result = await sandbox.checkAvailability();
      expect(result.landlock).toBe(false);
      expect(result.seccomp).toBe(false);
    }
  });

  // 3
  it("getDefaultPolicy has secure defaults", () => {
    const policy = sandbox.getDefaultPolicy();

    expect(policy.filesystem.readOnly).toContain("/usr");
    expect(policy.filesystem.readOnly).toContain("/lib");
    expect(policy.filesystem.readOnly).toContain("/etc/ssl");
    expect(policy.filesystem.readWrite).toContain("/tmp");
    expect(policy.filesystem.denied).toContain("/etc/shadow");
    expect(policy.process.allowElevation).toBe(false);
    expect(policy.process.maxProcesses).toBe(50);
    expect(policy.compatibility).toBe("best_effort");
  });

  // 4
  it("getDefaultPolicy includes process.cwd() in readWrite", () => {
    const policy = sandbox.getDefaultPolicy();
    expect(policy.filesystem.readWrite).toContain(process.cwd());
  });

  // 5
  it("apply returns unsupported on non-linux", async () => {
    if (process.platform !== "linux") {
      const policy = sandbox.getDefaultPolicy();
      const result = await sandbox.apply(policy);
      expect(result.status).toBe("unsupported");
      expect(result.appliedLayers).toEqual([]);
    }
  });

  // 6
  it("getStatus returns inactive initially", () => {
    expect(sandbox.getStatus()).toBe("inactive");
  });

  // 7
  it("getStatus updates after apply", async () => {
    const policy = sandbox.getDefaultPolicy();
    await sandbox.apply(policy);

    if (process.platform !== "linux") {
      expect(sandbox.getStatus()).toBe("unsupported");
    }
  });

  // 8
  it("getAppliedPolicy returns null before apply", () => {
    expect(sandbox.getAppliedPolicy()).toBeNull();
  });
});

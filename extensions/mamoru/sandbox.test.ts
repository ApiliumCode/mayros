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

  // 9
  it("apply stores the policy regardless of platform", async () => {
    const policy = sandbox.getDefaultPolicy();
    await sandbox.apply(policy);
    expect(sandbox.getAppliedPolicy()).toEqual(policy);
  });

  // 10
  it("apply on linux with enforce mode throws when no primitives", async () => {
    if (process.platform === "linux") {
      const policy = sandbox.getDefaultPolicy();
      policy.compatibility = "enforce";
      // This test is platform-dependent — on Linux with kernel support it passes
      // On Linux without Landlock/seccomp it should throw
      const avail = await sandbox.checkAvailability();
      if (!avail.landlock && !avail.seccomp) {
        await expect(sandbox.apply(policy)).rejects.toThrow("sandbox enforcement requested");
      }
    }
  });

  // 11
  it("getStatusSummary includes namespace", () => {
    const summary = sandbox.getStatusSummary();
    expect(summary.ns).toBe("test");
    expect(summary.status).toBe("inactive");
    expect(summary.hasPolicy).toBe(false);
  });

  // 12
  it("apply result contains appliedLayers array", async () => {
    const policy = sandbox.getDefaultPolicy();
    const result = await sandbox.apply(policy);
    expect(Array.isArray(result.appliedLayers)).toBe(true);
    // On Linux, we expect at least umask-077 to be applied
    if (process.platform === "linux") {
      expect(result.appliedLayers).toContain("umask-077");
      expect(result.status).not.toBe("unsupported");
    }
  });
});

/**
 * Bash Sandbox Plugin Tests
 *
 * Tests cover:
 * - Configuration parsing (defaults, full config, invalid values, unknown keys)
 * - Plugin definition shape and metadata
 * - evaluateCommand integration (blocklist, patterns, domains, sudo, length)
 * - AuditLog behavior
 * - Mode handling (enforce, warn, off)
 */

import { describe, it, expect } from "vitest";
import { bashSandboxConfigSchema, type BashSandboxConfig } from "./config.js";
import { AuditLog } from "./audit-log.js";

// ============================================================================
// Config Tests
// ============================================================================

describe("bash sandbox config", () => {
  it("parses with all defaults", () => {
    const config = bashSandboxConfigSchema.parse({});

    expect(config.mode).toBe("enforce");
    expect(config.allowSudo).toBe(false);
    expect(config.allowCurlToArbitraryDomains).toBe(false);
    expect(config.maxCommandLengthBytes).toBe(8192);
    expect(config.bypassEnvVar).toBe("MAYROS_BASH_SANDBOX_BYPASS");
    expect(config.domainAllowlist.length).toBeGreaterThan(0);
    expect(config.domainAllowlist).toContain("github.com");
    expect(config.domainAllowlist).toContain("localhost");
    expect(config.commandBlocklist.length).toBeGreaterThan(0);
    expect(config.commandBlocklist).toContain("mkfs");
    expect(config.commandBlocklist).toContain("shutdown");
    expect(config.dangerousPatterns.length).toBe(6);
    expect(config.domainDenylist).toEqual([]);
    expect(config.commandAllowOverrides).toEqual([]);
  });

  it("parses from null/undefined with defaults", () => {
    const config = bashSandboxConfigSchema.parse(undefined);
    expect(config.mode).toBe("enforce");
    expect(config.domainAllowlist).toContain("github.com");
  });

  it("parses full custom config", () => {
    const config = bashSandboxConfigSchema.parse({
      mode: "warn",
      domainAllowlist: ["custom.com"],
      domainDenylist: ["evil.com"],
      commandBlocklist: ["rm"],
      commandAllowOverrides: ["dd"],
      maxCommandLengthBytes: 4096,
      allowSudo: true,
      allowCurlToArbitraryDomains: true,
      bypassEnvVar: "MY_BYPASS",
      dangerousPatterns: [
        {
          id: "test-pattern",
          pattern: "test",
          severity: "warn",
          message: "Test pattern",
        },
      ],
    });

    expect(config.mode).toBe("warn");
    expect(config.domainAllowlist).toEqual(["custom.com"]);
    expect(config.domainDenylist).toEqual(["evil.com"]);
    expect(config.commandBlocklist).toEqual(["rm"]);
    expect(config.commandAllowOverrides).toEqual(["dd"]);
    expect(config.maxCommandLengthBytes).toBe(4096);
    expect(config.allowSudo).toBe(true);
    expect(config.allowCurlToArbitraryDomains).toBe(true);
    expect(config.bypassEnvVar).toBe("MY_BYPASS");
    expect(config.dangerousPatterns).toHaveLength(1);
    expect(config.dangerousPatterns[0].id).toBe("test-pattern");
  });

  it("rejects unknown keys", () => {
    expect(() => bashSandboxConfigSchema.parse({ unknownKey: true })).toThrow(/unknown keys/);
  });

  it("uses default mode for invalid mode value", () => {
    const config = bashSandboxConfigSchema.parse({ mode: "invalid" });
    expect(config.mode).toBe("enforce");
  });

  it("accepts mode: off", () => {
    const config = bashSandboxConfigSchema.parse({ mode: "off" });
    expect(config.mode).toBe("off");
  });

  it("clamps maxCommandLengthBytes to valid range", () => {
    const configLow = bashSandboxConfigSchema.parse({ maxCommandLengthBytes: 10 });
    expect(configLow.maxCommandLengthBytes).toBe(64);

    const configHigh = bashSandboxConfigSchema.parse({ maxCommandLengthBytes: 100_000 });
    expect(configHigh.maxCommandLengthBytes).toBe(65536);
  });

  it("ignores non-string items in string arrays", () => {
    const config = bashSandboxConfigSchema.parse({
      domainAllowlist: ["good.com", 42, null, "also-good.com"],
    });
    expect(config.domainAllowlist).toEqual(["good.com", "also-good.com"]);
  });

  it("ignores malformed dangerous patterns", () => {
    const config = bashSandboxConfigSchema.parse({
      dangerousPatterns: [
        { id: "valid", pattern: "test", severity: "block", message: "ok" },
        { id: "missing-pattern", severity: "block", message: "no" },
        { id: "bad-severity", pattern: "x", severity: "invalid", message: "no" },
        "not-an-object",
        null,
      ],
    });
    expect(config.dangerousPatterns).toHaveLength(1);
    expect(config.dangerousPatterns[0].id).toBe("valid");
  });

  it("uses default bypassEnvVar when non-string given", () => {
    const config = bashSandboxConfigSchema.parse({ bypassEnvVar: 123 });
    expect(config.bypassEnvVar).toBe("MAYROS_BASH_SANDBOX_BYPASS");
  });
});

// ============================================================================
// Plugin Definition Tests
// ============================================================================

describe("bash sandbox plugin definition", () => {
  it("has correct metadata", async () => {
    const { default: plugin } = await import("./index.js");

    expect(plugin.id).toBe("bash-sandbox");
    expect(plugin.name).toBe("Bash Sandbox");
    expect(plugin.kind).toBe("security");
    expect(plugin.configSchema).toBeTruthy();
    expect(typeof plugin.register).toBe("function");
  });

  it("description mentions sandbox", async () => {
    const { default: plugin } = await import("./index.js");
    expect(plugin.description.includes("sandbox")).toBeTruthy();
  });

  it("description mentions blocklist", async () => {
    const { default: plugin } = await import("./index.js");
    expect(plugin.description.includes("blocklist")).toBeTruthy();
  });
});

// ============================================================================
// evaluateCommand Tests
// ============================================================================

describe("evaluateCommand", () => {
  it("allows a safe command", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({});

    const result = evaluateCommand("ls -la /tmp", cfg);
    expect(result.allowed).toBe(true);
    expect(result.action).toBe("allowed");
    expect(result.reasons).toHaveLength(0);
  });

  it("blocks a blocklisted command", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({});

    const result = evaluateCommand("shutdown -h now", cfg);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("blocked");
    expect(result.reasons.length).toBeGreaterThan(0);
  });

  it("blocks a dangerous pattern (rm -rf /)", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({});

    const result = evaluateCommand("rm -rf /", cfg);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("blocked");
  });

  it("blocks sudo when not allowed", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({ allowSudo: false });

    const result = evaluateCommand("sudo apt install curl", cfg);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("blocked");
    expect(result.reasons.some((r) => r.includes("sudo"))).toBe(true);
  });

  it("allows sudo when configured", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({ allowSudo: true });

    const result = evaluateCommand("sudo apt install curl", cfg);
    expect(result.allowed).toBe(true);
    expect(result.action).toBe("allowed");
  });

  it("blocks command exceeding max length", async () => {
    const { evaluateCommand } = await import("./index.js");
    // Min clamp is 64 bytes, so set to 64 and use a command longer than that
    const cfg = bashSandboxConfigSchema.parse({ maxCommandLengthBytes: 64 });
    const longCommand = "echo " + "a".repeat(100);

    const result = evaluateCommand(longCommand, cfg);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("blocked");
    expect(result.reasons.some((r) => r.includes("max length"))).toBe(true);
  });

  it("blocks curl to non-allowed domain", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({
      domainAllowlist: ["github.com"],
      allowCurlToArbitraryDomains: false,
    });

    const result = evaluateCommand("curl https://evil.com/payload", cfg);
    expect(result.allowed).toBe(false);
    expect(result.action).toBe("blocked");
  });

  it("allows curl to allowed domain", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({
      domainAllowlist: ["github.com"],
    });

    const result = evaluateCommand("curl https://github.com/file", cfg);
    expect(result.allowed).toBe(true);
  });

  it("skips domain check when allowCurlToArbitraryDomains is true", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({
      domainAllowlist: ["github.com"],
      allowCurlToArbitraryDomains: true,
    });

    const result = evaluateCommand("curl https://any-domain.com/file", cfg);
    expect(result.allowed).toBe(true);
  });

  it("respects commandAllowOverrides", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({
      commandBlocklist: ["dd", "mkfs"],
      commandAllowOverrides: ["dd"],
    });

    // dd is overridden (allowed)
    const resultDD = evaluateCommand("dd if=/dev/zero of=test", cfg);
    expect(resultDD.allowed).toBe(true);

    // mkfs is still blocked (exact match on basename)
    const resultMkfs = evaluateCommand("mkfs /dev/sda1", cfg);
    expect(resultMkfs.allowed).toBe(false);
  });

  it("returns warned action for warn-severity patterns", async () => {
    const { evaluateCommand } = await import("./index.js");
    const cfg = bashSandboxConfigSchema.parse({});

    const result = evaluateCommand("chmod 777 /etc", cfg);
    expect(result.action).toBe("warned");
    expect(result.allowed).toBe(true);
  });
});

// ============================================================================
// AuditLog Tests
// ============================================================================

describe("AuditLog", () => {
  it("adds and retrieves entries", () => {
    const log = new AuditLog();
    log.add({ command: "ls", action: "allowed" });
    log.add({ command: "rm -rf /", action: "blocked", reason: "dangerous" });

    const recent = log.getRecent(10);
    expect(recent).toHaveLength(2);
    // Newest first
    expect(recent[0].command).toBe("rm -rf /");
    expect(recent[1].command).toBe("ls");
  });

  it("auto-timestamps entries", () => {
    const log = new AuditLog();
    log.add({ command: "echo hello", action: "allowed" });

    const entries = log.getRecent(1);
    expect(entries[0].timestamp).toBeTruthy();
    // ISO format check
    expect(entries[0].timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("enforces maxEntries limit", () => {
    const log = new AuditLog(3);
    log.add({ command: "a", action: "allowed" });
    log.add({ command: "b", action: "allowed" });
    log.add({ command: "c", action: "allowed" });
    log.add({ command: "d", action: "allowed" });

    expect(log.size).toBe(3);
    const recent = log.getRecent(10);
    expect(recent[0].command).toBe("d");
    // "a" should have been evicted
    expect(recent.some((e) => e.command === "a")).toBe(false);
  });

  it("getBlocked filters correctly", () => {
    const log = new AuditLog();
    log.add({ command: "ls", action: "allowed" });
    log.add({ command: "rm -rf /", action: "blocked", reason: "root delete" });
    log.add({ command: "echo hi", action: "warned" });
    log.add({ command: "shutdown", action: "blocked", reason: "blocklist" });

    const blocked = log.getBlocked(10);
    expect(blocked).toHaveLength(2);
    expect(blocked[0].command).toBe("shutdown");
    expect(blocked[1].command).toBe("rm -rf /");
  });

  it("clear removes all entries", () => {
    const log = new AuditLog();
    log.add({ command: "a", action: "allowed" });
    log.add({ command: "b", action: "blocked" });

    log.clear();
    expect(log.size).toBe(0);
    expect(log.getRecent(10)).toHaveLength(0);
  });

  it("handles maxEntries of 1", () => {
    const log = new AuditLog(1);
    log.add({ command: "first", action: "allowed" });
    log.add({ command: "second", action: "blocked" });

    expect(log.size).toBe(1);
    expect(log.getRecent(10)[0].command).toBe("second");
  });

  it("stores optional fields", () => {
    const log = new AuditLog();
    log.add({
      command: "test",
      action: "blocked",
      reason: "test reason",
      matchedPattern: "test-pattern",
      sessionKey: "session-123",
    });

    const entry = log.getRecent(1)[0];
    expect(entry.reason).toBe("test reason");
    expect(entry.matchedPattern).toBe("test-pattern");
    expect(entry.sessionKey).toBe("session-123");
  });

  it("getRecent defaults to 50 entries", () => {
    const log = new AuditLog(100);
    for (let i = 0; i < 60; i++) {
      log.add({ command: `cmd-${i}`, action: "allowed" });
    }

    const recent = log.getRecent();
    expect(recent).toHaveLength(50);
  });

  it("getBlocked defaults to 50 entries", () => {
    const log = new AuditLog(100);
    for (let i = 0; i < 60; i++) {
      log.add({ command: `cmd-${i}`, action: "blocked" });
    }

    const blocked = log.getBlocked();
    expect(blocked).toHaveLength(50);
  });
});

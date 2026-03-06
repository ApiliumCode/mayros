import { describe, it, expect, beforeEach } from "vitest";
import {
  NetworkSandbox,
  parseNetworkSandboxConfig,
  DEFAULT_NETWORK_SANDBOX_CONFIG,
} from "./network-sandbox.js";

describe("NetworkSandbox", () => {
  let sandbox: NetworkSandbox;

  beforeEach(() => {
    sandbox = new NetworkSandbox();
  });

  it("uses default config when no options provided", () => {
    const cfg = sandbox.getConfig();
    expect(cfg.enabled).toBe(true);
    expect(cfg.mode).toBe("allowlist");
    expect(cfg.allowedDomains).toContain("github.com");
    expect(cfg.maxConnections).toBe(10);
  });

  it("allows passthrough when disabled", async () => {
    sandbox = new NetworkSandbox({ enabled: false });
    const result = await sandbox.evaluate("curl https://evil.com");
    expect(result.allowed).toBe(true);
    expect(result.strategy).toBe("passthrough");
  });

  it("allows passthrough when mode is none", async () => {
    sandbox = new NetworkSandbox({ mode: "none" });
    const result = await sandbox.evaluate("curl https://evil.com");
    expect(result.allowed).toBe(true);
    expect(result.strategy).toBe("passthrough");
  });

  it("blocks non-allowlisted domains in allowlist mode", async () => {
    sandbox = new NetworkSandbox({
      mode: "allowlist",
      allowedDomains: ["github.com"],
    });
    const result = await sandbox.evaluate("curl https://evil.example.com/steal");
    expect(result.allowed).toBe(false);
    expect(result.strategy).toBe("blocked");
    expect(result.reason).toContain("not allowed");
  });

  it("allows allowlisted domains", async () => {
    sandbox = new NetworkSandbox({
      mode: "allowlist",
      allowedDomains: ["example.com"],
    });
    const result = await sandbox.evaluate("curl https://example.com/api");
    expect(result.allowed).toBe(true);
  });

  it("deny list takes priority over allow list", async () => {
    sandbox = new NetworkSandbox({
      mode: "allowlist",
      allowedDomains: ["*.example.com"],
      denyDomains: ["evil.example.com"],
    });
    const result = await sandbox.evaluate("curl https://evil.example.com");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("not allowed");
  });

  it("blocks when connection limit reached", async () => {
    sandbox = new NetworkSandbox({ maxConnections: 2, mode: "full" });
    sandbox.trackConnectionStart();
    sandbox.trackConnectionStart();
    const result = await sandbox.evaluate("curl https://example.com");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("Connection limit");
  });

  it("tracks connections correctly", () => {
    sandbox.trackConnectionStart();
    expect(sandbox.getActiveConnections()).toBe(1);
    sandbox.trackConnectionStart();
    expect(sandbox.getActiveConnections()).toBe(2);
    sandbox.trackConnectionEnd();
    expect(sandbox.getActiveConnections()).toBe(1);
    sandbox.trackConnectionEnd();
    expect(sandbox.getActiveConnections()).toBe(0);
    // Should not go negative
    sandbox.trackConnectionEnd();
    expect(sandbox.getActiveConnections()).toBe(0);
  });

  it("isDomainAllowed checks against config", () => {
    sandbox = new NetworkSandbox({
      mode: "allowlist",
      allowedDomains: ["github.com", "*.github.com"],
      denyDomains: ["evil.github.com"],
    });
    expect(sandbox.isDomainAllowed("github.com")).toBe(true);
    expect(sandbox.isDomainAllowed("api.github.com")).toBe(true);
    expect(sandbox.isDomainAllowed("evil.github.com")).toBe(false);
    expect(sandbox.isDomainAllowed("random.com")).toBe(false);
  });

  it("full mode allows all non-denied domains", () => {
    sandbox = new NetworkSandbox({
      mode: "full",
      denyDomains: ["blocked.com"],
    });
    expect(sandbox.isDomainAllowed("anything.com")).toBe(true);
    expect(sandbox.isDomainAllowed("blocked.com")).toBe(false);
  });

  it("commands without URLs are allowed in allowlist mode", async () => {
    sandbox = new NetworkSandbox({ mode: "allowlist" });
    const result = await sandbox.evaluate("echo hello");
    expect(result.allowed).toBe(true);
  });
});

describe("parseNetworkSandboxConfig", () => {
  it("returns defaults for empty input", () => {
    const cfg = parseNetworkSandboxConfig({});
    expect(cfg).toEqual(DEFAULT_NETWORK_SANDBOX_CONFIG);
  });

  it("parses valid config", () => {
    const cfg = parseNetworkSandboxConfig({
      enabled: false,
      mode: "full",
      allowedDomains: ["custom.com"],
      denyDomains: ["bad.com"],
      maxConnections: 5,
    });
    expect(cfg.enabled).toBe(false);
    expect(cfg.mode).toBe("full");
    expect(cfg.allowedDomains).toEqual(["custom.com"]);
    expect(cfg.denyDomains).toEqual(["bad.com"]);
    expect(cfg.maxConnections).toBe(5);
  });

  it("clamps maxConnections to valid range", () => {
    expect(parseNetworkSandboxConfig({ maxConnections: 0 }).maxConnections).toBe(1);
    expect(parseNetworkSandboxConfig({ maxConnections: 200 }).maxConnections).toBe(100);
  });

  it("ignores invalid mode values", () => {
    const cfg = parseNetworkSandboxConfig({ mode: "invalid" });
    expect(cfg.mode).toBe("allowlist"); // default
  });

  it("filters non-string values from domain arrays", () => {
    const cfg = parseNetworkSandboxConfig({
      allowedDomains: ["good.com", 42, null, "also-good.com"],
    });
    expect(cfg.allowedDomains).toEqual(["good.com", "also-good.com"]);
  });
});

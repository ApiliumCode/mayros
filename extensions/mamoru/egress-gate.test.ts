import { describe, it, expect, beforeEach } from "vitest";
import { MamoruGate, _isPrivateIP } from "./egress-gate.js";

describe("MamoruGate", () => {
  let gate: MamoruGate;

  beforeEach(() => {
    gate = new MamoruGate("test");
  });

  // 1
  it("checkEgress denies by default", () => {
    const result = gate.checkEgress("example.com", 443);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("denied");
    expect(result.requestId).toBeTruthy();
  });

  // 2
  it("checkEgress allows whitelisted hosts via rules", () => {
    gate.addRule({ host: "api.example.com", port: 443, protocol: "https" });
    const result = gate.checkEgress("api.example.com", 443);
    expect(result.allowed).toBe(true);
  });

  // 3
  it("checkEgress allows hosts via presets", () => {
    gate.addPreset("github");
    const result = gate.checkEgress("api.github.com", 443);
    expect(result.allowed).toBe(true);
  });

  // 4
  it("addPreset adds rules and removePreset removes them", () => {
    gate.addPreset("npm");
    expect(gate.checkEgress("registry.npmjs.org", 443).allowed).toBe(true);

    gate.removePreset("npm");
    expect(gate.checkEgress("registry.npmjs.org", 443).allowed).toBe(false);
  });

  // 5
  it("approve makes future requests pass via session approval", () => {
    const check = gate.checkEgress("new-service.com", 443);
    expect(check.allowed).toBe(false);

    gate.approve(check.requestId!);

    const recheck = gate.checkEgress("new-service.com", 443);
    expect(recheck.allowed).toBe(true);
    expect(recheck.reason).toContain("Session");
  });

  // 6
  it("deny removes the pending request", () => {
    const check = gate.checkEgress("bad-service.com", 443);
    gate.deny(check.requestId!);

    expect(gate.getPendingRequests()).toHaveLength(0);
  });

  // 7 — validateEndpoint is now async
  it("validateEndpoint blocks private IPs", async () => {
    expect((await gate.validateEndpoint("http://127.0.0.1:8080/api")).safe).toBe(false);
    expect((await gate.validateEndpoint("http://10.0.0.1/secret")).safe).toBe(false);
    expect((await gate.validateEndpoint("http://192.168.1.1/admin")).safe).toBe(false);
  });

  // 8
  it("validateEndpoint blocks non-http schemes", async () => {
    expect((await gate.validateEndpoint("ftp://example.com/file")).safe).toBe(false);
    expect((await gate.validateEndpoint("file:///etc/passwd")).safe).toBe(false);
    expect((await gate.validateEndpoint("gopher://evil.com/")).safe).toBe(false);
  });

  // 9
  it("validateEndpoint allows safe URLs", async () => {
    expect((await gate.validateEndpoint("https://api.github.com/repos")).safe).toBe(true);
    expect((await gate.validateEndpoint("https://registry.npmjs.org/mayros")).safe).toBe(true);
  });

  // 10 — SSRF: blocks 169.254.169.254 cloud metadata
  it("validateEndpoint blocks cloud metadata endpoint", async () => {
    const result = await gate.validateEndpoint("http://169.254.169.254/latest/meta-data/");
    expect(result.safe).toBe(false);
    expect(result.reason).toContain("Private IP");
  });

  // 11
  it("listPresets returns all available presets", () => {
    const presets = gate.listPresets();
    const names = presets.map((p) => p.name);
    expect(names).toContain("github");
    expect(names).toContain("npm");
    expect(names).toContain("anthropic");
    expect(names).toContain("cortex");
    expect(names).toContain("hub");

    for (const preset of presets) {
      expect(preset.rules).toBeGreaterThan(0);
      expect(preset.description).toBeTruthy();
    }
  });

  // 12
  it("clearSession removes session approvals and pending requests", () => {
    const check = gate.checkEgress("temp.com", 443);
    gate.approve(check.requestId!);
    expect(gate.checkEgress("temp.com", 443).allowed).toBe(true);

    gate.clearSession();

    expect(gate.checkEgress("temp.com", 443).allowed).toBe(false);
    expect(gate.getPendingRequests()).toHaveLength(1); // new pending from recheck
  });

  // 14 — edge case: checkEgress with empty host
  it("checkEgress denies empty host", () => {
    const result = gate.checkEgress("", 443);
    expect(result.allowed).toBe(false);
  });

  // 15 — edge case: checkEgress with port 0
  it("checkEgress denies port 0", () => {
    const result = gate.checkEgress("example.com", 0);
    expect(result.allowed).toBe(false);
  });

  // 16 — edge case: validateEndpoint with IPv6-mapped private addresses via isPrivateIP
  it("isPrivateIP catches IPv6-mapped private addresses", () => {
    expect(_isPrivateIP("::ffff:10.0.0.1")).toBe(true);
    expect(_isPrivateIP("::ffff:192.168.0.1")).toBe(true);
    expect(_isPrivateIP("::ffff:169.254.169.254")).toBe(true);
  });

  // 17 — error messages do not expose request IDs
  it("approve throws generic error for unknown request", () => {
    expect(() => gate.approve("nonexistent-id")).toThrow("request not found");
  });

  // 18 — deny throws generic error for unknown request
  it("deny throws generic error for unknown request", () => {
    expect(() => gate.deny("nonexistent-id")).toThrow("request not found");
  });

  // 13 — session approval scoped to method+path
  it("session approval includes method and path scope", () => {
    const check = gate.checkEgress("api.example.com", 443, { method: "GET", path: "/users" });
    expect(check.allowed).toBe(false);

    gate.approve(check.requestId!);

    // Same method+path should pass
    const recheck = gate.checkEgress("api.example.com", 443, { method: "GET", path: "/users" });
    expect(recheck.allowed).toBe(true);

    // Different method should not auto-approve via session
    const diffMethod = gate.checkEgress("api.example.com", 443, { method: "DELETE", path: "/users" });
    expect(diffMethod.allowed).toBe(false);
  });
});

describe("isPrivateIP", () => {
  it("detects 127.x.x.x as private", () => {
    expect(_isPrivateIP("127.0.0.1")).toBe(true);
    expect(_isPrivateIP("127.255.255.255")).toBe(true);
  });

  it("detects 10.x.x.x as private", () => {
    expect(_isPrivateIP("10.0.0.1")).toBe(true);
    expect(_isPrivateIP("10.255.255.255")).toBe(true);
  });

  it("detects 172.16-31.x.x as private", () => {
    expect(_isPrivateIP("172.16.0.1")).toBe(true);
    expect(_isPrivateIP("172.31.255.255")).toBe(true);
  });

  it("detects 192.168.x.x as private", () => {
    expect(_isPrivateIP("192.168.0.1")).toBe(true);
    expect(_isPrivateIP("192.168.255.255")).toBe(true);
  });

  it("detects 169.254.x.x as private", () => {
    expect(_isPrivateIP("169.254.169.254")).toBe(true);
  });

  it("detects IPv6 loopback and private", () => {
    expect(_isPrivateIP("::1")).toBe(true);
    expect(_isPrivateIP("fd00:1234::1")).toBe(true);
  });

  it("detects IPv6-mapped IPv4 private addresses", () => {
    expect(_isPrivateIP("::ffff:127.0.0.1")).toBe(true);
    expect(_isPrivateIP("::ffff:10.0.0.1")).toBe(true);
    expect(_isPrivateIP("::ffff:192.168.1.1")).toBe(true);
  });

  it("detects IPv6 full-form loopback", () => {
    expect(_isPrivateIP("0:0:0:0:0:0:0:1")).toBe(true);
  });

  it("detects fc00::/7 (unique local)", () => {
    expect(_isPrivateIP("fc00::1")).toBe(true);
  });

  it("detects bracket notation", () => {
    expect(_isPrivateIP("[::1]")).toBe(true);
  });

  it("returns false for public IPs", () => {
    expect(_isPrivateIP("8.8.8.8")).toBe(false);
    expect(_isPrivateIP("1.1.1.1")).toBe(false);
    expect(_isPrivateIP("203.0.113.1")).toBe(false);
  });
});

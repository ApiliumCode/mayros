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

  // 7
  it("validateEndpoint blocks private IPs", () => {
    expect(gate.validateEndpoint("http://127.0.0.1:8080/api").safe).toBe(false);
    expect(gate.validateEndpoint("http://10.0.0.1/secret").safe).toBe(false);
    expect(gate.validateEndpoint("http://192.168.1.1/admin").safe).toBe(false);
  });

  // 8
  it("validateEndpoint blocks non-http schemes", () => {
    expect(gate.validateEndpoint("ftp://example.com/file").safe).toBe(false);
    expect(gate.validateEndpoint("file:///etc/passwd").safe).toBe(false);
    expect(gate.validateEndpoint("gopher://evil.com/").safe).toBe(false);
  });

  // 9
  it("validateEndpoint allows safe URLs", () => {
    expect(gate.validateEndpoint("https://api.github.com/repos").safe).toBe(true);
    expect(gate.validateEndpoint("https://registry.npmjs.org/mayros").safe).toBe(true);
  });

  // 10 — SSRF: blocks 169.254.169.254 cloud metadata
  it("validateEndpoint blocks cloud metadata endpoint", () => {
    const result = gate.validateEndpoint("http://169.254.169.254/latest/meta-data/");
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

  it("returns false for public IPs", () => {
    expect(_isPrivateIP("8.8.8.8")).toBe(false);
    expect(_isPrivateIP("1.1.1.1")).toBe(false);
    expect(_isPrivateIP("203.0.113.1")).toBe(false);
  });
});

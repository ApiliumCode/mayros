import { describe, it, expect, beforeEach } from "vitest";
import { EruberuProxy } from "./eruberu-proxy.js";

describe("EruberuProxy", () => {
  let proxy: EruberuProxy;

  beforeEach(() => {
    proxy = new EruberuProxy("test");
  });

  // 1
  it("listProfiles returns built-in profiles", () => {
    const profiles = proxy.listProfiles();
    expect(profiles.length).toBeGreaterThanOrEqual(5);

    const ids = profiles.map((p) => p.id);
    expect(ids).toContain("anthropic-cloud");
    expect(ids).toContain("openai-cloud");
    expect(ids).toContain("google-cloud");
    expect(ids).toContain("ollama-local");
    expect(ids).toContain("vllm-local");
  });

  // 2
  it("checkPolicy allows providers in the allowed list", () => {
    const result = proxy.checkPolicy("anthropic", "claude-sonnet-4-6");
    expect(result.allowed).toBe(true);
  });

  // 3
  it("checkPolicy denies providers not in the allowed list", () => {
    proxy.setPolicy({ allowedProviders: ["anthropic"] });
    const result = proxy.checkPolicy("openai", "gpt-4o");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("openai");
  });

  // 4
  it("checkPolicy denies models not matching allowed patterns", () => {
    proxy.setPolicy({ allowedModels: ["claude-*"] });
    const result = proxy.checkPolicy("openai", "gpt-4o");
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("gpt-4o");
  });

  // 5
  it("checkPolicy allows models matching glob patterns", () => {
    proxy.setPolicy({ allowedModels: ["claude-*"] });
    const result = proxy.checkPolicy("anthropic", "claude-sonnet-4-6");
    expect(result.allowed).toBe(true);
  });

  // 6
  it("logRequest adds to ring buffer with max 1000", () => {
    for (let i = 0; i < 1050; i++) {
      proxy.logRequest({
        profileId: "anthropic-cloud",
        model: "claude-sonnet-4-6",
        provider: "anthropic",
        inputTokens: 100,
        outputTokens: 50,
        durationMs: 200,
        status: "success",
      });
    }

    expect(proxy.getLogCount()).toBe(1000);
  });

  // 7
  it("logRequest returns log with id and timestamp", () => {
    const log = proxy.logRequest({
      profileId: "anthropic-cloud",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 200,
      status: "success",
    });

    expect(log.id).toBeTruthy();
    expect(log.timestamp).toBeTruthy();
    expect(log.model).toBe("claude-sonnet-4-6");
  });

  // 8
  it("getUsageSummary aggregates correctly", () => {
    proxy.logRequest({
      profileId: "anthropic-cloud",
      model: "claude-sonnet-4-6",
      provider: "anthropic",
      inputTokens: 100,
      outputTokens: 50,
      durationMs: 200,
      status: "success",
    });
    proxy.logRequest({
      profileId: "openai-cloud",
      model: "gpt-4o",
      provider: "openai",
      inputTokens: 200,
      outputTokens: 100,
      durationMs: 300,
      status: "success",
    });

    const summary = proxy.getUsageSummary();
    expect(summary.totalRequests).toBe(2);
    expect(summary.totalTokens).toBe(450);
    expect(summary.byProvider["anthropic"]).toBe(150);
    expect(summary.byProvider["openai"]).toBe(300);
    expect(summary.byModel["claude-sonnet-4-6"]).toBe(150);
    expect(summary.byModel["gpt-4o"]).toBe(300);
  });

  // 9
  it("setActiveProfile works and getActiveProfile returns it", () => {
    expect(proxy.getActiveProfile()).toBeNull();

    proxy.setActiveProfile("anthropic-cloud");
    const active = proxy.getActiveProfile();
    expect(active).not.toBeNull();
    expect(active!.id).toBe("anthropic-cloud");
  });

  // 10
  it("setActiveProfile throws for unknown profile", () => {
    expect(() => proxy.setActiveProfile("nonexistent")).toThrow("unknown profile");
  });
});

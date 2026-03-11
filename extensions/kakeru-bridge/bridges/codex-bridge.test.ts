import { describe, it, expect } from "vitest";
import { CodexBridge } from "./codex-bridge.js";

describe("CodexBridge", () => {
  it("starts disconnected", () => {
    const bridge = new CodexBridge({
      binaryPath: "codex",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultTimeout: 5000,
    });
    expect(bridge.getStatus()).toBe("disconnected");
    expect(bridge.id).toBe("codex");
    expect(bridge.name).toBe("OpenAI Codex CLI");
  });

  it("has expected capabilities", () => {
    const bridge = new CodexBridge({
      binaryPath: "codex",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultTimeout: 5000,
    });
    expect(bridge.capabilities).toContain("code-edit");
    expect(bridge.capabilities).toContain("shell-exec");
  });

  it("fails to connect when binary not found", async () => {
    const bridge = new CodexBridge({
      binaryPath: "/nonexistent/codex-binary",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultTimeout: 5000,
    });

    await expect(bridge.connect()).rejects.toThrow();
    expect(bridge.getStatus()).toBe("error");
  });

  it("rejects task when not connected", async () => {
    const bridge = new CodexBridge({
      binaryPath: "codex",
      apiKeyEnv: "OPENAI_API_KEY",
      defaultTimeout: 5000,
    });

    await expect(bridge.executeTask({ id: "t1", prompt: "test", workDir: "/tmp" })).rejects.toThrow(
      "not ready",
    );
  });
});

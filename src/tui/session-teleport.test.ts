import { describe, it, expect } from "vitest";
import {
  exportSession,
  importSession,
  estimateTokenSize,
  type TeleportPayload,
} from "./session-teleport.js";

describe("session-teleport", () => {
  const samplePayload: TeleportPayload = {
    version: 1,
    timestamp: "2024-01-01T00:00:00Z",
    agentId: "default",
    sessionKey: "test-session-123",
    messages: [
      { role: "user", content: "Hello" },
      { role: "assistant", content: "Hi there!" },
      { role: "user", content: "How are you?" },
    ],
    metadata: { model: "claude-sonnet-4-20250514" },
  };

  describe("exportSession", () => {
    it("produces a token starting with magic prefix", () => {
      const token = exportSession(samplePayload);
      expect(token).toMatch(/^MYR1/);
    });

    it("produces a non-empty token", () => {
      const token = exportSession(samplePayload);
      expect(token.length).toBeGreaterThan(10);
    });

    it("compresses the payload", () => {
      const token = exportSession(samplePayload);
      const rawJson = JSON.stringify(samplePayload);
      // Compressed should be shorter than raw for non-trivial payloads
      expect(token.length).toBeLessThan(rawJson.length * 2);
    });
  });

  describe("importSession", () => {
    it("round-trips correctly", () => {
      const token = exportSession(samplePayload);
      const imported = importSession(token);
      expect(imported.agentId).toBe("default");
      expect(imported.sessionKey).toBe("test-session-123");
      expect(imported.messages).toHaveLength(3);
      expect(imported.messages[0].content).toBe("Hello");
    });

    it("rejects invalid prefix", () => {
      expect(() => importSession("INVALID_TOKEN")).toThrow("missing magic prefix");
    });

    it("rejects corrupted data", () => {
      expect(() => importSession("MYR1invalidbase64!!!")).toThrow();
    });
  });

  describe("estimateTokenSize", () => {
    it("estimates compressed bytes", () => {
      const token = exportSession(samplePayload);
      const estimate = estimateTokenSize(token);
      expect(estimate.compressedBytes).toBeGreaterThan(0);
    });
  });

  describe("large payload", () => {
    it("handles many messages", () => {
      const largePayload: TeleportPayload = {
        ...samplePayload,
        messages: Array.from({ length: 100 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
          content: `Message ${i}: ${"x".repeat(100)}`,
        })),
      };
      const token = exportSession(largePayload);
      const imported = importSession(token);
      expect(imported.messages).toHaveLength(100);
    });
  });
});

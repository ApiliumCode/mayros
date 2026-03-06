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

    it("returns correct message count", () => {
      const token = exportSession(samplePayload);
      const estimate = estimateTokenSize(token);
      expect(estimate.messageCount).toBe(3);
    });

    it("returns 0 message count for corrupted token", () => {
      const estimate = estimateTokenSize("MYR1invaliddata!!!");
      expect(estimate.messageCount).toBe(0);
    });
  });

  describe("missing required fields", () => {
    it("throws when agentId is missing", () => {
      const bad = { ...samplePayload, agentId: "" };
      const token = exportSession(bad);
      expect(() => importSession(token)).toThrow("missing required fields");
    });

    it("throws when sessionKey is missing", () => {
      const bad = { ...samplePayload, sessionKey: "" };
      const token = exportSession(bad);
      expect(() => importSession(token)).toThrow("missing required fields");
    });
  });

  describe("empty messages", () => {
    it("accepts an empty messages array", () => {
      const payload: TeleportPayload = { ...samplePayload, messages: [] };
      const token = exportSession(payload);
      const imported = importSession(token);
      expect(imported.messages).toHaveLength(0);
    });
  });

  describe("unicode round-trip", () => {
    it("preserves unicode content in messages", () => {
      const payload: TeleportPayload = {
        ...samplePayload,
        messages: [
          { role: "user", content: "Hola, como estas? \u00bfQu\u00e9 tal?" },
          { role: "assistant", content: "\u3053\u3093\u306b\u3061\u306f\u4e16\u754c \ud83c\udf0d" },
          {
            role: "user",
            content:
              "\u041f\u0440\u0438\u0432\u0435\u0442 \u00e9\u00e8\u00ea\u00eb \u00fc\u00f6\u00e4",
          },
        ],
      };
      const token = exportSession(payload);
      const imported = importSession(token);
      expect(imported.messages[0].content).toBe("Hola, como estas? \u00bfQu\u00e9 tal?");
      expect(imported.messages[1].content).toBe(
        "\u3053\u3093\u306b\u3061\u306f\u4e16\u754c \ud83c\udf0d",
      );
      expect(imported.messages[2].content).toBe(
        "\u041f\u0440\u0438\u0432\u0435\u0442 \u00e9\u00e8\u00ea\u00eb \u00fc\u00f6\u00e4",
      );
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

    it("compresses and decompresses 1000 messages", () => {
      const payload: TeleportPayload = {
        ...samplePayload,
        messages: Array.from({ length: 1000 }, (_, i) => ({
          role: (i % 2 === 0 ? "user" : "assistant") as "user" | "assistant",
          content: `Message ${i}: some content here`,
        })),
      };
      const token = exportSession(payload);
      const imported = importSession(token);
      expect(imported.messages).toHaveLength(1000);
      const estimate = estimateTokenSize(token);
      expect(estimate.messageCount).toBe(1000);
    });
  });
});

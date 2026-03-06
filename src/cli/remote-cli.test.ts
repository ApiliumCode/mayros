/**
 * Remote CLI Tests
 *
 * Tests cover:
 * - decodeWebSocketFrame parses text frame
 * - encodeWebSocketFrame creates valid frame
 * - Round-trip encode/decode
 * - decodeWebSocketFrame returns null for non-text opcodes
 * - Handles masked frames
 * - Handles empty payload
 */

import { describe, it, expect } from "vitest";
import { decodeWebSocketFrame, encodeWebSocketFrame } from "./remote-cli.js";

// ============================================================================
// decodeWebSocketFrame
// ============================================================================

describe("decodeWebSocketFrame", () => {
  it("parses an unmasked text frame", () => {
    const text = "hello";
    const payload = Buffer.from(text, "utf-8");
    const frame = Buffer.alloc(2 + payload.length);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = payload.length;
    payload.copy(frame, 2);

    expect(decodeWebSocketFrame(frame)).toBe("hello");
  });

  it("returns null for non-text opcodes (binary = 0x02)", () => {
    const payload = Buffer.from("data", "utf-8");
    const frame = Buffer.alloc(2 + payload.length);
    frame[0] = 0x82; // FIN + binary opcode
    frame[1] = payload.length;
    payload.copy(frame, 2);

    expect(decodeWebSocketFrame(frame)).toBeNull();
  });

  it("handles masked frames (client-to-server)", () => {
    const text = "test";
    const payload = Buffer.from(text, "utf-8");
    const mask = Buffer.from([0x12, 0x34, 0x56, 0x78]);

    const frame = Buffer.alloc(2 + 4 + payload.length);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = 0x80 | payload.length; // masked bit + length

    mask.copy(frame, 2);
    for (let i = 0; i < payload.length; i++) {
      frame[6 + i] = payload[i] ^ mask[i % 4];
    }

    expect(decodeWebSocketFrame(frame)).toBe("test");
  });

  it("handles empty payload", () => {
    const frame = Buffer.alloc(2);
    frame[0] = 0x81; // FIN + text opcode
    frame[1] = 0; // zero-length payload

    expect(decodeWebSocketFrame(frame)).toBe("");
  });

  it("returns null for too-short buffer", () => {
    expect(decodeWebSocketFrame(Buffer.alloc(1))).toBeNull();
    expect(decodeWebSocketFrame(Buffer.alloc(0))).toBeNull();
  });
});

// ============================================================================
// encodeWebSocketFrame
// ============================================================================

describe("encodeWebSocketFrame", () => {
  it("creates a valid unmasked text frame", () => {
    const frame = encodeWebSocketFrame("hello");

    expect(frame[0]).toBe(0x81); // FIN + text opcode
    expect(frame[1]).toBe(5); // payload length
    expect(frame.subarray(2).toString("utf-8")).toBe("hello");
  });

  it("handles empty string", () => {
    const frame = encodeWebSocketFrame("");

    expect(frame[0]).toBe(0x81);
    expect(frame[1]).toBe(0);
    expect(frame.length).toBe(2);
  });
});

// ============================================================================
// Round-trip
// ============================================================================

describe("WebSocket frame round-trip", () => {
  it("encode then decode returns original text", () => {
    const original = "Mayros Remote Control v0.1.5";
    const frame = encodeWebSocketFrame(original);
    const decoded = decodeWebSocketFrame(frame);

    expect(decoded).toBe(original);
  });

  it("round-trips JSON payload", () => {
    const payload = JSON.stringify({ type: "command", text: "/help" });
    const frame = encodeWebSocketFrame(payload);
    const decoded = decodeWebSocketFrame(frame);

    expect(decoded).toBe(payload);
    expect(JSON.parse(decoded!)).toEqual({ type: "command", text: "/help" });
  });

  it("round-trips unicode text", () => {
    const original = "Hola desde Mayros";
    const frame = encodeWebSocketFrame(original);
    const decoded = decodeWebSocketFrame(frame);

    expect(decoded).toBe(original);
  });
});

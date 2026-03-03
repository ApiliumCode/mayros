import { describe, it, expect } from "vitest";
import {
  extractMcpContent,
  formatMcpResponse,
  hasImageContent,
  bridgeMcpContent,
} from "./image-bridge.js";

describe("extractMcpContent", () => {
  it("extracts text-only content", () => {
    const blocks = extractMcpContent([{ type: "text", text: "hello" }]);
    expect(blocks).toEqual([{ type: "text", text: "hello" }]);
  });

  it("extracts image-only content", () => {
    const blocks = extractMcpContent([
      { type: "image", data: "base64data", mimeType: "image/png" },
    ]);
    expect(blocks).toEqual([{ type: "image", data: "base64data", mimeType: "image/png" }]);
  });

  it("extracts mixed text and image content", () => {
    const blocks = extractMcpContent([
      { type: "text", text: "caption" },
      { type: "image", data: "imgdata", mimeType: "image/jpeg" },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toEqual({ type: "text", text: "caption" });
    expect(blocks[1]).toEqual({ type: "image", data: "imgdata", mimeType: "image/jpeg" });
  });

  it("skips image with missing mimeType", () => {
    const blocks = extractMcpContent([{ type: "image", data: "base64data" }]);
    expect(blocks).toHaveLength(0);
  });

  it("skips image with missing data", () => {
    const blocks = extractMcpContent([{ type: "image", mimeType: "image/png" }]);
    expect(blocks).toHaveLength(0);
  });

  it("skips image with empty data", () => {
    const blocks = extractMcpContent([{ type: "image", data: "", mimeType: "image/png" }]);
    expect(blocks).toHaveLength(0);
  });

  it("extracts multiple images", () => {
    const blocks = extractMcpContent([
      { type: "image", data: "img1", mimeType: "image/png" },
      { type: "image", data: "img2", mimeType: "image/jpeg" },
    ]);
    expect(blocks).toHaveLength(2);
    expect(blocks[0].type).toBe("image");
    expect(blocks[1].type).toBe("image");
  });

  it("treats unknown type as text if text field present", () => {
    const blocks = extractMcpContent([{ type: "resource", text: "resource data" }]);
    expect(blocks).toEqual([{ type: "text", text: "resource data" }]);
  });

  it("skips unknown type without text field", () => {
    const blocks = extractMcpContent([{ type: "resource", data: "raw" }]);
    expect(blocks).toHaveLength(0);
  });

  it("skips text block with empty text", () => {
    const blocks = extractMcpContent([{ type: "text", text: "" }]);
    expect(blocks).toHaveLength(0);
  });

  it("handles empty content array", () => {
    const blocks = extractMcpContent([]);
    expect(blocks).toHaveLength(0);
  });
});

describe("formatMcpResponse", () => {
  it("formats text block unchanged", () => {
    const result = formatMcpResponse([{ type: "text", text: "hello" }]);
    expect(result).toEqual([{ type: "text", text: "hello" }]);
  });

  it("formats image block to Anthropic base64 format", () => {
    const result = formatMcpResponse([
      { type: "image", data: "base64data", mimeType: "image/png" },
    ]);
    expect(result).toEqual([
      {
        type: "image",
        source: { type: "base64", media_type: "image/png", data: "base64data" },
      },
    ]);
  });

  it("formats mixed content blocks", () => {
    const result = formatMcpResponse([
      { type: "text", text: "caption" },
      { type: "image", data: "imgdata", mimeType: "image/jpeg" },
    ]);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ type: "text", text: "caption" });
    expect(result[1]).toEqual({
      type: "image",
      source: { type: "base64", media_type: "image/jpeg", data: "imgdata" },
    });
  });
});

describe("hasImageContent", () => {
  it("returns true when image content present", () => {
    expect(hasImageContent([{ type: "image", data: "base64data", mimeType: "image/png" }])).toBe(
      true,
    );
  });

  it("returns false for text-only content", () => {
    expect(hasImageContent([{ type: "text", text: "hello" }])).toBe(false);
  });

  it("returns false for image with missing data", () => {
    expect(hasImageContent([{ type: "image", mimeType: "image/png" }])).toBe(false);
  });

  it("returns false for empty content", () => {
    expect(hasImageContent([])).toBe(false);
  });
});

describe("bridgeMcpContent", () => {
  it("returns text block for text-only content", () => {
    const result = bridgeMcpContent([{ type: "text", text: "hello" }]);
    expect(result).toEqual([{ type: "text", text: "hello" }]);
  });

  it("returns image block for image content", () => {
    const result = bridgeMcpContent([{ type: "image", data: "imgdata", mimeType: "image/png" }]);
    expect(result).toEqual([
      { type: "image", source: { type: "base64", media_type: "image/png", data: "imgdata" } },
    ]);
  });

  it("returns empty response placeholder for empty content", () => {
    const result = bridgeMcpContent([]);
    expect(result).toEqual([{ type: "text", text: "(empty response)" }]);
  });

  it("preserves order of mixed content", () => {
    const result = bridgeMcpContent([
      { type: "text", text: "before" },
      { type: "image", data: "img", mimeType: "image/png" },
      { type: "text", text: "after" },
    ]);
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ type: "text", text: "before" });
    expect(result[1].type).toBe("image");
    expect(result[2]).toEqual({ type: "text", text: "after" });
  });
});

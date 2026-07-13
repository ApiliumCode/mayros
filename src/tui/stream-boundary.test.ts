import { describe, expect, it } from "vitest";
import { findStableBoundary } from "./stream-boundary.js";

describe("findStableBoundary", () => {
  it("returns 0 for empty text", () => {
    expect(findStableBoundary("")).toBe(0);
  });

  it("returns 0 for a single paragraph with no blank line", () => {
    expect(findStableBoundary("hello world")).toBe(0);
  });

  it("splits at the last blank line between paragraphs", () => {
    const text = "first paragraph\n\nsecond paragraph";
    const boundary = findStableBoundary(text);
    expect(text.slice(0, boundary)).toBe("first paragraph\n\n");
    expect(text.slice(boundary)).toBe("second paragraph");
  });

  it("splits at the last of multiple blank lines", () => {
    const text = "para one\n\npara two\n\npara three";
    const boundary = findStableBoundary(text);
    expect(text.slice(boundary)).toBe("para three");
  });

  it("keeps an open code fence in the suffix (does not split mid-fence)", () => {
    const text = "intro\n\n```ts\nconst x = 1;\n// still in fence";
    const boundary = findStableBoundary(text);
    // The blank line before the fence opens is a stable boundary (fence count
    // is 0 there), so "intro" becomes the stable prefix and the open fence
    // stays in the suffix — which is correct, the prefix is a complete block.
    expect(text.slice(0, boundary)).toBe("intro\n\n");
    expect(text.slice(boundary)).toBe("```ts\nconst x = 1;\n// still in fence");
  });

  it("splits after a closed code fence", () => {
    const text = "intro\n\n```ts\nconst x = 1;\n```\n\nnext paragraph";
    const boundary = findStableBoundary(text);
    expect(text.slice(boundary)).toBe("next paragraph");
    expect(text.slice(0, boundary)).toContain("```");
    expect(text.slice(0, boundary)).toContain("```ts");
  });

  it("handles multiple closed fences", () => {
    const text = "a\n\n```ts\ncode1\n```\n\nb\n\n```py\ncode2\n```\n\nc";
    const boundary = findStableBoundary(text);
    expect(text.slice(boundary)).toBe("c");
  });

  it("treats tilde fences the same as backtick fences", () => {
    const text = "intro\n\n~~~ts\nconst x = 1;\n~~~\n\nafter";
    const boundary = findStableBoundary(text);
    expect(text.slice(boundary)).toBe("after");
  });

  it("returns 0 when the only blank line is inside an open fence", () => {
    const text = "```ts\n\nconst x = 1;\n// open";
    const boundary = findStableBoundary(text);
    expect(boundary).toBe(0);
  });

  it("handles trailing newlines", () => {
    const text = "paragraph\n\n";
    const boundary = findStableBoundary(text);
    // The boundary is after the blank line; suffix is empty.
    expect(text.slice(0, boundary)).toBe("paragraph\n\n");
    expect(text.slice(boundary)).toBe("");
  });
});

import { describe, expect, it } from "vitest";
import { OUTPUT_STYLE_NAMES, applyOutputStyle, isValidOutputStyle } from "./output-styles.js";

describe("applyOutputStyle", () => {
  it("returns message unchanged for standard style", () => {
    expect(applyOutputStyle("hello", "standard")).toBe("hello");
  });

  it("prepends explanatory prefix", () => {
    const result = applyOutputStyle("hello", "explanatory");
    expect(result).toContain("[System:");
    expect(result).toContain("detailed explanations");
    expect(result).toContain("hello");
  });

  it("prepends learning prefix", () => {
    const result = applyOutputStyle("hello", "learning");
    expect(result).toContain("[System:");
    expect(result).toContain("patient teacher");
    expect(result).toContain("hello");
  });

  it("preserves full message content", () => {
    const msg = "Tell me about TypeScript generics";
    const result = applyOutputStyle(msg, "explanatory");
    expect(result.endsWith(msg)).toBe(true);
  });
});

describe("isValidOutputStyle", () => {
  it("accepts valid styles", () => {
    expect(isValidOutputStyle("standard")).toBe(true);
    expect(isValidOutputStyle("explanatory")).toBe(true);
    expect(isValidOutputStyle("learning")).toBe(true);
  });

  it("rejects invalid styles", () => {
    expect(isValidOutputStyle("invalid")).toBe(false);
    expect(isValidOutputStyle("")).toBe(false);
  });
});

describe("OUTPUT_STYLE_NAMES", () => {
  it("lists all styles", () => {
    expect(OUTPUT_STYLE_NAMES).toEqual(["standard", "explanatory", "learning"]);
  });
});

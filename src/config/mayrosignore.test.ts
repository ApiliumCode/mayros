import { describe, it, expect } from "vitest";
import { shouldIgnore, loadMayrosIgnore } from "./mayrosignore.js";

describe("shouldIgnore", () => {
  it("matches exact file name", () => {
    expect(shouldIgnore("node_modules", ["node_modules"])).toBe(true);
  });

  it("matches glob pattern", () => {
    expect(shouldIgnore("src/test.log", ["*.log"])).toBe(false); // *.log only matches root
    expect(shouldIgnore("test.log", ["*.log"])).toBe(true);
  });

  it("matches double-star pattern", () => {
    expect(shouldIgnore("src/deep/test.log", ["**/*.log"])).toBe(true);
  });

  it("returns false for non-matching path", () => {
    expect(shouldIgnore("src/main.ts", ["*.log"])).toBe(false);
  });

  it("handles negated pattern", () => {
    expect(shouldIgnore("important.log", ["!important.log"])).toBe(false);
  });

  it("handles empty patterns", () => {
    expect(shouldIgnore("anything", [])).toBe(false);
  });

  it("matches directory patterns", () => {
    expect(shouldIgnore("dist/bundle.js", ["dist/**"])).toBe(true);
  });
});

describe("loadMayrosIgnore", () => {
  it("returns empty patterns when no ignore file exists", () => {
    const result = loadMayrosIgnore("/nonexistent/path");
    expect(result.patterns).toEqual([]);
    expect(result.source).toBeNull();
  });
});

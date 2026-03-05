import { describe, expect, it } from "vitest";
import { buildContextBar, formatContextVisualization } from "./context-visualizer.js";

const stripAnsi = (str: string) =>
  str.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g"), "");

describe("buildContextBar", () => {
  it("shows 0% for no usage", () => {
    const bar = buildContextBar({ usedTokens: 0, maxTokens: 100_000 });
    expect(stripAnsi(bar)).toContain("0.0%");
  });

  it("shows 100% when full", () => {
    const bar = buildContextBar({ usedTokens: 100_000, maxTokens: 100_000 });
    expect(stripAnsi(bar)).toContain("100.0%");
  });

  it("clamps above 100%", () => {
    const bar = buildContextBar({ usedTokens: 200_000, maxTokens: 100_000 });
    expect(stripAnsi(bar)).toContain("100.0%");
  });

  it("shows partial usage", () => {
    const bar = buildContextBar({ usedTokens: 50_000, maxTokens: 100_000 });
    expect(stripAnsi(bar)).toContain("50.0%");
  });

  it("handles zero maxTokens", () => {
    const bar = buildContextBar({ usedTokens: 0, maxTokens: 0 });
    expect(bar).toBe("no context limit");
  });

  it("respects custom barWidth", () => {
    const bar = buildContextBar({ usedTokens: 50_000, maxTokens: 100_000, barWidth: 20 });
    // Bar should have [ ] and percentage
    const stripped = stripAnsi(bar);
    expect(stripped.startsWith("[")).toBe(true);
    expect(stripped).toContain("]");
  });
});

describe("formatContextVisualization", () => {
  it("includes header and bar", () => {
    const lines = formatContextVisualization({
      usedTokens: 30_000,
      maxTokens: 128_000,
    });
    const stripped = lines.map(stripAnsi);
    expect(stripped[0]).toBe("Context Window Usage");
    expect(stripped.some((l) => l.includes("%"))).toBe(true);
  });

  it("shows total line", () => {
    const lines = formatContextVisualization({
      usedTokens: 30_000,
      maxTokens: 128_000,
    });
    const stripped = lines.map(stripAnsi);
    expect(stripped.some((l) => l.includes("Total:"))).toBe(true);
    expect(stripped.some((l) => l.includes("30,000"))).toBe(true);
  });

  it("shows input/output when provided", () => {
    const lines = formatContextVisualization({
      usedTokens: 30_000,
      maxTokens: 128_000,
      inputTokens: 20_000,
      outputTokens: 10_000,
    });
    const stripped = lines.map(stripAnsi);
    expect(stripped.some((l) => l.includes("Input:"))).toBe(true);
    expect(stripped.some((l) => l.includes("Output:"))).toBe(true);
  });

  it("shows remaining tokens", () => {
    const lines = formatContextVisualization({
      usedTokens: 30_000,
      maxTokens: 128_000,
    });
    const stripped = lines.map(stripAnsi);
    expect(stripped.some((l) => l.includes("Free:"))).toBe(true);
    expect(stripped.some((l) => l.includes("98,000"))).toBe(true);
  });

  it("omits input/output when null", () => {
    const lines = formatContextVisualization({
      usedTokens: 0,
      maxTokens: 100_000,
    });
    const stripped = lines.map(stripAnsi);
    expect(stripped.some((l) => l.includes("Input:"))).toBe(false);
    expect(stripped.some((l) => l.includes("Output:"))).toBe(false);
  });
});

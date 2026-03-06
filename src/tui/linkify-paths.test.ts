import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { linkifyFilePaths } from "./linkify-paths.js";

const BEL = "\x07";
const ESC = "\x1b";
const osc8Open = (url: string) => `${ESC}]8;;${url}${BEL}`;
const osc8Close = () => `${ESC}]8;;${BEL}`;

describe("linkifyFilePaths", () => {
  beforeEach(() => {
    // Force TTY for consistent test results
  });

  it("linkifies absolute paths", () => {
    const result = linkifyFilePaths("/Users/foo/bar.ts", { force: true });
    expect(result).toContain(osc8Open("file:///Users/foo/bar.ts"));
    expect(result).toContain(osc8Close());
  });

  it("linkifies home-relative paths", () => {
    const result = linkifyFilePaths("~/project/file.ts", { force: true });
    expect(result).toContain("file://");
    expect(result).toContain("project/file.ts");
    expect(result).toContain(osc8Close());
  });

  it("linkifies relative paths with known extensions", () => {
    const result = linkifyFilePaths("src/foo/bar.ts", { force: true });
    expect(result).toContain("file://");
    expect(result).toContain(osc8Close());
  });

  it("linkifies paths with line:col suffix", () => {
    const result = linkifyFilePaths("/Users/foo/bar.ts:42:10", { force: true });
    expect(result).toContain("file:///Users/foo/bar.ts");
    expect(result).toContain(osc8Close());
  });

  it("does not linkify relative paths without known extension", () => {
    const result = linkifyFilePaths("src/foo/bar", { force: true });
    expect(result).toBe("src/foo/bar");
  });

  it("preserves surrounding text", () => {
    const result = linkifyFilePaths("Read /Users/foo/bar.ts done", { force: true });
    expect(result).toMatch(/^Read /);
    expect(result).toMatch(/done$/);
    expect(result).toContain(osc8Open("file:///Users/foo/bar.ts"));
  });

  it("applies color function when provided", () => {
    const color = (s: string) => `<C>${s}</C>`;
    const result = linkifyFilePaths("/Users/foo/bar.ts", { force: true, color });
    expect(result).toContain("<C>/Users/foo/bar.ts</C>");
  });

  it("returns plain text when force=false and no color", () => {
    const result = linkifyFilePaths("/Users/foo/bar.ts", { force: false });
    expect(result).toBe("/Users/foo/bar.ts");
  });

  it("applies only color when not TTY", () => {
    const color = (s: string) => `[${s}]`;
    const result = linkifyFilePaths("/Users/foo/bar.ts", { force: false, color });
    expect(result).toBe("[/Users/foo/bar.ts]");
    // No OSC 8
    expect(result).not.toContain(ESC);
  });

  it("handles multiple paths in one line", () => {
    const input = "Read /a/b.ts and /c/d.js";
    const result = linkifyFilePaths(input, { force: true });
    expect(result).toContain(osc8Open("file:///a/b.ts"));
    expect(result).toContain(osc8Open("file:///c/d.js"));
  });

  it("handles ./relative paths", () => {
    const result = linkifyFilePaths("./src/main.ts", { force: true });
    expect(result).toContain("file://");
    expect(result).toContain(osc8Close());
  });
});

import { describe, expect, it } from "vitest";
import { stripAnsi, visibleWidth } from "./ansi.js";

describe("stripAnsi", () => {
  it("strips SGR sequences", () => {
    expect(stripAnsi("\x1b[31mhello\x1b[0m")).toBe("hello");
  });

  it("strips OSC 8 links with ST terminator", () => {
    const link = `\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\`;
    expect(stripAnsi(link)).toBe("click");
  });

  it("strips OSC 8 links with BEL terminator", () => {
    const link = `\x1b]8;;https://example.com\x07click\x1b]8;;\x07`;
    expect(stripAnsi(link)).toBe("click");
  });

  it("strips mixed BEL open + ST close", () => {
    const link = `\x1b]8;;https://x.com\x07text\x1b]8;;\x1b\\`;
    expect(stripAnsi(link)).toBe("text");
  });

  it("returns plain text unchanged", () => {
    expect(stripAnsi("hello world")).toBe("hello world");
  });
});

describe("visibleWidth", () => {
  it("counts visible characters ignoring ANSI", () => {
    expect(visibleWidth("\x1b[31mab\x1b[0m")).toBe(2);
  });

  it("counts visible characters ignoring BEL-terminated OSC 8", () => {
    const link = `\x1b]8;;https://example.com\x07click\x1b]8;;\x07`;
    expect(visibleWidth(link)).toBe(5);
  });

  it("counts visible characters ignoring ST-terminated OSC 8", () => {
    const link = `\x1b]8;;https://example.com\x1b\\click\x1b]8;;\x1b\\`;
    expect(visibleWidth(link)).toBe(5);
  });
});

import { describe, it, expect } from "vitest";
import { buildSessionTitle, sanitizeTitle } from "./window-title.js";

describe("Window Title", () => {
  it("buildSessionTitle with no parts returns Mayros", () => {
    expect(buildSessionTitle({})).toBe("Mayros");
  });

  it("buildSessionTitle with agent", () => {
    expect(buildSessionTitle({ agent: "coder" })).toBe("Mayros — coder");
  });

  it("buildSessionTitle with all parts", () => {
    const title = buildSessionTitle({ agent: "coder", model: "claude", session: "abc123" });
    expect(title).toBe("Mayros — coder — claude — [abc123]");
  });

  it("buildSessionTitle with model only", () => {
    expect(buildSessionTitle({ model: "gpt-4" })).toBe("Mayros — gpt-4");
  });
});

import { describe, expect, it } from "vitest";
import { SECTION_CYCLE, nextSectionState } from "./tui-types.js";

describe("nextSectionState", () => {
  it("cycles hidden → collapsed", () => {
    expect(nextSectionState("hidden")).toBe("collapsed");
  });

  it("cycles collapsed → expanded", () => {
    expect(nextSectionState("collapsed")).toBe("expanded");
  });

  it("cycles expanded → hidden (wraps around)", () => {
    expect(nextSectionState("expanded")).toBe("hidden");
  });

  it("the cycle covers all three states in order", () => {
    expect(SECTION_CYCLE).toEqual(["hidden", "collapsed", "expanded"]);
  });

  it("produces a full cycle back to the start after 3 steps", () => {
    let state: "hidden" | "collapsed" | "expanded" = "hidden";
    state = nextSectionState(state);
    state = nextSectionState(state);
    state = nextSectionState(state);
    expect(state).toBe("hidden");
  });
});

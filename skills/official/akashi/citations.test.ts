import { describe, it, expect } from "vitest";
import { formatCitation, summarizeGrounding } from "./citations.js";
import type { GroundResponse } from "./types.js";

const passage = (source: string, lines: string) => ({
  source,
  lines,
  text: "…",
  provenance_anchor: "a".repeat(64),
});

describe("formatCitation", () => {
  it("renders source:lines in brackets", () => {
    expect(formatCitation(passage("decisions/db.md", "12-19"))).toBe("[decisions/db.md:12-19]");
  });

  it("omits the colon when lines are empty", () => {
    expect(formatCitation({ source: "decisions/db.md", lines: "" })).toBe("[decisions/db.md]");
  });
});

describe("summarizeGrounding", () => {
  const base: GroundResponse = {
    answer_context: [passage("a.md", "1-5"), passage("b.md", "7-9"), passage("a.md", "1-5")],
    answerable: true,
    groundedness: "grounded",
  };

  it("deduplicates citations and allows answering when grounded", () => {
    const s = summarizeGrounding(base);
    expect(s.canAnswer).toBe(true);
    expect(s.citations).toEqual(["[a.md:1-5]", "[b.md:7-9]"]);
  });

  it("blocks answering on ungrounded even if marked answerable", () => {
    const s = summarizeGrounding({ ...base, groundedness: "ungrounded" });
    expect(s.canAnswer).toBe(false);
  });

  it("surfaces weak verdicts without blocking", () => {
    const s = summarizeGrounding({ ...base, groundedness: "weak" });
    expect(s.canAnswer).toBe(true);
    expect(s.groundedness).toBe("weak");
  });

  it("flags a stale index", () => {
    const s = summarizeGrounding({ ...base, index_stale: true });
    expect(s.staleWarning).toBe(true);
  });
});

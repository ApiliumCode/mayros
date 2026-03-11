import { describe, it, expect } from "vitest";
import { detectIntent } from "./intent-detector.js";

describe("detectIntent", () => {
  it("detects var-to-const intent", () => {
    const r = detectIntent("convert var to const in `src/app.ts`");
    expect(r.kind).toBe("var-to-const");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.filePath).toBe("src/app.ts");
  });

  it("detects remove-console intent", () => {
    const r = detectIntent("remove all console.log statements from `utils/logger.ts`");
    expect(r.kind).toBe("remove-console");
    expect(r.confidence).toBeGreaterThan(0.5);
    expect(r.filePath).toBe("utils/logger.ts");
  });

  it("detects sort-imports intent", () => {
    const r = detectIntent("sort the imports in src/index.ts");
    expect(r.kind).toBe("sort-imports");
    expect(r.filePath).toBe("src/index.ts");
  });

  it("returns none for unrecognized prompts", () => {
    const r = detectIntent("explain how the auth system works");
    expect(r.kind).toBe("none");
    expect(r.confidence).toBe(0);
  });

  it("extracts file path from backticks", () => {
    const r = detectIntent("change var to const in `src/utils/helpers.ts`");
    expect(r.filePath).toBe("src/utils/helpers.ts");
  });

  it("boosts confidence when file path present", () => {
    const withFile = detectIntent("remove console in `app.ts`");
    const withoutFile = detectIntent("remove console statements");
    expect(withFile.confidence).toBeGreaterThan(withoutFile.confidence);
  });
});

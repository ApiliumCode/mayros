import { describe, expect, it } from "vitest";
import {
  SKILL_CATEGORIES,
  getCategoryById,
  formatCategoryList,
  type SkillCategory,
} from "./category-registry.js";

// ============================================================================
// Category registry tests
// ============================================================================

describe("SKILL_CATEGORIES", () => {
  it("contains 8 categories", () => {
    expect(SKILL_CATEGORIES).toHaveLength(8);
  });

  it("has unique IDs", () => {
    const ids = SKILL_CATEGORIES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("includes security category", () => {
    const sec = SKILL_CATEGORIES.find((c) => c.id === "security");
    expect(sec).toBeDefined();
    expect(sec!.name).toBe("Security");
    expect(sec!.icon).toBe("shield");
  });

  it("includes other category as catch-all", () => {
    const other = SKILL_CATEGORIES.find((c) => c.id === "other");
    expect(other).toBeDefined();
    expect(other!.name).toBe("Other");
  });
});

describe("getCategoryById", () => {
  it("returns matching category", () => {
    const cat = getCategoryById("testing");
    expect(cat).toBeDefined();
    expect(cat!.id).toBe("testing");
    expect(cat!.name).toBe("Testing");
  });

  it("returns undefined for unknown ID", () => {
    expect(getCategoryById("nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getCategoryById("")).toBeUndefined();
  });
});

describe("formatCategoryList", () => {
  it("returns a non-empty string", () => {
    const result = formatCategoryList();
    expect(result.length).toBeGreaterThan(0);
  });

  it("includes all category names", () => {
    const result = formatCategoryList();
    for (const cat of SKILL_CATEGORIES) {
      expect(result).toContain(cat.name);
    }
  });

  it("includes icons in bracket notation", () => {
    const result = formatCategoryList();
    expect(result).toContain("[shield]");
    expect(result).toContain("[gear]");
  });

  it("has one line per category", () => {
    const lines = formatCategoryList().split("\n");
    expect(lines).toHaveLength(SKILL_CATEGORIES.length);
  });
});

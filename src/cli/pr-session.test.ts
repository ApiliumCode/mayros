/**
 * PR Session Resume Tests
 *
 * Tests cover:
 * - buildPrSessionKey builds key from PR number and branch
 * - buildPrSessionKey sanitizes special characters in branch
 * - buildPrSessionKey truncates long branch names
 * - buildPrSessionKey handles simple branch names
 * - buildPrSessionKey handles numeric branch names
 * - buildPrSessionKey handles hyphens and underscores
 */

import { describe, it, expect } from "vitest";
import { buildPrSessionKey } from "./pr-session.js";

// ============================================================================
// buildPrSessionKey
// ============================================================================

describe("buildPrSessionKey", () => {
  it("builds key from PR number and branch", () => {
    expect(buildPrSessionKey(123, "fix/bug")).toBe("pr-123-fix-bug");
  });

  it("sanitizes special characters in branch", () => {
    expect(buildPrSessionKey(42, "feat/some feature!")).toBe("pr-42-feat-some-feature-");
  });

  it("truncates long branch names", () => {
    const longBranch = "a".repeat(100);
    const key = buildPrSessionKey(1, longBranch);
    // "pr-1-" = 5 chars + 50 max branch = 55
    expect(key.length).toBeLessThanOrEqual(55);
    expect(key).toBe(`pr-1-${"a".repeat(50)}`);
  });

  it("handles simple branch names", () => {
    expect(buildPrSessionKey(7, "main")).toBe("pr-7-main");
  });

  it("handles numeric branch names", () => {
    expect(buildPrSessionKey(99, "123")).toBe("pr-99-123");
  });

  it("handles hyphens and underscores", () => {
    expect(buildPrSessionKey(5, "my_feature-v2")).toBe("pr-5-my_feature-v2");
  });
});

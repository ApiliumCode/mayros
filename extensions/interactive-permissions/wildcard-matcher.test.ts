/**
 * Wildcard Matcher Tests
 *
 * Tests cover: parsing wildcard expressions, command prefix matching,
 * path glob matching, tool alias resolution, edge cases.
 */

import { describe, it, expect } from "vitest";
import {
  parsePermissionWildcard,
  matchesWildcardPermission,
  isWildcardExpression,
} from "./wildcard-matcher.js";

// ============================================================================
// parsePermissionWildcard
// ============================================================================

describe("parsePermissionWildcard", () => {
  it("parses simple Bash(git:*)", () => {
    const result = parsePermissionWildcard("Bash(git:*)");
    expect(result).toEqual({ tool: "Bash", prefixes: ["git"] });
  });

  it("parses multiple prefixes", () => {
    const result = parsePermissionWildcard("Bash(cd:*, ls:*, cat:*)");
    expect(result).toEqual({ tool: "Bash", prefixes: ["cd", "ls", "cat"] });
  });

  it("parses path-style wildcards", () => {
    const result = parsePermissionWildcard("code_read(src/**)");
    expect(result).toEqual({ tool: "code_read", prefixes: ["src/**"] });
  });

  it("returns null for invalid expressions", () => {
    expect(parsePermissionWildcard("")).toBeNull();
    expect(parsePermissionWildcard("just-text")).toBeNull();
    expect(parsePermissionWildcard("*")).toBeNull();
    expect(parsePermissionWildcard("Bash()")).toBeNull();
  });

  it("handles whitespace", () => {
    const result = parsePermissionWildcard("  Bash( git:* , npm:* )  ");
    expect(result).toEqual({ tool: "Bash", prefixes: ["git", "npm"] });
  });

  it("strips :* suffix from prefixes", () => {
    const result = parsePermissionWildcard("Bash(git:*, npm:*)");
    expect(result?.prefixes).toEqual(["git", "npm"]);
  });
});

// ============================================================================
// matchesWildcardPermission — command prefix matching
// ============================================================================

describe("matchesWildcardPermission — commands", () => {
  it("matches git commands with Bash(git:*)", () => {
    const wc = { tool: "Bash", prefixes: ["git"] };
    expect(matchesWildcardPermission("exec", { command: "git status" }, wc)).toBe(true);
    expect(matchesWildcardPermission("exec", { command: "git commit -m 'test'" }, wc)).toBe(true);
    expect(matchesWildcardPermission("exec", { command: "git" }, wc)).toBe(true);
    expect(matchesWildcardPermission("exec", { command: "gitk" }, wc)).toBe(false);
    expect(matchesWildcardPermission("exec", { command: "rm -rf" }, wc)).toBe(false);
  });

  it("matches code_shell commands", () => {
    const wc = { tool: "Bash", prefixes: ["npm"] };
    expect(matchesWildcardPermission("code_shell", { command: "npm install" }, wc)).toBe(true);
    expect(matchesWildcardPermission("code_shell", { command: "npm test" }, wc)).toBe(true);
    expect(matchesWildcardPermission("code_shell", { command: "yarn install" }, wc)).toBe(false);
  });

  it("matches multiple command prefixes", () => {
    const wc = { tool: "Bash", prefixes: ["git", "npm", "yarn"] };
    expect(matchesWildcardPermission("exec", { command: "git push" }, wc)).toBe(true);
    expect(matchesWildcardPermission("exec", { command: "npm publish" }, wc)).toBe(true);
    expect(matchesWildcardPermission("exec", { command: "yarn add react" }, wc)).toBe(true);
    expect(matchesWildcardPermission("exec", { command: "rm -rf /" }, wc)).toBe(false);
  });

  it("handles empty command gracefully", () => {
    const wc = { tool: "Bash", prefixes: ["git"] };
    expect(matchesWildcardPermission("exec", { command: "" }, wc)).toBe(false);
    expect(matchesWildcardPermission("exec", {}, wc)).toBe(false);
  });
});

// ============================================================================
// matchesWildcardPermission — path matching
// ============================================================================

describe("matchesWildcardPermission — paths", () => {
  it("matches file reads with path wildcards", () => {
    const wc = { tool: "code_read", prefixes: ["src/**"] };
    expect(matchesWildcardPermission("code_read", { path: "src/main.ts" }, wc)).toBe(true);
    expect(matchesWildcardPermission("code_read", { path: "src/lib/utils.ts" }, wc)).toBe(true);
    expect(matchesWildcardPermission("code_read", { path: "tests/main.test.ts" }, wc)).toBe(false);
  });

  it("matches file writes with path wildcards", () => {
    const wc = { tool: "code_write", prefixes: ["src/**"] };
    expect(matchesWildcardPermission("code_write", { path: "src/new-file.ts" }, wc)).toBe(true);
    expect(matchesWildcardPermission("code_write", { path: "package.json" }, wc)).toBe(false);
  });

  it("handles single-level glob (/*) correctly", () => {
    const wc = { tool: "code_read", prefixes: ["src/*"] };
    expect(matchesWildcardPermission("code_read", { path: "src/index.ts" }, wc)).toBe(true);
    expect(matchesWildcardPermission("code_read", { path: "src/lib/deep.ts" }, wc)).toBe(false);
  });

  it("matches grep path argument", () => {
    const wc = { tool: "code_grep", prefixes: ["src/**"] };
    // When both pattern and path are present, path is used for matching
    expect(
      matchesWildcardPermission("code_grep", { pattern: "TODO", path: "src/main.ts" }, wc),
    ).toBe(true);
    // Path outside allowed prefix is rejected
    expect(
      matchesWildcardPermission("code_grep", { pattern: "TODO", path: "tests/foo.ts" }, wc),
    ).toBe(false);
    // When only path arg is present
    expect(matchesWildcardPermission("code_grep", { path: "src/lib/utils.ts" }, wc)).toBe(true);
  });
});

// ============================================================================
// matchesWildcardPermission — tool alias resolution
// ============================================================================

describe("matchesWildcardPermission — tool aliases", () => {
  it("rejects non-matching tool names", () => {
    const wc = { tool: "Bash", prefixes: ["git"] };
    expect(matchesWildcardPermission("code_read", { path: "git/config" }, wc)).toBe(false);
  });

  it("resolves read alias for code_read", () => {
    const wc = { tool: "code_read", prefixes: ["src/**"] };
    expect(matchesWildcardPermission("read", { path: "src/index.ts" }, wc)).toBe(true);
  });

  it("resolves write alias for code_write", () => {
    const wc = { tool: "code_write", prefixes: ["tests/**"] };
    expect(matchesWildcardPermission("write", { path: "tests/foo.test.ts" }, wc)).toBe(true);
  });

  it("resolves edit alias for code_edit", () => {
    const wc = { tool: "code_edit", prefixes: ["src/**"] };
    expect(matchesWildcardPermission("edit", { path: "src/mod.ts" }, wc)).toBe(true);
  });
});

// ============================================================================
// matchesWildcardPermission — unknown tools fallback
// ============================================================================

describe("matchesWildcardPermission — unknown tools", () => {
  it("matches string arg values against prefixes for unknown tools", () => {
    const wc = { tool: "custom_tool", prefixes: ["allowed_ns"] };
    expect(matchesWildcardPermission("custom_tool", { ns: "allowed_ns:foo" }, wc)).toBe(true);
    expect(matchesWildcardPermission("custom_tool", { ns: "denied_ns:bar" }, wc)).toBe(false);
  });
});

// ============================================================================
// isWildcardExpression
// ============================================================================

describe("isWildcardExpression", () => {
  it("detects wildcard expressions", () => {
    expect(isWildcardExpression("Bash(git:*)")).toBe(true);
    expect(isWildcardExpression("code_read(src/**)")).toBe(true);
    expect(isWildcardExpression("Tool(a:*, b:*)")).toBe(true);
  });

  it("rejects non-wildcard expressions", () => {
    expect(isWildcardExpression("*")).toBe(false);
    expect(isWildcardExpression("git")).toBe(false);
    expect(isWildcardExpression("")).toBe(false);
    expect(isWildcardExpression("Bash()")).toBe(false);
  });
});

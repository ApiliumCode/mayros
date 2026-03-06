import { describe, it, expect } from "vitest";
import { getShellCompletions, listProviderPrefixes } from "./shell-completions.js";

describe("Shell Completions", () => {
  // 1
  it("returns git subcommands for 'git ' prefix", () => {
    const completions = getShellCompletions("git ");
    expect(completions.length).toBeGreaterThan(10);
    const values = completions.map((c) => c.value);
    expect(values).toContain("status");
    expect(values).toContain("commit");
    expect(values).toContain("push");
  });

  // 2
  it("filters git subcommands by partial input", () => {
    const completions = getShellCompletions("git st");
    expect(completions.length).toBeGreaterThanOrEqual(2);
    const values = completions.map((c) => c.value);
    expect(values).toContain("status");
    expect(values).toContain("stash");
  });

  // 3
  it("returns npm subcommands", () => {
    const completions = getShellCompletions("npm ");
    expect(completions.length).toBeGreaterThan(5);
    const values = completions.map((c) => c.value);
    expect(values).toContain("install");
    expect(values).toContain("test");
  });

  // 4
  it("returns pnpm subcommands", () => {
    const completions = getShellCompletions("pnpm ");
    expect(completions.length).toBeGreaterThan(5);
    const values = completions.map((c) => c.value);
    expect(values).toContain("install");
    expect(values).toContain("add");
  });

  // 5
  it("returns empty for unknown commands", () => {
    expect(getShellCompletions("unknown ")).toHaveLength(0);
    expect(getShellCompletions("")).toHaveLength(0);
    expect(getShellCompletions("hello world")).toHaveLength(0);
  });

  // 6
  it("does not complete nested arguments", () => {
    expect(getShellCompletions("git commit -m")).toHaveLength(0);
    expect(getShellCompletions("npm run test")).toHaveLength(0);
  });

  // 7
  it("completions have descriptions", () => {
    const completions = getShellCompletions("git ");
    for (const c of completions) {
      expect(c.description).toBeDefined();
      expect(c.description!.length).toBeGreaterThan(0);
    }
  });

  // 8
  it("listProviderPrefixes returns known prefixes", () => {
    const prefixes = listProviderPrefixes();
    expect(prefixes).toContain("git");
    expect(prefixes).toContain("npm");
    expect(prefixes).toContain("pnpm");
    expect(prefixes).toContain("yarn");
  });

  // 9
  it("yarn shares npm completions", () => {
    const yarn = getShellCompletions("yarn ");
    const npm = getShellCompletions("npm ");
    // yarn should have same completions as npm
    expect(yarn.length).toBe(npm.length);
  });

  // 10
  it("handles leading whitespace", () => {
    const completions = getShellCompletions("  git ");
    expect(completions.length).toBeGreaterThan(0);
  });
});

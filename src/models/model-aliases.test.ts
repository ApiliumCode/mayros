import { describe, expect, it } from "vitest";
import { listModelAliases, resolveModelAlias } from "./model-aliases.js";

describe("resolveModelAlias", () => {
  it("resolves known aliases to full identifiers", () => {
    expect(resolveModelAlias("sonnet")).toBe("anthropic/claude-sonnet");
    expect(resolveModelAlias("opus")).toBe("anthropic/claude-opus");
    expect(resolveModelAlias("haiku")).toBe("anthropic/claude-haiku");
    expect(resolveModelAlias("gemini-pro")).toBe("google/gemini-pro");
    expect(resolveModelAlias("gemini-flash")).toBe("google/gemini-flash");
    expect(resolveModelAlias("gpt4")).toBe("openai/gpt-4");
    expect(resolveModelAlias("gpt4o")).toBe("openai/gpt-4o");
  });

  it("is case-insensitive", () => {
    expect(resolveModelAlias("Sonnet")).toBe("anthropic/claude-sonnet");
    expect(resolveModelAlias("OPUS")).toBe("anthropic/claude-opus");
    expect(resolveModelAlias("GPT4O")).toBe("openai/gpt-4o");
  });

  it("returns the input unchanged for unknown aliases", () => {
    expect(resolveModelAlias("custom/my-model")).toBe("custom/my-model");
    expect(resolveModelAlias("anthropic/claude-sonnet")).toBe("anthropic/claude-sonnet");
  });

  it("returns empty string unchanged", () => {
    expect(resolveModelAlias("")).toBe("");
  });
});

describe("listModelAliases", () => {
  it("returns all known aliases", () => {
    const aliases = listModelAliases();
    expect(Object.keys(aliases).length).toBeGreaterThanOrEqual(7);
    expect(aliases.sonnet).toBe("anthropic/claude-sonnet");
    expect(aliases.opus).toBe("anthropic/claude-opus");
  });

  it("returns a copy (not the original reference)", () => {
    const a = listModelAliases();
    const b = listModelAliases();
    expect(a).not.toBe(b);
    expect(a).toEqual(b);
  });

  it("modifications do not affect future calls", () => {
    const a = listModelAliases();
    a.custom = "test/custom";
    const b = listModelAliases();
    expect(b.custom).toBeUndefined();
  });
});

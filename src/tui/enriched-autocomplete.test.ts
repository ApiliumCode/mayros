import { describe, expect, it, vi } from "vitest";
import type { AutocompleteItem, AutocompleteProvider } from "@mariozechner/pi-tui";
import { EnrichedAutocompleteProvider, createEnrichedProvider } from "./enriched-autocomplete.js";

function createMockBase(
  suggestions: { items: AutocompleteItem[]; prefix: string } | null = {
    items: [{ value: "file.ts", label: "file.ts" }],
    prefix: "@",
  },
): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(() => suggestions),
    applyCompletion: vi.fn((_lines, cursorLine, cursorCol, _item, _prefix) => ({
      lines: [],
      cursorLine,
      cursorCol,
    })),
  };
}

describe("EnrichedAutocompleteProvider", () => {
  it("delegates to base when no queryFn provided", () => {
    const base = createMockBase();
    const provider = new EnrichedAutocompleteProvider(base);
    const result = provider.getSuggestions(["@fi"], 0, 3);
    expect(result).toEqual({ items: [{ value: "file.ts", label: "file.ts" }], prefix: "@" });
  });

  it("delegates to base when base returns null", () => {
    const base = createMockBase(null);
    const queryFn = vi.fn(async () => []);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    const result = provider.getSuggestions(["@fi"], 0, 3);
    expect(result).toBeNull();
  });

  it("fires async query on @ prefix", () => {
    const base = createMockBase();
    const queryFn = vi.fn(async () => [{ value: "sym:Foo", label: "Foo", description: "class" }]);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    provider.getSuggestions(["@fi"], 0, 3);
    expect(queryFn).toHaveBeenCalledWith("fi");
  });

  it("returns cached results on subsequent call", async () => {
    const base = createMockBase();
    const enrichedItems = [{ value: "sym:Foo", label: "Foo", description: "class" }];
    const queryFn = vi.fn(async () => enrichedItems);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);

    // First call triggers async fetch
    provider.getSuggestions(["@fi"], 0, 3);
    // Wait for the query to resolve
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalled());
    // Small delay to allow cache to be set
    await new Promise((r) => setTimeout(r, 10));

    // Second call should use cache
    const result = provider.getSuggestions(["@fi"], 0, 3);
    expect(result?.items).toHaveLength(2);
    expect(result?.items[1]?.value).toBe("sym:Foo");
  });

  it("deduplicates items between base and enriched", async () => {
    const base = createMockBase({
      items: [{ value: "file.ts", label: "file.ts" }],
      prefix: "@",
    });
    const queryFn = vi.fn(async () => [
      { value: "file.ts", label: "file.ts" },
      { value: "other.ts", label: "other.ts" },
    ]);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);

    provider.getSuggestions(["@fi"], 0, 3);
    await new Promise((r) => setTimeout(r, 10));

    const result = provider.getSuggestions(["@fi"], 0, 3);
    expect(result?.items).toHaveLength(2);
    const values = result?.items.map((i) => i.value);
    expect(values).toContain("file.ts");
    expect(values).toContain("other.ts");
  });

  it("does not fire query when no @ prefix", () => {
    const base = createMockBase({ items: [], prefix: "/" });
    const queryFn = vi.fn(async () => []);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    provider.getSuggestions(["hello"], 0, 5);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("handles queryFn errors gracefully", async () => {
    const base = createMockBase();
    const queryFn = vi.fn(async () => {
      throw new Error("network error");
    });
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    const result = provider.getSuggestions(["@fi"], 0, 3);
    expect(result).not.toBeNull();
    // Wait for the rejected promise to settle
    await new Promise((r) => setTimeout(r, 10));
  });

  it("evicts oldest cache entry when maxCache exceeded", async () => {
    const base = createMockBase();
    let callCount = 0;
    const queryFn = vi.fn(async (prefix: string) => {
      callCount++;
      return [{ value: `sym:${prefix}`, label: prefix }];
    });
    const provider = new EnrichedAutocompleteProvider(base, queryFn, { maxCache: 2 });

    // Fill cache with 2 entries
    provider.getSuggestions(["@a"], 0, 2);
    await new Promise((r) => setTimeout(r, 10));
    provider.getSuggestions(["@b"], 0, 2);
    await new Promise((r) => setTimeout(r, 10));

    // This should evict "a"
    provider.getSuggestions(["@c"], 0, 2);
    await new Promise((r) => setTimeout(r, 10));

    // "a" should re-trigger query
    queryFn.mockClear();
    provider.getSuggestions(["@a"], 0, 2);
    expect(queryFn).toHaveBeenCalledWith("a");
  });

  it("delegates applyCompletion to base", () => {
    const base = createMockBase();
    const provider = new EnrichedAutocompleteProvider(base);
    provider.applyCompletion(["@test"], 0, 5, { value: "test", label: "test" }, "@");
    expect(base.applyCompletion).toHaveBeenCalled();
  });
});

describe("createEnrichedProvider", () => {
  it("returns an EnrichedAutocompleteProvider instance", () => {
    const base = createMockBase();
    const provider = createEnrichedProvider(base);
    expect(provider).toBeInstanceOf(EnrichedAutocompleteProvider);
  });
});

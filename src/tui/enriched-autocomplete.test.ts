import { describe, expect, it, vi } from "vitest";
import type { AutocompleteItem, AutocompleteProvider } from "@earendil-works/pi-tui";
import { EnrichedAutocompleteProvider, createEnrichedProvider } from "./enriched-autocomplete.js";

const options = { signal: new AbortController().signal };

function createMockBase(
  suggestions: { items: AutocompleteItem[]; prefix: string } | null = {
    items: [{ value: "file.ts", label: "file.ts" }],
    prefix: "@",
  },
): AutocompleteProvider {
  return {
    getSuggestions: vi.fn(async () => suggestions),
    applyCompletion: vi.fn((_lines, cursorLine, cursorCol, _item, _prefix) => ({
      lines: [],
      cursorLine,
      cursorCol,
    })),
  };
}

describe("EnrichedAutocompleteProvider", () => {
  it("delegates to base when no queryFn provided", async () => {
    const base = createMockBase();
    const provider = new EnrichedAutocompleteProvider(base);
    const result = await provider.getSuggestions(["@fi"], 0, 3, options);
    expect(result).toEqual({ items: [{ value: "file.ts", label: "file.ts" }], prefix: "@" });
  });

  it("delegates to base when base returns null", async () => {
    const base = createMockBase(null);
    const queryFn = vi.fn(async () => []);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    const result = await provider.getSuggestions(["@fi"], 0, 3, options);
    expect(result).toBeNull();
  });

  it("fires async query on @ prefix", async () => {
    const base = createMockBase();
    const queryFn = vi.fn(async () => [{ value: "sym:Foo", label: "Foo", description: "class" }]);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    await provider.getSuggestions(["@fi"], 0, 3, options);
    expect(queryFn).toHaveBeenCalledWith("fi");
  });

  it("returns cached results on subsequent call", async () => {
    const base = createMockBase();
    const enrichedItems = [{ value: "sym:Foo", label: "Foo", description: "class" }];
    const queryFn = vi.fn(async () => enrichedItems);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);

    // First call triggers async fetch
    await provider.getSuggestions(["@fi"], 0, 3, options);
    // Wait for the query to resolve
    await vi.waitFor(() => expect(queryFn).toHaveBeenCalled());
    // Small delay to allow cache to be set
    await new Promise((r) => setTimeout(r, 10));

    // Second call should use cache
    const result = await provider.getSuggestions(["@fi"], 0, 3, options);
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

    await provider.getSuggestions(["@fi"], 0, 3, options);
    await new Promise((r) => setTimeout(r, 10));

    const result = await provider.getSuggestions(["@fi"], 0, 3, options);
    expect(result?.items).toHaveLength(2);
    const values = result?.items.map((i) => i.value);
    expect(values).toContain("file.ts");
    expect(values).toContain("other.ts");
  });

  it("does not fire query when no @ prefix", async () => {
    const base = createMockBase({ items: [], prefix: "/" });
    const queryFn = vi.fn(async () => []);
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    await provider.getSuggestions(["hello"], 0, 5, options);
    expect(queryFn).not.toHaveBeenCalled();
  });

  it("handles queryFn errors gracefully", async () => {
    const base = createMockBase();
    const queryFn = vi.fn(async () => {
      throw new Error("network error");
    });
    const provider = new EnrichedAutocompleteProvider(base, queryFn);
    const result = await provider.getSuggestions(["@fi"], 0, 3, options);
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
    await provider.getSuggestions(["@a"], 0, 2, options);
    await new Promise((r) => setTimeout(r, 10));
    await provider.getSuggestions(["@b"], 0, 2, options);
    await new Promise((r) => setTimeout(r, 10));

    // This should evict "a"
    await provider.getSuggestions(["@c"], 0, 2, options);
    await new Promise((r) => setTimeout(r, 10));

    // "a" should re-trigger query
    queryFn.mockClear();
    await provider.getSuggestions(["@a"], 0, 2, options);
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

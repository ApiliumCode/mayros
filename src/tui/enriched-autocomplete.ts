import type { AutocompleteItem, AutocompleteProvider } from "@mariozechner/pi-tui";

type CachedEntry = {
  items: AutocompleteItem[];
  expiresAt: number;
};

export type SymbolQueryFn = (prefix: string) => Promise<AutocompleteItem[]>;

export class EnrichedAutocompleteProvider implements AutocompleteProvider {
  private base: AutocompleteProvider;
  private queryFn: SymbolQueryFn | null;
  private cache = new Map<string, CachedEntry>();
  private maxCache: number;
  private ttlMs: number;
  private pendingQuery: Promise<AutocompleteItem[]> | null = null;
  private pendingPrefix: string | null = null;

  constructor(
    base: AutocompleteProvider,
    queryFn?: SymbolQueryFn | null,
    opts?: { maxCache?: number; ttlMs?: number },
  ) {
    this.base = base;
    this.queryFn = queryFn ?? null;
    this.maxCache = opts?.maxCache ?? 50;
    this.ttlMs = opts?.ttlMs ?? 30_000;
  }

  getSuggestions(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
  ): { items: AutocompleteItem[]; prefix: string } | null {
    const baseSuggestions = this.base.getSuggestions(lines, cursorLine, cursorCol);
    if (!this.queryFn || !baseSuggestions) {
      return baseSuggestions;
    }
    // Detect @ prefix: find the @ token leading up to the cursor.
    const line = lines[cursorLine] ?? "";
    const textBeforeCursor = line.slice(0, cursorCol);
    const atMatch = textBeforeCursor.match(/@([\w./-]*)$/);
    if (!atMatch) {
      return baseSuggestions;
    }
    const atPrefix = atMatch[1] ?? "";
    const cached = this.getCached(atPrefix);
    if (cached) {
      return {
        items: this.mergeItems(baseSuggestions.items, cached),
        prefix: baseSuggestions.prefix,
      };
    }
    // Fire async query (non-blocking). Results show up on next keystroke.
    if (this.pendingPrefix !== atPrefix) {
      this.pendingPrefix = atPrefix;
      this.pendingQuery = this.queryFn(atPrefix)
        .then((items) => {
          this.setCache(atPrefix, items);
          return items;
        })
        .catch(() => []);
    }
    return baseSuggestions;
  }

  applyCompletion(
    lines: string[],
    cursorLine: number,
    cursorCol: number,
    item: AutocompleteItem,
    prefix: string,
  ): { lines: string[]; cursorLine: number; cursorCol: number } {
    return this.base.applyCompletion(lines, cursorLine, cursorCol, item, prefix);
  }

  private getCached(prefix: string): AutocompleteItem[] | null {
    const entry = this.cache.get(prefix);
    if (!entry) {
      return null;
    }
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(prefix);
      return null;
    }
    return entry.items;
  }

  private setCache(prefix: string, items: AutocompleteItem[]): void {
    if (this.cache.size >= this.maxCache) {
      const oldest = this.cache.keys().next().value;
      if (oldest !== undefined) {
        this.cache.delete(oldest);
      }
    }
    this.cache.set(prefix, { items, expiresAt: Date.now() + this.ttlMs });
  }

  private mergeItems(base: AutocompleteItem[], enriched: AutocompleteItem[]): AutocompleteItem[] {
    const seen = new Set(base.map((i) => i.value));
    const extra = enriched.filter((i) => !seen.has(i.value));
    return [...base, ...extra];
  }
}

export function createEnrichedProvider(
  base: AutocompleteProvider,
  queryFn?: SymbolQueryFn | null,
): EnrichedAutocompleteProvider {
  return new EnrichedAutocompleteProvider(base, queryFn);
}

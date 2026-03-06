import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

const HISTORY_FILE = join(homedir(), ".mayros", "input-history.json");
const MAX_ENTRIES = 500;

export type InputHistoryStore = {
  load(): string[];
  save(entries: string[]): void;
  append(entry: string): void;
};

export function createInputHistoryStore(): InputHistoryStore {
  function load(): string[] {
    try {
      const data = readFileSync(HISTORY_FILE, "utf-8");
      const parsed = JSON.parse(data);
      if (Array.isArray(parsed))
        return parsed.filter((e): e is string => typeof e === "string").slice(-MAX_ENTRIES);
    } catch {
      /* first run or corrupted */
    }
    return [];
  }

  function save(entries: string[]): void {
    const trimmed = entries.slice(-MAX_ENTRIES);
    try {
      mkdirSync(dirname(HISTORY_FILE), { recursive: true });
      writeFileSync(HISTORY_FILE, JSON.stringify(trimmed), "utf-8");
    } catch {
      /* read-only fs, ignore */
    }
  }

  function append(entry: string): void {
    if (!entry.trim()) return;
    const current = load();
    // Deduplicate: remove previous occurrence
    const deduped = current.filter((e) => e !== entry);
    deduped.push(entry);
    save(deduped);
  }

  return { load, save, append };
}

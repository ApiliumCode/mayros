/**
 * Skill Hot-Reload Watcher
 *
 * Watches skill directories for changes to SKILL.md and skill.ts
 * using fs.watch (Node 22+ supports recursive on all OS).
 * Debounces changes to avoid rapid re-loads.
 */

import { watch, type FSWatcher } from "node:fs";
import { basename } from "node:path";

export type SkillChangeEvent = {
  skillDir: string;
  file: string;
  timestamp: number;
};

export type SkillWatcherOptions = {
  debounceMs?: number;
};

const DEFAULT_DEBOUNCE_MS = 300;
const WATCHED_FILES = new Set(["SKILL.md", "skill.ts", "skill.js"]);

export class SkillWatcher {
  private watcher: FSWatcher | null = null;
  private debounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private debounceMs: number;
  private stopped = false;

  constructor(options?: SkillWatcherOptions) {
    this.debounceMs = options?.debounceMs ?? DEFAULT_DEBOUNCE_MS;
  }

  /**
   * Start watching a directory for skill file changes.
   * Calls onChange when SKILL.md or skill.ts/skill.js are modified.
   */
  watch(dir: string, onChange: (event: SkillChangeEvent) => void): void {
    if (this.watcher) {
      this.stop();
    }

    this.stopped = false;

    try {
      this.watcher = watch(dir, { recursive: true }, (_eventType, filename) => {
        if (this.stopped || !filename) return;

        const base = basename(filename);
        if (!WATCHED_FILES.has(base)) return;

        // Debounce per-file
        const key = filename;
        const existing = this.debounceTimers.get(key);
        if (existing) clearTimeout(existing);

        this.debounceTimers.set(
          key,
          setTimeout(() => {
            this.debounceTimers.delete(key);
            if (!this.stopped) {
              onChange({
                skillDir: dir,
                file: filename,
                timestamp: Date.now(),
              });
            }
          }, this.debounceMs),
        );
      });
    } catch {
      // fs.watch may throw on unsupported platforms — fail gracefully
      this.watcher = null;
    }
  }

  /**
   * Stop watching and clean up all timers.
   */
  stop(): void {
    this.stopped = true;

    for (const timer of this.debounceTimers.values()) {
      clearTimeout(timer);
    }
    this.debounceTimers.clear();

    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }

  get isWatching(): boolean {
    return this.watcher !== null && !this.stopped;
  }
}

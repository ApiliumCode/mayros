/**
 * Undo Manager
 *
 * Manages undo points using git stash. Before code_write/code_edit operations,
 * creates a stash entry tagged with "mayros-undo". Supports undo and list.
 */

import { execFileSync } from "node:child_process";

const MAYROS_STASH_PREFIX = "mayros-undo-";
const MAX_UNDO_ENTRIES = 10;

export type UndoEntry = {
  index: number;
  label: string;
  timestamp: string;
};

/**
 * Create an undo point by stashing current changes.
 * Returns the stash label or null if nothing to stash.
 */
export function createUndoPoint(cwd: string, description?: string): string | null {
  try {
    // Check if there are changes to stash
    const status = execFileSync("git", ["status", "--porcelain"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!status) return null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const label = `${MAYROS_STASH_PREFIX}${timestamp}${description ? `-${description}` : ""}`;

    // Stage all changes then stash
    execFileSync("git", ["stash", "push", "-m", label, "--include-untracked"], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    });

    // Re-apply changes (stash keeps a copy for undo)
    execFileSync("git", ["stash", "apply"], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    });

    // Prune old undo entries beyond MAX
    pruneOldEntries(cwd);

    return label;
  } catch {
    return null;
  }
}

/**
 * Pop the last mayros-tagged stash entry (undo last change).
 */
export function undo(cwd: string): { success: boolean; message: string } {
  try {
    const entries = listUndoEntries(cwd);
    if (entries.length === 0) {
      return { success: false, message: "No undo points available" };
    }

    const latest = entries[0];
    execFileSync("git", ["stash", "pop", `stash@{${latest.index}}`], {
      cwd,
      encoding: "utf-8",
      timeout: 10000,
    });

    return { success: true, message: `Restored: ${latest.label}` };
  } catch (err) {
    return { success: false, message: `Undo failed: ${String(err)}` };
  }
}

/**
 * List all mayros-tagged stash entries.
 */
export function listUndoEntries(cwd: string): UndoEntry[] {
  try {
    const output = execFileSync("git", ["stash", "list"], {
      cwd,
      encoding: "utf-8",
      timeout: 5000,
    }).trim();

    if (!output) return [];

    const entries: UndoEntry[] = [];
    for (const line of output.split("\n")) {
      const match = line.match(/^stash@\{(\d+)\}:\s+.*?:\s+(mayros-undo-.+)$/);
      if (match) {
        const index = parseInt(match[1], 10);
        const label = match[2];
        // Extract timestamp from label
        const tsMatch = label.match(/mayros-undo-(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2})/);
        const timestamp = tsMatch
          ? tsMatch[1].replace(/-/g, (m, offset) => (offset > 9 ? ":" : "-")).replace("T", " ")
          : "";
        entries.push({ index, label, timestamp });
      }
    }

    return entries;
  } catch {
    return [];
  }
}

/**
 * Remove old undo entries beyond MAX_UNDO_ENTRIES.
 */
function pruneOldEntries(cwd: string): void {
  try {
    const entries = listUndoEntries(cwd);
    if (entries.length <= MAX_UNDO_ENTRIES) return;

    // Drop oldest entries (highest index numbers)
    const toRemove = entries.slice(MAX_UNDO_ENTRIES);
    for (const entry of toRemove.reverse()) {
      try {
        execFileSync("git", ["stash", "drop", `stash@{${entry.index}}`], {
          cwd,
          encoding: "utf-8",
          timeout: 5000,
        });
      } catch {
        // Best effort
      }
    }
  } catch {
    // Best effort
  }
}

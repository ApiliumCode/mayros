/**
 * Audit Log
 *
 * In-memory ring buffer of sandbox decisions (allowed, blocked, warned)
 * for debugging and observability. Bounded by maxEntries to prevent
 * unbounded memory growth.
 */

// ============================================================================
// Types
// ============================================================================

export type AuditEntry = {
  timestamp: string;
  command: string;
  action: "allowed" | "blocked" | "warned";
  reason?: string;
  matchedPattern?: string;
  sessionKey?: string;
};

// ============================================================================
// AuditLog Class
// ============================================================================

export class AuditLog {
  private entries: AuditEntry[] = [];
  private readonly maxEntries: number;

  constructor(maxEntries = 1000) {
    this.maxEntries = Math.max(1, Math.floor(maxEntries));
  }

  /**
   * Add a new audit entry. Automatically timestamps and trims the log
   * if it exceeds the configured maximum.
   */
  add(entry: Omit<AuditEntry, "timestamp">): void {
    const full: AuditEntry = {
      ...entry,
      timestamp: new Date().toISOString(),
    };
    this.entries.push(full);

    if (this.entries.length > this.maxEntries) {
      this.entries.splice(0, this.entries.length - this.maxEntries);
    }
  }

  /**
   * Get the most recent audit entries, newest first.
   *
   * @param limit - Maximum number of entries to return (default: 50).
   */
  getRecent(limit = 50): AuditEntry[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    return this.entries.slice(-safeLimit).reverse();
  }

  /**
   * Get only blocked entries, newest first.
   *
   * @param limit - Maximum number of entries to return (default: 50).
   */
  getBlocked(limit = 50): AuditEntry[] {
    const safeLimit = Math.max(1, Math.floor(limit));
    return this.entries
      .filter((e) => e.action === "blocked")
      .slice(-safeLimit)
      .reverse();
  }

  /**
   * Get the total count of entries currently in the log.
   */
  get size(): number {
    return this.entries.length;
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.entries = [];
  }
}

/**
 * Session Manager for Remote Exec
 *
 * Manages per-sender state: working directory persistence and output paging.
 * Sessions are keyed by channel:senderId and pruned on TTL expiry.
 */

import type { SessionConfig } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type OutputPage = {
  content: string;
  lineCount: number;
};

export type OutputCache = {
  pages: OutputPage[];
  currentPage: number;
  totalLines: number;
  command: string;
  cachedAt: number;
};

export type HistoryEntry = {
  command: string;
  exitCode: number;
  timestamp: number;
};

export type SessionState = {
  workdir: string;
  outputCache: OutputCache | null;
  lastActivity: number;
  history: HistoryEntry[];
  env: Record<string, string>;
  aliases: Record<string, string>;
};

// ============================================================================
// SessionManager
// ============================================================================

export class SessionManager {
  private readonly sessions = new Map<string, SessionState>();

  constructor(
    private readonly config: SessionConfig,
    private readonly logger: { info: (msg: string) => void; warn: (msg: string) => void },
  ) {}

  private compositeKey(channel: string, senderId: string): string {
    return `${channel}:${senderId}`;
  }

  private prune(): void {
    const now = Date.now();
    for (const [key, session] of this.sessions) {
      if (now - session.lastActivity > this.config.sessionTtlMs) {
        this.sessions.delete(key);
      } else if (
        session.outputCache &&
        now - session.outputCache.cachedAt > this.config.outputCacheTtlMs
      ) {
        session.outputCache = null;
      }
    }
  }

  private splitIntoPages(text: string): OutputPage[] {
    const lines = text.split("\n");
    const pages: OutputPage[] = [];
    let currentContent: string[] = [];
    let currentSize = 0;

    for (const line of lines) {
      // +1 accounts for the newline character when joining
      const lineSize = line.length + (currentContent.length > 0 ? 1 : 0);

      if (currentContent.length > 0 && currentSize + lineSize > this.config.outputPageSize) {
        pages.push({
          content: currentContent.join("\n"),
          lineCount: currentContent.length,
        });
        currentContent = [line];
        currentSize = line.length;
      } else {
        currentContent.push(line);
        currentSize += lineSize;
      }
    }

    if (currentContent.length > 0) {
      pages.push({
        content: currentContent.join("\n"),
        lineCount: currentContent.length,
      });
    }

    return pages;
  }

  getOrCreate(channel: string, senderId: string, defaultWorkdir: string): SessionState {
    this.prune();

    const key = this.compositeKey(channel, senderId);
    const existing = this.sessions.get(key);
    if (existing) {
      existing.lastActivity = Date.now();
      return existing;
    }

    const session: SessionState = {
      workdir: defaultWorkdir,
      outputCache: null,
      lastActivity: Date.now(),
      history: [],
      env: {},
      aliases: {},
    };
    this.sessions.set(key, session);
    return session;
  }

  setWorkdir(channel: string, senderId: string, newWorkdir: string): void {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    if (session) {
      session.workdir = newWorkdir;
      session.lastActivity = Date.now();
    } else {
      this.sessions.set(key, {
        workdir: newWorkdir,
        outputCache: null,
        lastActivity: Date.now(),
        history: [],
        env: {},
        aliases: {},
      });
    }
  }

  getWorkdir(channel: string, senderId: string): string | undefined {
    const key = this.compositeKey(channel, senderId);
    return this.sessions.get(key)?.workdir;
  }

  cacheOutput(channel: string, senderId: string, fullOutput: string, command: string): OutputCache {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    const pages = this.splitIntoPages(fullOutput);
    const totalLines = pages.reduce((sum, p) => sum + p.lineCount, 0);

    const cache: OutputCache = {
      pages,
      currentPage: 1, // page 0 is shown inline
      totalLines,
      command,
      cachedAt: Date.now(),
    };

    if (session) {
      session.outputCache = cache;
      session.lastActivity = Date.now();
    } else {
      this.sessions.set(key, {
        workdir: "",
        outputCache: cache,
        lastActivity: Date.now(),
        history: [],
        env: {},
        aliases: {},
      });
    }

    return cache;
  }

  getNextPage(
    channel: string,
    senderId: string,
  ): { page: OutputPage; pageNum: number; totalPages: number; remainingLines: number } | null {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    if (!session?.outputCache) return null;

    const cache = session.outputCache;

    // Check expiry
    if (Date.now() - cache.cachedAt > this.config.outputCacheTtlMs) {
      session.outputCache = null;
      return null;
    }

    if (cache.currentPage >= cache.pages.length) return null;

    const page = cache.pages[cache.currentPage]!;
    const pageNum = cache.currentPage + 1; // 1-based for display
    const totalPages = cache.pages.length;

    cache.currentPage++;

    // Calculate remaining lines after this page
    let remainingLines = 0;
    for (let i = cache.currentPage; i < cache.pages.length; i++) {
      remainingLines += cache.pages[i]!.lineCount;
    }

    session.lastActivity = Date.now();

    return { page, pageNum, totalPages, remainingLines };
  }

  hasMorePages(channel: string, senderId: string): boolean {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    if (!session?.outputCache) return false;

    const cache = session.outputCache;
    if (Date.now() - cache.cachedAt > this.config.outputCacheTtlMs) return false;

    return cache.currentPage < cache.pages.length;
  }

  clearOutputCache(channel: string, senderId: string): void {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    if (session) {
      session.outputCache = null;
    }
  }

  // ---------- History ----------

  addHistory(channel: string, senderId: string, entry: HistoryEntry, maxHistorySize: number): void {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    if (!session) return;

    session.history.push(entry);
    while (session.history.length > maxHistorySize) {
      session.history.shift();
    }
    session.lastActivity = Date.now();
  }

  getHistory(channel: string, senderId: string): HistoryEntry[] {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    if (!session) return [];
    return [...session.history].reverse();
  }

  getHistoryEntry(channel: string, senderId: string, index: number): HistoryEntry | null {
    if (index < 1) return null;
    const reversed = this.getHistory(channel, senderId);
    if (index > reversed.length) return null;
    return reversed[index - 1]!;
  }

  // ---------- Environment Variables ----------

  setEnv(
    channel: string,
    senderId: string,
    key: string,
    value: string,
    maxEnvVars: number,
  ): boolean {
    const compositeKey = this.compositeKey(channel, senderId);
    const session = this.sessions.get(compositeKey);
    if (!session) return false;

    // Allow updating existing keys without counting toward max
    if (!(key in session.env) && Object.keys(session.env).length >= maxEnvVars) {
      return false;
    }

    session.env[key] = value;
    session.lastActivity = Date.now();
    return true;
  }

  deleteEnv(channel: string, senderId: string, key: string): boolean {
    const compositeKey = this.compositeKey(channel, senderId);
    const session = this.sessions.get(compositeKey);
    if (!session) return false;

    if (!(key in session.env)) return false;

    delete session.env[key];
    session.lastActivity = Date.now();
    return true;
  }

  getEnv(channel: string, senderId: string): Record<string, string> {
    const compositeKey = this.compositeKey(channel, senderId);
    const session = this.sessions.get(compositeKey);
    if (!session) return {};
    return { ...session.env };
  }

  // ---------- Aliases ----------

  setAlias(
    channel: string,
    senderId: string,
    name: string,
    command: string,
    maxAliases: number,
  ): boolean {
    const compositeKey = this.compositeKey(channel, senderId);
    const session = this.sessions.get(compositeKey);
    if (!session) return false;

    if (!(name in session.aliases) && Object.keys(session.aliases).length >= maxAliases) {
      return false;
    }

    session.aliases[name] = command;
    session.lastActivity = Date.now();
    return true;
  }

  deleteAlias(channel: string, senderId: string, name: string): boolean {
    const compositeKey = this.compositeKey(channel, senderId);
    const session = this.sessions.get(compositeKey);
    if (!session) return false;

    if (!(name in session.aliases)) return false;

    delete session.aliases[name];
    session.lastActivity = Date.now();
    return true;
  }

  getAliases(channel: string, senderId: string): Record<string, string> {
    const compositeKey = this.compositeKey(channel, senderId);
    const session = this.sessions.get(compositeKey);
    if (!session) return {};
    return { ...session.aliases };
  }

  getAlias(channel: string, senderId: string, name: string): string | undefined {
    const compositeKey = this.compositeKey(channel, senderId);
    const session = this.sessions.get(compositeKey);
    if (!session) return undefined;
    return session.aliases[name];
  }

  // ---------- Session Reset ----------

  clearSession(channel: string, senderId: string, defaultWorkdir: string): void {
    const key = this.compositeKey(channel, senderId);
    const session = this.sessions.get(key);
    if (session) {
      session.workdir = defaultWorkdir;
      session.outputCache = null;
      session.history = [];
      session.env = {};
      session.aliases = {};
      session.lastActivity = Date.now();
    }
  }
}

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

export type SessionState = {
  workdir: string;
  outputCache: OutputCache | null;
  lastActivity: number;
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
}

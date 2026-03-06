/**
 * OAuth2 Token Store — File-based token persistence.
 *
 * Stores OAuth2 tokens per MCP server in ~/.mayros/oauth-tokens.json
 * with 0o600 permissions (owner read/write only).
 *
 * Features:
 * - Per-server token storage keyed by server ID
 * - Expiry tracking with buffer (refreshes 60s before expiry)
 * - Atomic write (write tmp → rename)
 * - In-memory cache for fast access
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";

// ============================================================================
// Types
// ============================================================================

export type OAuth2TokenSet = {
  accessToken: string;
  refreshToken?: string;
  tokenType: string;
  expiresAt?: number; // Unix timestamp (ms)
  scope?: string;
  idToken?: string;
};

export type StoredTokenEntry = {
  serverId: string;
  tokens: OAuth2TokenSet;
  createdAt: number;
  updatedAt: number;
  issuer?: string;
};

type TokenStoreFile = {
  version: 1;
  entries: Record<string, StoredTokenEntry>;
};

// ============================================================================
// Constants
// ============================================================================

const TOKEN_REFRESH_BUFFER_MS = 60_000; // Refresh 60s before expiry
const FILE_PERMISSIONS = 0o600;

// ============================================================================
// OAuth2TokenStore
// ============================================================================

export class OAuth2TokenStore {
  private cache: Map<string, StoredTokenEntry> = new Map();
  private loaded = false;

  constructor(private readonly filePath: string) {}

  /**
   * Get the default token store path (~/.mayros/oauth-tokens.json).
   */
  static defaultPath(): string {
    const home = process.env.HOME ?? process.env.USERPROFILE ?? "/tmp";
    return join(home, ".mayros", "oauth-tokens.json");
  }

  /**
   * Get tokens for a server. Returns null if not found or expired without refresh.
   */
  getTokens(serverId: string): OAuth2TokenSet | null {
    this.ensureLoaded();
    const entry = this.cache.get(serverId);
    if (!entry) return null;
    return { ...entry.tokens };
  }

  /**
   * Check if a server's access token is expired (or about to expire).
   */
  isExpired(serverId: string): boolean {
    this.ensureLoaded();
    const entry = this.cache.get(serverId);
    if (!entry) return true;
    if (!entry.tokens.expiresAt) return false; // No expiry = doesn't expire
    return Date.now() >= entry.tokens.expiresAt - TOKEN_REFRESH_BUFFER_MS;
  }

  /**
   * Check if a server has a refresh token available.
   */
  hasRefreshToken(serverId: string): boolean {
    this.ensureLoaded();
    const entry = this.cache.get(serverId);
    return Boolean(entry?.tokens.refreshToken);
  }

  /**
   * Store tokens for a server. Writes to disk immediately.
   */
  saveTokens(serverId: string, tokens: OAuth2TokenSet, issuer?: string): void {
    this.ensureLoaded();

    const now = Date.now();
    const existing = this.cache.get(serverId);

    const entry: StoredTokenEntry = {
      serverId,
      tokens: { ...tokens },
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      issuer,
    };

    this.cache.set(serverId, entry);
    this.writeToDisk();
  }

  /**
   * Update only the access token (after a refresh), preserving the refresh token.
   */
  updateAccessToken(
    serverId: string,
    accessToken: string,
    expiresAt?: number,
    newRefreshToken?: string,
  ): void {
    this.ensureLoaded();
    const entry = this.cache.get(serverId);
    if (!entry) return;

    entry.tokens.accessToken = accessToken;
    if (expiresAt !== undefined) entry.tokens.expiresAt = expiresAt;
    if (newRefreshToken) entry.tokens.refreshToken = newRefreshToken;
    entry.updatedAt = Date.now();

    this.writeToDisk();
  }

  /**
   * Remove tokens for a server.
   */
  removeTokens(serverId: string): boolean {
    this.ensureLoaded();
    const had = this.cache.delete(serverId);
    if (had) this.writeToDisk();
    return had;
  }

  /**
   * List all server IDs with stored tokens.
   */
  listServerIds(): string[] {
    this.ensureLoaded();
    return [...this.cache.keys()];
  }

  /**
   * Get entry metadata (for status display).
   */
  getEntry(serverId: string): StoredTokenEntry | null {
    this.ensureLoaded();
    const entry = this.cache.get(serverId);
    return entry ? { ...entry } : null;
  }

  /**
   * Clear all tokens.
   */
  clearAll(): void {
    this.cache.clear();
    this.loaded = true;
    this.writeToDisk();
  }

  // ========================================================================
  // File I/O
  // ========================================================================

  private ensureLoaded(): void {
    if (this.loaded) return;
    this.loadFromDisk();
    this.loaded = true;
  }

  private loadFromDisk(): void {
    try {
      if (!existsSync(this.filePath)) return;
      const raw = readFileSync(this.filePath, "utf-8");
      const data = JSON.parse(raw) as TokenStoreFile;
      if (data.version !== 1 || !data.entries) return;

      for (const [serverId, entry] of Object.entries(data.entries)) {
        if (entry && entry.tokens && typeof entry.tokens.accessToken === "string") {
          this.cache.set(serverId, entry);
        }
      }
    } catch {
      // Ignore read/parse errors — start fresh
    }
  }

  private writeToDisk(): void {
    const data: TokenStoreFile = {
      version: 1,
      entries: Object.fromEntries(this.cache),
    };

    const dir = dirname(this.filePath);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true, mode: 0o700 });
    }

    // Atomic write: write to temp file, then rename
    const tmpPath = `${this.filePath}.${randomBytes(4).toString("hex")}.tmp`;
    try {
      writeFileSync(tmpPath, JSON.stringify(data, null, 2), {
        encoding: "utf-8",
        mode: FILE_PERMISSIONS,
      });
      renameSync(tmpPath, this.filePath);
    } catch {
      // Clean up temp file on failure
      try {
        if (existsSync(tmpPath)) {
          const { unlinkSync } = require("node:fs") as typeof import("node:fs");
          unlinkSync(tmpPath);
        }
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

/**
 * Create an access token from a token endpoint response.
 */
export function parseTokenResponse(body: Record<string, unknown>): OAuth2TokenSet {
  const accessToken = String(body.access_token ?? "");
  if (!accessToken) {
    throw new Error("Token response missing access_token");
  }

  const tokenType = String(body.token_type ?? "Bearer");
  const refreshToken = typeof body.refresh_token === "string" ? body.refresh_token : undefined;
  const scope = typeof body.scope === "string" ? body.scope : undefined;
  const idToken = typeof body.id_token === "string" ? body.id_token : undefined;

  let expiresAt: number | undefined;
  if (typeof body.expires_in === "number" && body.expires_in > 0) {
    expiresAt = Date.now() + body.expires_in * 1000;
  }

  return {
    accessToken,
    refreshToken,
    tokenType,
    expiresAt,
    scope,
    idToken,
  };
}

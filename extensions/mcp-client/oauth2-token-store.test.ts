import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { OAuth2TokenStore, parseTokenResponse } from "./oauth2-token-store.js";

// ── Helpers ────────────────────────────────────────────────────────────

let testDir: string;
let storePath: string;

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "mayros-oauth-test-"));
  storePath = join(testDir, "oauth-tokens.json");
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================================
// OAuth2TokenStore
// ============================================================================

describe("OAuth2TokenStore", () => {
  // 1
  it("starts empty when file does not exist", () => {
    const store = new OAuth2TokenStore(storePath);
    expect(store.listServerIds()).toEqual([]);
  });

  // 2
  it("saves and retrieves tokens", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("server-1", {
      accessToken: "access-123",
      refreshToken: "refresh-456",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000,
    });

    const tokens = store.getTokens("server-1");
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBe("access-123");
    expect(tokens!.refreshToken).toBe("refresh-456");
    expect(tokens!.tokenType).toBe("Bearer");
  });

  // 3
  it("persists tokens to disk and reloads", () => {
    const store1 = new OAuth2TokenStore(storePath);
    store1.saveTokens("server-1", {
      accessToken: "persisted-token",
      tokenType: "Bearer",
    });

    // New instance reads from disk
    const store2 = new OAuth2TokenStore(storePath);
    const tokens = store2.getTokens("server-1");
    expect(tokens).not.toBeNull();
    expect(tokens!.accessToken).toBe("persisted-token");
  });

  // 4
  it("returns null for unknown server", () => {
    const store = new OAuth2TokenStore(storePath);
    expect(store.getTokens("nonexistent")).toBeNull();
  });

  // 5
  it("isExpired returns true when past expiry", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("expired", {
      accessToken: "old",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1000, // 1s ago
    });
    expect(store.isExpired("expired")).toBe(true);
  });

  // 6
  it("isExpired returns false when not expired", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("valid", {
      accessToken: "fresh",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000, // 1h from now
    });
    expect(store.isExpired("valid")).toBe(false);
  });

  // 7
  it("isExpired returns true when within refresh buffer", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("expiring-soon", {
      accessToken: "almost",
      tokenType: "Bearer",
      expiresAt: Date.now() + 30_000, // 30s from now (< 60s buffer)
    });
    expect(store.isExpired("expiring-soon")).toBe(true);
  });

  // 8
  it("isExpired returns false when no expiresAt", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("no-expiry", {
      accessToken: "eternal",
      tokenType: "Bearer",
    });
    expect(store.isExpired("no-expiry")).toBe(false);
  });

  // 9
  it("hasRefreshToken returns correct values", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("with-refresh", {
      accessToken: "a",
      refreshToken: "r",
      tokenType: "Bearer",
    });
    store.saveTokens("without-refresh", {
      accessToken: "a",
      tokenType: "Bearer",
    });

    expect(store.hasRefreshToken("with-refresh")).toBe(true);
    expect(store.hasRefreshToken("without-refresh")).toBe(false);
    expect(store.hasRefreshToken("nonexistent")).toBe(false);
  });

  // 10
  it("updateAccessToken modifies token in place", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("server-1", {
      accessToken: "old-token",
      refreshToken: "refresh-1",
      tokenType: "Bearer",
    });

    store.updateAccessToken("server-1", "new-token", Date.now() + 7200_000);

    const tokens = store.getTokens("server-1");
    expect(tokens!.accessToken).toBe("new-token");
    expect(tokens!.refreshToken).toBe("refresh-1"); // Preserved
  });

  // 11
  it("updateAccessToken with new refresh token rotates it", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("server-1", {
      accessToken: "a",
      refreshToken: "old-refresh",
      tokenType: "Bearer",
    });

    store.updateAccessToken("server-1", "new-a", undefined, "new-refresh");

    const tokens = store.getTokens("server-1");
    expect(tokens!.refreshToken).toBe("new-refresh");
  });

  // 12
  it("removeTokens deletes a server's tokens", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("server-1", {
      accessToken: "a",
      tokenType: "Bearer",
    });

    expect(store.removeTokens("server-1")).toBe(true);
    expect(store.getTokens("server-1")).toBeNull();
    expect(store.removeTokens("server-1")).toBe(false);
  });

  // 13
  it("listServerIds returns all stored servers", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("alpha", { accessToken: "a", tokenType: "Bearer" });
    store.saveTokens("beta", { accessToken: "b", tokenType: "Bearer" });

    const ids = store.listServerIds();
    expect(ids).toContain("alpha");
    expect(ids).toContain("beta");
    expect(ids).toHaveLength(2);
  });

  // 14
  it("clearAll removes all tokens", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("a", { accessToken: "1", tokenType: "Bearer" });
    store.saveTokens("b", { accessToken: "2", tokenType: "Bearer" });

    store.clearAll();
    expect(store.listServerIds()).toEqual([]);
  });

  // 15
  it("getEntry returns metadata", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("server-1", { accessToken: "a", tokenType: "Bearer" }, "https://issuer.test");

    const entry = store.getEntry("server-1");
    expect(entry).not.toBeNull();
    expect(entry!.serverId).toBe("server-1");
    expect(entry!.issuer).toBe("https://issuer.test");
    expect(entry!.createdAt).toBeGreaterThan(0);
    expect(entry!.updatedAt).toBeGreaterThan(0);
  });

  // 16
  it("saves preserves createdAt on update", () => {
    const store = new OAuth2TokenStore(storePath);
    store.saveTokens("server-1", { accessToken: "v1", tokenType: "Bearer" });
    const firstCreated = store.getEntry("server-1")!.createdAt;

    store.saveTokens("server-1", { accessToken: "v2", tokenType: "Bearer" });
    const secondCreated = store.getEntry("server-1")!.createdAt;

    expect(secondCreated).toBe(firstCreated);
  });

  // 17
  it("defaultPath returns a path under HOME", () => {
    const path = OAuth2TokenStore.defaultPath();
    expect(path).toContain("oauth-tokens.json");
    expect(path).toContain(".mayros");
  });
});

// ============================================================================
// parseTokenResponse
// ============================================================================

describe("parseTokenResponse", () => {
  // 18
  it("parses standard token response", () => {
    const tokens = parseTokenResponse({
      access_token: "access-123",
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "refresh-456",
      scope: "openid profile",
    });

    expect(tokens.accessToken).toBe("access-123");
    expect(tokens.tokenType).toBe("Bearer");
    expect(tokens.refreshToken).toBe("refresh-456");
    expect(tokens.scope).toBe("openid profile");
    expect(tokens.expiresAt).toBeGreaterThan(Date.now());
  });

  // 19
  it("throws on missing access_token", () => {
    expect(() => parseTokenResponse({ token_type: "Bearer" })).toThrow("access_token");
  });

  // 20
  it("defaults tokenType to Bearer", () => {
    const tokens = parseTokenResponse({ access_token: "test" });
    expect(tokens.tokenType).toBe("Bearer");
  });

  // 21
  it("handles response without expires_in", () => {
    const tokens = parseTokenResponse({
      access_token: "test",
      token_type: "Bearer",
    });
    expect(tokens.expiresAt).toBeUndefined();
  });

  // 22
  it("parses id_token", () => {
    const tokens = parseTokenResponse({
      access_token: "test",
      id_token: "jwt.token.here",
    });
    expect(tokens.idToken).toBe("jwt.token.here");
  });
});

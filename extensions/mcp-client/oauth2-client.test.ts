import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import {
  OAuth2Client,
  generateCodeVerifier,
  generateCodeChallenge,
  generateState,
} from "./oauth2-client.js";
import { OAuth2TokenStore } from "./oauth2-token-store.js";
import type { OAuth2ServerMetadata } from "./oauth2-discovery.js";

// ── Helpers ────────────────────────────────────────────────────────────

let testDir: string;
let storePath: string;
let tokenStore: OAuth2TokenStore;

const testMetadata: OAuth2ServerMetadata = {
  issuer: "https://auth.test",
  authorization_endpoint: "https://auth.test/authorize",
  token_endpoint: "https://auth.test/token",
  device_authorization_endpoint: "https://auth.test/device",
};

beforeEach(() => {
  testDir = mkdtempSync(join(tmpdir(), "mayros-oauth-client-test-"));
  storePath = join(testDir, "oauth-tokens.json");
  tokenStore = new OAuth2TokenStore(storePath);
});

afterEach(() => {
  rmSync(testDir, { recursive: true, force: true });
});

// ============================================================================
// PKCE Helpers
// ============================================================================

describe("PKCE helpers", () => {
  // 1
  it("generateCodeVerifier returns base64url string", () => {
    const verifier = generateCodeVerifier();
    expect(verifier.length).toBeGreaterThan(20);
    expect(/^[A-Za-z0-9_-]+$/.test(verifier)).toBe(true);
  });

  // 2
  it("generateCodeVerifier produces unique values", () => {
    const v1 = generateCodeVerifier();
    const v2 = generateCodeVerifier();
    expect(v1).not.toBe(v2);
  });

  // 3
  it("generateCodeChallenge produces S256 hash", () => {
    const verifier = "test-verifier-value";
    const challenge = generateCodeChallenge(verifier);
    expect(challenge.length).toBeGreaterThan(0);
    expect(/^[A-Za-z0-9_-]+$/.test(challenge)).toBe(true);
  });

  // 4
  it("generateCodeChallenge is deterministic", () => {
    const verifier = "same-verifier";
    const c1 = generateCodeChallenge(verifier);
    const c2 = generateCodeChallenge(verifier);
    expect(c1).toBe(c2);
  });

  // 5
  it("generateCodeChallenge differs for different verifiers", () => {
    const c1 = generateCodeChallenge("verifier-a");
    const c2 = generateCodeChallenge("verifier-b");
    expect(c1).not.toBe(c2);
  });

  // 6
  it("generateState returns hex string", () => {
    const state = generateState();
    expect(state.length).toBe(32); // 16 bytes hex
    expect(/^[a-f0-9]+$/.test(state)).toBe(true);
  });

  // 7
  it("generateState produces unique values", () => {
    const s1 = generateState();
    const s2 = generateState();
    expect(s1).not.toBe(s2);
  });
});

// ============================================================================
// OAuth2Client
// ============================================================================

describe("OAuth2Client", () => {
  // 8
  it("constructs with config", () => {
    const client = new OAuth2Client({ clientId: "test-client", scopes: ["read"] }, tokenStore);
    expect(client).toBeDefined();
  });

  // 9
  it("authorizeWithPkce returns authUrl and waitForCallback", async () => {
    const client = new OAuth2Client(
      { clientId: "test-client", scopes: ["openid"], redirectPort: 17790 },
      tokenStore,
    );

    const { authUrl, waitForCallback } = await client.authorizeWithPkce(
      "test-server",
      testMetadata,
    );

    expect(authUrl).toContain("https://auth.test/authorize");
    expect(authUrl).toContain("client_id=test-client");
    expect(authUrl).toContain("response_type=code");
    expect(authUrl).toContain("code_challenge=");
    expect(authUrl).toContain("code_challenge_method=S256");
    expect(authUrl).toContain("state=");
    expect(authUrl).toContain("scope=openid");
    expect(authUrl).toContain("redirect_uri=");
    expect(typeof waitForCallback).toBe("function");
  });

  // 10
  it("authorizeWithDeviceCode throws when not supported", async () => {
    const client = new OAuth2Client({ clientId: "test-client", scopes: [] }, tokenStore);

    const metadataNoDevice: OAuth2ServerMetadata = {
      issuer: "test",
      authorization_endpoint: "https://auth.test/authorize",
      token_endpoint: "https://auth.test/token",
    };

    await expect(client.authorizeWithDeviceCode("test-server", metadataNoDevice)).rejects.toThrow(
      "does not support device code",
    );
  });

  // 11
  it("getValidToken returns null when no tokens stored", async () => {
    const client = new OAuth2Client({ clientId: "test-client", scopes: [] }, tokenStore);

    const token = await client.getValidToken("unknown-server", "https://auth.test/token");
    expect(token).toBeNull();
  });

  // 12
  it("getValidToken returns access token when not expired", async () => {
    tokenStore.saveTokens("server-1", {
      accessToken: "valid-token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000,
    });

    const client = new OAuth2Client({ clientId: "test-client", scopes: [] }, tokenStore);

    const token = await client.getValidToken("server-1", "https://auth.test/token");
    expect(token).toBe("valid-token");
  });

  // 13
  it("getValidToken returns null when expired and no refresh token", async () => {
    tokenStore.saveTokens("server-1", {
      accessToken: "expired-token",
      tokenType: "Bearer",
      expiresAt: Date.now() - 1000,
    });

    const client = new OAuth2Client({ clientId: "test-client", scopes: [] }, tokenStore);

    const token = await client.getValidToken("server-1", "https://auth.test/token");
    expect(token).toBeNull();
  });
});

// ============================================================================
// Integration: Token Provider Pattern
// ============================================================================

describe("Token Provider Pattern", () => {
  // 14
  it("token provider function returns valid token", async () => {
    tokenStore.saveTokens("api-server", {
      accessToken: "my-oauth-token",
      tokenType: "Bearer",
      expiresAt: Date.now() + 3600_000,
    });

    const client = new OAuth2Client({ clientId: "app", scopes: [] }, tokenStore);

    // This is the pattern used by transport.ts
    const tokenProvider = () => client.getValidToken("api-server", "https://auth.test/token");

    const token = await tokenProvider();
    expect(token).toBe("my-oauth-token");
  });

  // 15
  it("token provider returns null for missing server", async () => {
    const client = new OAuth2Client({ clientId: "app", scopes: [] }, tokenStore);

    const tokenProvider = () => client.getValidToken("missing", "https://auth.test/token");

    const token = await tokenProvider();
    expect(token).toBeNull();
  });
});

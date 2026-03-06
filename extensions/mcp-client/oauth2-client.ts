/**
 * OAuth2 Client — Authorization Code + PKCE and Device Code flows.
 *
 * Implements:
 * - Authorization Code + PKCE (S256) with loopback redirect
 * - Device Code flow for headless/SSH environments
 * - Token refresh with rotation support
 * - CSRF protection via state parameter
 *
 * Integrates with:
 * - oauth2-discovery.ts for endpoint discovery
 * - oauth2-token-store.ts for credential persistence
 */

import { createHash, randomBytes } from "node:crypto";
import { createServer, type Server } from "node:http";
import type { OAuth2ServerMetadata } from "./oauth2-discovery.js";
import { OAuth2TokenStore, parseTokenResponse, type OAuth2TokenSet } from "./oauth2-token-store.js";

// ============================================================================
// Types
// ============================================================================

export type OAuth2ClientConfig = {
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  redirectPort?: number;
  authTimeoutMs?: number;
};

export type AuthorizationResult = {
  tokens: OAuth2TokenSet;
  flow: "authorization-code" | "device-code";
};

export type DeviceCodeResponse = {
  device_code: string;
  user_code: string;
  verification_uri: string;
  verification_uri_complete?: string;
  expires_in: number;
  interval: number;
};

// ============================================================================
// PKCE Helpers
// ============================================================================

/**
 * Generate a cryptographically random code verifier (43-128 chars).
 */
export function generateCodeVerifier(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Generate a S256 code challenge from a verifier.
 */
export function generateCodeChallenge(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

/**
 * Generate a random state parameter for CSRF protection.
 */
export function generateState(): string {
  return randomBytes(16).toString("hex");
}

// ============================================================================
// OAuth2Client
// ============================================================================

const DEFAULT_REDIRECT_PORT = 7779;
const DEFAULT_AUTH_TIMEOUT_MS = 300_000; // 5 minutes

export class OAuth2Client {
  private readonly config: Required<OAuth2ClientConfig>;
  private readonly tokenStore: OAuth2TokenStore;

  constructor(config: OAuth2ClientConfig, tokenStore: OAuth2TokenStore) {
    this.config = {
      ...config,
      redirectPort: config.redirectPort ?? DEFAULT_REDIRECT_PORT,
      authTimeoutMs: config.authTimeoutMs ?? DEFAULT_AUTH_TIMEOUT_MS,
      clientSecret: config.clientSecret ?? "",
    };
    this.tokenStore = tokenStore;
  }

  // ========================================================================
  // Authorization Code + PKCE
  // ========================================================================

  /**
   * Start the Authorization Code + PKCE flow.
   *
   * 1. Generates code verifier + challenge (S256)
   * 2. Starts a local HTTP server for the redirect callback
   * 3. Returns the authorization URL for the user to open
   * 4. Waits for the callback with the authorization code
   * 5. Exchanges the code for tokens
   * 6. Persists tokens to the store
   */
  async authorizeWithPkce(
    serverId: string,
    metadata: OAuth2ServerMetadata,
  ): Promise<{ authUrl: string; waitForCallback: () => Promise<AuthorizationResult> }> {
    const verifier = generateCodeVerifier();
    const challenge = generateCodeChallenge(verifier);
    const state = generateState();
    const redirectUri = `http://127.0.0.1:${this.config.redirectPort}/oauth2/callback`;

    // Build authorization URL
    const params = new URLSearchParams({
      response_type: "code",
      client_id: this.config.clientId,
      redirect_uri: redirectUri,
      scope: this.config.scopes.join(" "),
      state,
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
    const authUrl = `${metadata.authorization_endpoint}?${params.toString()}`;

    // Create callback server and wait function
    const waitForCallback = () =>
      this.startCallbackServer(serverId, metadata, verifier, state, redirectUri);

    return { authUrl, waitForCallback };
  }

  private startCallbackServer(
    serverId: string,
    metadata: OAuth2ServerMetadata,
    verifier: string,
    expectedState: string,
    redirectUri: string,
  ): Promise<AuthorizationResult> {
    return new Promise((resolve, reject) => {
      let server: Server | null = null;
      let timeoutId: ReturnType<typeof setTimeout> | null = null;

      const cleanup = () => {
        if (timeoutId) clearTimeout(timeoutId);
        if (server) {
          server.close();
          server = null;
        }
      };

      timeoutId = setTimeout(() => {
        cleanup();
        reject(new Error(`Authorization timed out after ${this.config.authTimeoutMs}ms`));
      }, this.config.authTimeoutMs);

      server = createServer(async (req, res) => {
        const url = new URL(req.url ?? "/", `http://127.0.0.1:${this.config.redirectPort}`);

        if (url.pathname !== "/oauth2/callback") {
          res.writeHead(404);
          res.end("Not found");
          return;
        }

        const code = url.searchParams.get("code");
        const state = url.searchParams.get("state");
        const error = url.searchParams.get("error");

        if (error) {
          const errorDescription = url.searchParams.get("error_description") ?? error;
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(errorPage(errorDescription));
          cleanup();
          reject(new Error(`Authorization error: ${errorDescription}`));
          return;
        }

        if (!code || state !== expectedState) {
          res.writeHead(400, { "Content-Type": "text/html" });
          res.end(errorPage("Invalid callback: missing code or state mismatch"));
          cleanup();
          reject(new Error("Invalid OAuth2 callback: missing code or state mismatch"));
          return;
        }

        // Exchange code for tokens
        try {
          const tokens = await this.exchangeCode(
            code,
            verifier,
            redirectUri,
            metadata.token_endpoint,
          );

          this.tokenStore.saveTokens(serverId, tokens, metadata.issuer);

          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(successPage());
          cleanup();
          resolve({ tokens, flow: "authorization-code" });
        } catch (err) {
          res.writeHead(200, { "Content-Type": "text/html" });
          res.end(errorPage(String(err)));
          cleanup();
          reject(err instanceof Error ? err : new Error(String(err)));
        }
      });

      server.listen(this.config.redirectPort, "127.0.0.1");
      server.on("error", (err) => {
        cleanup();
        reject(new Error(`Callback server failed: ${err.message}`));
      });
    });
  }

  /**
   * Exchange an authorization code for tokens.
   */
  private async exchangeCode(
    code: string,
    verifier: string,
    redirectUri: string,
    tokenEndpoint: string,
  ): Promise<OAuth2TokenSet> {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
      client_id: this.config.clientId,
      code_verifier: verifier,
    });

    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret);
    }

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      const errorBody = await res.text();
      throw new Error(`Token exchange failed (${res.status}): ${errorBody}`);
    }

    const responseBody = (await res.json()) as Record<string, unknown>;
    return parseTokenResponse(responseBody);
  }

  // ========================================================================
  // Device Code Flow
  // ========================================================================

  /**
   * Start the Device Code flow for headless environments.
   *
   * 1. Requests a device code from the authorization server
   * 2. Returns the user code and verification URL
   * 3. Polls the token endpoint until the user authorizes
   */
  async authorizeWithDeviceCode(
    serverId: string,
    metadata: OAuth2ServerMetadata,
  ): Promise<{
    userCode: string;
    verificationUri: string;
    verificationUriComplete?: string;
    pollForTokens: () => Promise<AuthorizationResult>;
  }> {
    const deviceEndpoint = metadata.device_authorization_endpoint;
    if (!deviceEndpoint) {
      throw new Error("Server does not support device code flow");
    }

    const body = new URLSearchParams({
      client_id: this.config.clientId,
      scope: this.config.scopes.join(" "),
    });

    const res = await fetch(deviceEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      throw new Error(`Device code request failed (${res.status})`);
    }

    const deviceResponse = (await res.json()) as DeviceCodeResponse;

    const pollForTokens = () => this.pollDeviceCode(serverId, metadata, deviceResponse);

    return {
      userCode: deviceResponse.user_code,
      verificationUri: deviceResponse.verification_uri,
      verificationUriComplete: deviceResponse.verification_uri_complete,
      pollForTokens,
    };
  }

  private async pollDeviceCode(
    serverId: string,
    metadata: OAuth2ServerMetadata,
    deviceResponse: DeviceCodeResponse,
  ): Promise<AuthorizationResult> {
    const deadline = Date.now() + deviceResponse.expires_in * 1000;
    const interval = Math.max(deviceResponse.interval, 5) * 1000; // Min 5s

    while (Date.now() < deadline) {
      await sleep(interval);

      const body = new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceResponse.device_code,
        client_id: this.config.clientId,
      });

      const res = await fetch(metadata.token_endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });

      if (res.ok) {
        const responseBody = (await res.json()) as Record<string, unknown>;
        const tokens = parseTokenResponse(responseBody);
        this.tokenStore.saveTokens(serverId, tokens, metadata.issuer);
        return { tokens, flow: "device-code" };
      }

      const errorBody = (await res.json()) as { error?: string };
      if (errorBody.error === "authorization_pending" || errorBody.error === "slow_down") {
        continue;
      }

      throw new Error(`Device code authorization failed: ${errorBody.error ?? "unknown error"}`);
    }

    throw new Error("Device code authorization timed out");
  }

  // ========================================================================
  // Token Refresh
  // ========================================================================

  /**
   * Refresh an access token using the stored refresh token.
   */
  async refreshAccessToken(
    serverId: string,
    tokenEndpoint: string,
  ): Promise<OAuth2TokenSet | null> {
    const existing = this.tokenStore.getTokens(serverId);
    if (!existing?.refreshToken) return null;

    const body = new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: existing.refreshToken,
      client_id: this.config.clientId,
    });

    if (this.config.clientSecret) {
      body.set("client_secret", this.config.clientSecret);
    }

    const res = await fetch(tokenEndpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });

    if (!res.ok) {
      // Refresh failed — token might be revoked
      return null;
    }

    const responseBody = (await res.json()) as Record<string, unknown>;
    const newTokens = parseTokenResponse(responseBody);

    // Preserve refresh token if not rotated
    this.tokenStore.updateAccessToken(
      serverId,
      newTokens.accessToken,
      newTokens.expiresAt,
      newTokens.refreshToken,
    );

    return {
      ...existing,
      accessToken: newTokens.accessToken,
      expiresAt: newTokens.expiresAt,
      refreshToken: newTokens.refreshToken ?? existing.refreshToken,
    };
  }

  // ========================================================================
  // Token Provider (for transport integration)
  // ========================================================================

  /**
   * Get a valid access token for a server, refreshing if needed.
   *
   * Returns null if no tokens stored and no refresh possible.
   */
  async getValidToken(serverId: string, tokenEndpoint: string): Promise<string | null> {
    const tokens = this.tokenStore.getTokens(serverId);
    if (!tokens) return null;

    if (!this.tokenStore.isExpired(serverId)) {
      return tokens.accessToken;
    }

    // Try refresh
    if (tokens.refreshToken) {
      const refreshed = await this.refreshAccessToken(serverId, tokenEndpoint);
      if (refreshed) return refreshed.accessToken;
    }

    // Token expired and refresh failed — return null
    return null;
  }
}

// ============================================================================
// HTML Pages for Callback
// ============================================================================

function successPage(): string {
  return `<!DOCTYPE html>
<html><head><title>Mayros - Authorization Complete</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:40px;border-radius:12px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,0.3)}
h1{color:#4ade80;margin-bottom:10px}p{color:#94a3b8}</style></head>
<body><div class="card"><h1>Authorization Successful</h1><p>You can close this window and return to Mayros.</p></div></body></html>`;
}

function errorPage(message: string): string {
  const safe = message.replace(
    /[<>&"]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c] ?? c,
  );
  return `<!DOCTYPE html>
<html><head><title>Mayros - Authorization Failed</title>
<style>body{font-family:system-ui;display:flex;justify-content:center;align-items:center;height:100vh;margin:0;background:#1a1a2e;color:#e0e0e0}
.card{text-align:center;padding:40px;border-radius:12px;background:#16213e;box-shadow:0 4px 20px rgba(0,0,0,0.3)}
h1{color:#ef4444;margin-bottom:10px}p{color:#94a3b8}</style></head>
<body><div class="card"><h1>Authorization Failed</h1><p>${safe}</p><p>Please try again from the Mayros CLI.</p></div></body></html>`;
}

// ============================================================================
// Utilities
// ============================================================================

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

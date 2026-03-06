/**
 * OAuth2 Server Metadata Discovery — RFC 8414.
 *
 * Discovers OAuth2 endpoints from MCP server responses:
 * 1. RFC 8414: GET /.well-known/oauth-authorization-server
 * 2. WWW-Authenticate header parsing (401 responses)
 * 3. Manual configuration fallback
 */

// ============================================================================
// Types
// ============================================================================

export type OAuth2ServerMetadata = {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  registration_endpoint?: string;
  revocation_endpoint?: string;
  scopes_supported?: string[];
  response_types_supported?: string[];
  grant_types_supported?: string[];
  code_challenge_methods_supported?: string[];
  device_authorization_endpoint?: string;
};

export type DiscoveryResult = {
  metadata: OAuth2ServerMetadata;
  source: "well-known" | "www-authenticate" | "manual";
};

// ============================================================================
// RFC 8414 Discovery
// ============================================================================

/**
 * Discover OAuth2 server metadata via RFC 8414 well-known endpoint.
 */
export async function discoverFromWellKnown(
  serverUrl: string,
  timeoutMs = 5000,
): Promise<DiscoveryResult | null> {
  try {
    const base = new URL(serverUrl);
    const wellKnownUrl = new URL("/.well-known/oauth-authorization-server", base.origin).toString();

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(wellKnownUrl, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });

      if (!res.ok) return null;

      const metadata = (await res.json()) as OAuth2ServerMetadata;
      if (!metadata.authorization_endpoint || !metadata.token_endpoint) {
        return null;
      }

      return { metadata, source: "well-known" };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

// ============================================================================
// WWW-Authenticate Header Parsing
// ============================================================================

/**
 * Parse OAuth2 metadata from a WWW-Authenticate header (Bearer challenge).
 *
 * Example header:
 *   Bearer realm="example", authorization_uri="https://auth.example.com/authorize",
 *   token_uri="https://auth.example.com/token"
 */
export function parseWwwAuthenticate(header: string): Partial<OAuth2ServerMetadata> {
  const result: Partial<OAuth2ServerMetadata> = {};

  // Extract key=value or key="value" pairs
  const pairRegex = /(\w+)=(?:"([^"]*)"|(\S+))/g;
  let match: RegExpExecArray | null;

  while ((match = pairRegex.exec(header)) !== null) {
    const key = match[1];
    const value = match[2] ?? match[3];

    switch (key) {
      case "realm":
        result.issuer = value;
        break;
      case "authorization_uri":
      case "authorization_endpoint":
        result.authorization_endpoint = value;
        break;
      case "token_uri":
      case "token_endpoint":
        result.token_endpoint = value;
        break;
      case "registration_uri":
      case "registration_endpoint":
        result.registration_endpoint = value;
        break;
      case "scope":
        result.scopes_supported = value.split(" ");
        break;
    }
  }

  return result;
}

/**
 * Attempt to discover OAuth2 config from a 401 response's WWW-Authenticate header.
 */
export async function discoverFromUnauthorized(
  serverUrl: string,
  timeoutMs = 5000,
): Promise<DiscoveryResult | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const res = await fetch(serverUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 0, method: "ping" }),
        signal: controller.signal,
      });

      if (res.status !== 401) return null;

      const wwwAuth = res.headers.get("www-authenticate");
      if (!wwwAuth) return null;

      const partial = parseWwwAuthenticate(wwwAuth);
      if (!partial.authorization_endpoint || !partial.token_endpoint) {
        return null;
      }

      const metadata: OAuth2ServerMetadata = {
        issuer: partial.issuer ?? new URL(serverUrl).origin,
        authorization_endpoint: partial.authorization_endpoint,
        token_endpoint: partial.token_endpoint,
        registration_endpoint: partial.registration_endpoint,
        scopes_supported: partial.scopes_supported,
      };

      return { metadata, source: "www-authenticate" };
    } finally {
      clearTimeout(timeout);
    }
  } catch {
    return null;
  }
}

// ============================================================================
// Combined Discovery
// ============================================================================

/**
 * Auto-discover OAuth2 server metadata using all available methods.
 *
 * Priority:
 * 1. RFC 8414 well-known endpoint
 * 2. WWW-Authenticate header from 401 response
 * 3. null (requires manual config)
 */
export async function discoverOAuth2Metadata(
  serverUrl: string,
  timeoutMs = 5000,
): Promise<DiscoveryResult | null> {
  // Try RFC 8414 first
  const wellKnown = await discoverFromWellKnown(serverUrl, timeoutMs);
  if (wellKnown) return wellKnown;

  // Try WWW-Authenticate header
  const unauthorized = await discoverFromUnauthorized(serverUrl, timeoutMs);
  if (unauthorized) return unauthorized;

  return null;
}

/**
 * Build a DiscoveryResult from manual configuration.
 */
export function buildManualMetadata(config: {
  authorizationEndpoint: string;
  tokenEndpoint: string;
  clientId: string;
  scopes?: string[];
  deviceAuthorizationEndpoint?: string;
}): DiscoveryResult {
  return {
    metadata: {
      issuer: new URL(config.authorizationEndpoint).origin,
      authorization_endpoint: config.authorizationEndpoint,
      token_endpoint: config.tokenEndpoint,
      device_authorization_endpoint: config.deviceAuthorizationEndpoint,
      scopes_supported: config.scopes,
    },
    source: "manual",
  };
}

/**
 * Check if metadata supports PKCE with S256.
 */
export function supportsPkceS256(metadata: OAuth2ServerMetadata): boolean {
  if (!metadata.code_challenge_methods_supported) {
    // If not specified, assume S256 is supported (common default)
    return true;
  }
  return metadata.code_challenge_methods_supported.includes("S256");
}

/**
 * Check if metadata supports device code flow.
 */
export function supportsDeviceCode(metadata: OAuth2ServerMetadata): boolean {
  if (metadata.device_authorization_endpoint) return true;
  if (metadata.grant_types_supported?.includes("urn:ietf:params:oauth:grant-type:device_code")) {
    return true;
  }
  return false;
}

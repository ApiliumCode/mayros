import { describe, it, expect } from "vitest";
import {
  parseWwwAuthenticate,
  buildManualMetadata,
  supportsPkceS256,
  supportsDeviceCode,
  type OAuth2ServerMetadata,
} from "./oauth2-discovery.js";

// ============================================================================
// parseWwwAuthenticate
// ============================================================================

describe("parseWwwAuthenticate", () => {
  // 1
  it("parses Bearer challenge with standard fields", () => {
    const header =
      'Bearer realm="example.com", authorization_uri="https://auth.example.com/authorize", token_uri="https://auth.example.com/token"';
    const result = parseWwwAuthenticate(header);
    expect(result.issuer).toBe("example.com");
    expect(result.authorization_endpoint).toBe("https://auth.example.com/authorize");
    expect(result.token_endpoint).toBe("https://auth.example.com/token");
  });

  // 2
  it("parses _endpoint suffixed keys", () => {
    const header =
      'Bearer authorization_endpoint="https://auth.test/auth", token_endpoint="https://auth.test/token"';
    const result = parseWwwAuthenticate(header);
    expect(result.authorization_endpoint).toBe("https://auth.test/auth");
    expect(result.token_endpoint).toBe("https://auth.test/token");
  });

  // 3
  it("parses scope field", () => {
    const header = 'Bearer scope="openid profile email"';
    const result = parseWwwAuthenticate(header);
    expect(result.scopes_supported).toEqual(["openid", "profile", "email"]);
  });

  // 4
  it("parses registration endpoint", () => {
    const header = 'Bearer registration_uri="https://auth.test/register"';
    const result = parseWwwAuthenticate(header);
    expect(result.registration_endpoint).toBe("https://auth.test/register");
  });

  // 5
  it("returns empty object for non-Bearer header", () => {
    const result = parseWwwAuthenticate("Basic realm=test");
    expect(result.authorization_endpoint).toBeUndefined();
    expect(result.token_endpoint).toBeUndefined();
  });

  // 6
  it("handles unquoted values", () => {
    const header = "Bearer realm=example.com";
    const result = parseWwwAuthenticate(header);
    expect(result.issuer).toBe("example.com");
  });
});

// ============================================================================
// buildManualMetadata
// ============================================================================

describe("buildManualMetadata", () => {
  // 7
  it("creates DiscoveryResult from manual config", () => {
    const result = buildManualMetadata({
      authorizationEndpoint: "https://auth.example.com/authorize",
      tokenEndpoint: "https://auth.example.com/token",
      clientId: "my-client",
    });
    expect(result.source).toBe("manual");
    expect(result.metadata.authorization_endpoint).toBe("https://auth.example.com/authorize");
    expect(result.metadata.token_endpoint).toBe("https://auth.example.com/token");
    expect(result.metadata.issuer).toBe("https://auth.example.com");
  });

  // 8
  it("includes scopes when provided", () => {
    const result = buildManualMetadata({
      authorizationEndpoint: "https://auth.test/auth",
      tokenEndpoint: "https://auth.test/token",
      clientId: "c",
      scopes: ["read", "write"],
    });
    expect(result.metadata.scopes_supported).toEqual(["read", "write"]);
  });

  // 9
  it("includes device authorization endpoint", () => {
    const result = buildManualMetadata({
      authorizationEndpoint: "https://auth.test/auth",
      tokenEndpoint: "https://auth.test/token",
      clientId: "c",
      deviceAuthorizationEndpoint: "https://auth.test/device",
    });
    expect(result.metadata.device_authorization_endpoint).toBe("https://auth.test/device");
  });
});

// ============================================================================
// supportsPkceS256
// ============================================================================

describe("supportsPkceS256", () => {
  // 10
  it("returns true when S256 is in supported methods", () => {
    const metadata: OAuth2ServerMetadata = {
      issuer: "test",
      authorization_endpoint: "http://test/auth",
      token_endpoint: "http://test/token",
      code_challenge_methods_supported: ["plain", "S256"],
    };
    expect(supportsPkceS256(metadata)).toBe(true);
  });

  // 11
  it("returns false when only plain is supported", () => {
    const metadata: OAuth2ServerMetadata = {
      issuer: "test",
      authorization_endpoint: "http://test/auth",
      token_endpoint: "http://test/token",
      code_challenge_methods_supported: ["plain"],
    };
    expect(supportsPkceS256(metadata)).toBe(false);
  });

  // 12
  it("returns true when field is not specified (default)", () => {
    const metadata: OAuth2ServerMetadata = {
      issuer: "test",
      authorization_endpoint: "http://test/auth",
      token_endpoint: "http://test/token",
    };
    expect(supportsPkceS256(metadata)).toBe(true);
  });
});

// ============================================================================
// supportsDeviceCode
// ============================================================================

describe("supportsDeviceCode", () => {
  // 13
  it("returns true when device_authorization_endpoint exists", () => {
    const metadata: OAuth2ServerMetadata = {
      issuer: "test",
      authorization_endpoint: "http://test/auth",
      token_endpoint: "http://test/token",
      device_authorization_endpoint: "http://test/device",
    };
    expect(supportsDeviceCode(metadata)).toBe(true);
  });

  // 14
  it("returns true when device code grant type is supported", () => {
    const metadata: OAuth2ServerMetadata = {
      issuer: "test",
      authorization_endpoint: "http://test/auth",
      token_endpoint: "http://test/token",
      grant_types_supported: ["authorization_code", "urn:ietf:params:oauth:grant-type:device_code"],
    };
    expect(supportsDeviceCode(metadata)).toBe(true);
  });

  // 15
  it("returns false when neither endpoint nor grant type present", () => {
    const metadata: OAuth2ServerMetadata = {
      issuer: "test",
      authorization_endpoint: "http://test/auth",
      token_endpoint: "http://test/token",
    };
    expect(supportsDeviceCode(metadata)).toBe(false);
  });
});

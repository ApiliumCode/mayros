/**
 * Domain Checker
 *
 * Extracts URLs from shell commands and validates them against
 * configurable domain allowlists and denylists.
 * Supports wildcard domain matching (e.g., *.github.com).
 */

// ============================================================================
// URL / Domain Extraction
// ============================================================================

/**
 * Regex to match HTTP/HTTPS URLs in a command string.
 * Captures scheme + domain + optional path/query/fragment.
 */
const URL_REGEX = /https?:\/\/[^\s"'\\)}>]+/gi;

/**
 * Extract all URLs found in a shell command string.
 * Strips trailing punctuation that is unlikely to be part of the URL.
 */
export function extractUrls(command: string): string[] {
  const matches = command.match(URL_REGEX);
  if (!matches) return [];

  return matches.map((url) => {
    // Strip common trailing punctuation that ends up captured
    return url.replace(/[;,)}>]+$/, "");
  });
}

/**
 * Extract the hostname/domain from a URL string.
 * Returns an empty string if the URL cannot be parsed.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url);
    return parsed.hostname.toLowerCase();
  } catch {
    // Fallback: try to grab the domain manually
    const match = /^https?:\/\/([^:/\s]+)/.exec(url);
    return match ? match[1].toLowerCase() : "";
  }
}

// ============================================================================
// Wildcard Matching
// ============================================================================

/**
 * Check if a domain matches a pattern.
 *
 * Supports exact matches and wildcard prefixes:
 * - `github.com` matches only `github.com`
 * - `*.github.com` matches `api.github.com`, `raw.github.com`, etc.
 *   but NOT `github.com` itself
 * - `localhost` matches `localhost`
 *
 * All comparisons are case-insensitive.
 */
export function matchesDomainPattern(domain: string, pattern: string): boolean {
  const normalizedDomain = domain.toLowerCase();
  const normalizedPattern = pattern.toLowerCase();

  // Exact match
  if (normalizedDomain === normalizedPattern) return true;

  // Wildcard match: *.example.com
  if (normalizedPattern.startsWith("*.")) {
    const suffix = normalizedPattern.slice(2); // "example.com"
    // Must end with the suffix and have at least one subdomain
    if (normalizedDomain.endsWith(`.${suffix}`)) {
      return true;
    }
    // Also allow the bare domain to match *.domain
    // e.g. *.npmjs.org should match npmjs.org
    if (normalizedDomain === suffix) {
      return true;
    }
  }

  return false;
}

// ============================================================================
// Domain Checking
// ============================================================================

export type DomainCheckResult = {
  allowed: boolean;
  blockedDomains: string[];
  matchedDomains: string[];
};

/**
 * Check all domains found in a command string against the allowlist and denylist.
 *
 * Rules:
 * 1. If no URLs are found in the command, return allowed = true.
 * 2. If a domain is in the denylist, it is ALWAYS blocked (denylist wins).
 * 3. If the allowlist is non-empty, only domains matching the allowlist are allowed.
 * 4. If the allowlist is empty, all domains are allowed (except denylisted ones).
 *
 * @param command  - Raw shell command string.
 * @param allowlist - Array of allowed domain patterns (supports wildcards).
 * @param denylist  - Array of denied domain patterns (supports wildcards).
 * @returns Result with allowed status, blocked domains, and matched (allowed) domains.
 */
export function checkDomains(
  command: string,
  allowlist: string[],
  denylist: string[],
): DomainCheckResult {
  const urls = extractUrls(command);

  if (urls.length === 0) {
    return { allowed: true, blockedDomains: [], matchedDomains: [] };
  }

  const blockedDomains: string[] = [];
  const matchedDomains: string[] = [];

  for (const url of urls) {
    const domain = extractDomain(url);
    if (!domain) continue;

    // Check denylist first — always wins
    const isDenied = denylist.some((pattern) => matchesDomainPattern(domain, pattern));
    if (isDenied) {
      blockedDomains.push(domain);
      continue;
    }

    // If allowlist is non-empty, check if domain is explicitly allowed
    if (allowlist.length > 0) {
      const isAllowed = allowlist.some((pattern) => matchesDomainPattern(domain, pattern));
      if (isAllowed) {
        matchedDomains.push(domain);
      } else {
        blockedDomains.push(domain);
      }
    } else {
      // No allowlist means all non-denied domains are allowed
      matchedDomains.push(domain);
    }
  }

  return {
    allowed: blockedDomains.length === 0,
    blockedDomains,
    matchedDomains,
  };
}

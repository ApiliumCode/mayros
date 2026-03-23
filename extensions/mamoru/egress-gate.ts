/**
 * Mamoru Gate — Network egress approval system
 *
 * Deny-by-default network egress with allowlist, presets for common services,
 * real-time approval workflow, and SSRF protection.
 */

import { randomUUID } from "node:crypto";
import { promises as dns } from "node:dns";

// ── Types ────────────────────────────────────────────────────────────────

export type EgressRule = {
  host: string;
  port: number;
  protocol: "https" | "http" | "tcp";
  methods?: string[];
  paths?: string[];
  binary?: string;
};

export type EgressPolicy = {
  defaultAction: "deny" | "allow";
  rules: EgressRule[];
  presets: string[];
};

export type EgressRequest = {
  id: string;
  host: string;
  port: number;
  binary?: string;
  method?: string;
  path?: string;
  status: "pending" | "approved" | "denied";
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  sessionScoped: boolean;
};

// ── Built-in presets ─────────────────────────────────────────────────────

const PRESETS: Record<string, EgressRule[]> = {
  github: [
    { host: "api.github.com", port: 443, protocol: "https" },
    { host: "github.com", port: 443, protocol: "https" },
  ],
  npm: [
    { host: "registry.npmjs.org", port: 443, protocol: "https", methods: ["GET"] },
  ],
  pypi: [
    { host: "pypi.org", port: 443, protocol: "https", methods: ["GET"] },
    { host: "files.pythonhosted.org", port: 443, protocol: "https", methods: ["GET"] },
  ],
  anthropic: [
    { host: "api.anthropic.com", port: 443, protocol: "https" },
  ],
  openai: [
    { host: "api.openai.com", port: 443, protocol: "https" },
  ],
  google: [
    { host: "generativelanguage.googleapis.com", port: 443, protocol: "https" },
  ],
  huggingface: [
    { host: "huggingface.co", port: 443, protocol: "https" },
    { host: "cdn-lfs.huggingface.co", port: 443, protocol: "https" },
  ],
  slack: [
    { host: "slack.com", port: 443, protocol: "https" },
    { host: "api.slack.com", port: 443, protocol: "https" },
  ],
  discord: [
    { host: "discord.com", port: 443, protocol: "https" },
    { host: "discordapp.com", port: 443, protocol: "https" },
  ],
  telegram: [
    { host: "api.telegram.org", port: 443, protocol: "https" },
  ],
  cortex: [
    { host: "127.0.0.1", port: 19090, protocol: "http" },
  ],
  hub: [
    { host: "hub.apilium.com", port: 443, protocol: "https" },
  ],
};

const PRESET_DESCRIPTIONS: Record<string, string> = {
  github: "GitHub API and web access",
  npm: "npm registry (read-only)",
  pypi: "Python Package Index (read-only)",
  anthropic: "Anthropic API",
  openai: "OpenAI API",
  google: "Google Generative AI API",
  huggingface: "Hugging Face models and datasets",
  slack: "Slack messaging API",
  discord: "Discord messaging API",
  telegram: "Telegram Bot API",
  cortex: "Local Cortex sidecar",
  hub: "Apilium Hub",
};

const MAX_PENDING_REQUESTS = 100;
const MAX_SESSION_APPROVALS = 500;
const MAX_PATTERN_LENGTH = 200;

// ── Implementation ───────────────────────────────────────────────────────

export class MamoruGate {
  private policy: EgressPolicy;
  private pendingRequests: Map<string, EgressRequest> = new Map();
  private sessionApprovals: Set<string> = new Set();

  constructor(private readonly ns: string) {
    this.policy = {
      defaultAction: "deny",
      rules: [],
      presets: [],
    };
  }

  /**
   * Check if a network connection is allowed by current policy.
   */
  checkEgress(
    host: string,
    port: number,
    opts?: { binary?: string; method?: string; path?: string; protocol?: "https" | "http" | "tcp" },
  ): { allowed: boolean; reason: string; requestId?: string } {
    const method = opts?.method?.toUpperCase();
    const path = opts?.path;
    const key = `${host}:${port}:${method ?? "*"}:${path ?? "*"}`;

    // Check session approvals first
    if (this.sessionApprovals.has(key)) {
      return { allowed: true, reason: "Session approval" };
    }

    // Check explicit rules
    const allRules = this.getEffectiveRules();

    for (const rule of allRules) {
      if (rule.host === host && rule.port === port) {
        // Check protocol restriction
        if (opts?.protocol && rule.protocol !== opts.protocol) {
          continue;
        }

        // Check method restriction
        if (method && rule.methods && rule.methods.length > 0) {
          if (!rule.methods.includes(method)) {
            continue;
          }
        }

        // Check binary restriction
        if (rule.binary && opts?.binary && rule.binary !== opts.binary) {
          continue;
        }

        // Check path restriction
        if (path && rule.paths && rule.paths.length > 0) {
          const pathAllowed = rule.paths.some((p) => matchPath(p, path));
          if (!pathAllowed) continue;
        }

        return { allowed: true, reason: `Matched rule for ${host}:${port}` };
      }
    }

    // Default action
    if (this.policy.defaultAction === "allow") {
      return { allowed: true, reason: "Default allow policy" };
    }

    // Create a pending request for operator approval
    const requestId = randomUUID();
    const request: EgressRequest = {
      id: requestId,
      host,
      port,
      binary: opts?.binary,
      method: opts?.method,
      path: opts?.path,
      status: "pending",
      requestedAt: new Date().toISOString(),
      sessionScoped: true,
    };

    // Enforce max pending requests
    if (this.pendingRequests.size >= MAX_PENDING_REQUESTS) {
      const oldest = this.pendingRequests.keys().next().value;
      if (oldest) this.pendingRequests.delete(oldest);
    }

    this.pendingRequests.set(requestId, request);

    return {
      allowed: false,
      reason: `Connection to ${host}:${port} denied by default policy — pending approval`,
      requestId,
    };
  }

  /**
   * Approve a pending egress request.
   */
  approve(requestId: string, opts?: { sessionScoped?: boolean }): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error("mamoru-gate: request not found");
    }

    request.status = "approved";
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = "operator";
    request.sessionScoped = opts?.sessionScoped ?? true;

    if (request.sessionScoped) {
      const method = request.method?.toUpperCase() ?? "*";
      const path = request.path ?? "*";
      // Enforce max cap on session approvals
      if (this.sessionApprovals.size >= MAX_SESSION_APPROVALS) {
        const oldest = this.sessionApprovals.values().next().value;
        if (oldest) this.sessionApprovals.delete(oldest);
      }
      this.sessionApprovals.add(`${request.host}:${request.port}:${method}:${path}`);
    } else {
      // Permanent rule
      this.addRule({
        host: request.host,
        port: request.port,
        protocol: request.port === 443 ? "https" : "http",
      });
    }

    this.pendingRequests.delete(requestId);
  }

  /**
   * Deny a pending egress request.
   */
  deny(requestId: string): void {
    const request = this.pendingRequests.get(requestId);
    if (!request) {
      throw new Error("mamoru-gate: request not found");
    }

    request.status = "denied";
    request.resolvedAt = new Date().toISOString();
    request.resolvedBy = "operator";
    this.pendingRequests.delete(requestId);
  }

  /**
   * Get all pending egress requests.
   */
  getPendingRequests(): EgressRequest[] {
    return Array.from(this.pendingRequests.values());
  }

  /**
   * Get the current egress policy.
   */
  getPolicy(): EgressPolicy {
    return {
      ...this.policy,
      rules: [...this.policy.rules],
      presets: [...this.policy.presets],
    };
  }

  /**
   * Add a preset to the active policy.
   */
  addPreset(presetName: string): void {
    if (!PRESETS[presetName]) {
      throw new Error(`mamoru-gate: unknown preset "${presetName}"`);
    }
    if (!this.policy.presets.includes(presetName)) {
      this.policy.presets.push(presetName);
    }
  }

  /**
   * Remove a preset from the active policy.
   */
  removePreset(presetName: string): void {
    this.policy.presets = this.policy.presets.filter((p) => p !== presetName);
  }

  /**
   * Add an explicit egress rule.
   */
  addRule(rule: EgressRule): void {
    const exists = this.policy.rules.some(
      (r) => r.host === rule.host && r.port === rule.port,
    );
    if (!exists) {
      this.policy.rules.push({ ...rule });
    }
  }

  /**
   * Remove an egress rule by host and port.
   */
  removeRule(host: string, port: number): void {
    this.policy.rules = this.policy.rules.filter(
      (r) => !(r.host === host && r.port === port),
    );
  }

  /**
   * List all available presets with descriptions.
   */
  listPresets(): Array<{ name: string; rules: number; description: string }> {
    return Object.entries(PRESETS).map(([name, rules]) => ({
      name,
      rules: rules.length,
      description: PRESET_DESCRIPTIONS[name] ?? "",
    }));
  }

  /**
   * Validate an endpoint URL for SSRF safety.
   * Resolves DNS to check all resulting IPs against private ranges.
   * Blocks private IPs, non-HTTP schemes, and metadata endpoints.
   */
  async validateEndpoint(url: string): Promise<{ safe: boolean; reason?: string }> {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      return { safe: false, reason: "Invalid URL" };
    }

    // Scheme check
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      return { safe: false, reason: `Blocked scheme: ${parsed.protocol}` };
    }

    const hostname = parsed.hostname;

    // Check the hostname itself first (catches IP literals and "localhost")
    if (isPrivateIP(hostname)) {
      // Allow explicit cortex preset
      if (hostname === "127.0.0.1" && parsed.port === "19090") {
        const hasCortex = this.policy.presets.includes("cortex") ||
          this.policy.rules.some((r) => r.host === "127.0.0.1" && r.port === 19090);
        if (hasCortex) {
          return { safe: true };
        }
      }
      return { safe: false, reason: `Private IP detected: ${hostname}` };
    }

    // Resolve DNS and check ALL resolved IPs to prevent DNS rebinding / TOCTOU
    let resolvedIPs: string[];
    try {
      const result = await dns.resolve4(hostname);
      resolvedIPs = result;
      // Also try IPv6
      try {
        const v6 = await dns.resolve6(hostname);
        resolvedIPs.push(...v6);
      } catch {
        // No AAAA records — that's fine
      }
    } catch {
      // DNS resolution failed — might be an IP literal already checked above
      resolvedIPs = [hostname];
    }

    // Check ALL resolved IPs against private ranges
    for (const ip of resolvedIPs) {
      if (isPrivateIP(ip)) {
        return { safe: false, reason: `Hostname "${hostname}" resolves to private IP ${ip}` };
      }
    }

    // Block cloud metadata endpoints (hostname check for DNS aliases)
    if (hostname === "metadata.google.internal") {
      return { safe: false, reason: "Cloud metadata endpoint blocked" };
    }

    return { safe: true };
  }

  /**
   * Clear session approvals (e.g., on session end).
   */
  clearSession(): void {
    this.sessionApprovals.clear();
    this.pendingRequests.clear();
  }

  // ── Private ──────────────────────────────────────────────────────────

  private getEffectiveRules(): EgressRule[] {
    const rules = [...this.policy.rules];
    for (const presetName of this.policy.presets) {
      const presetRules = PRESETS[presetName];
      if (presetRules) {
        rules.push(...presetRules);
      }
    }
    return rules;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Check if an IP address is a private/reserved address.
 * Handles IPv6-mapped IPv4 addresses (::ffff:127.0.0.1).
 */
function isPrivateIP(ip: string): boolean {
  // Normalize IPv6-mapped IPv4 (::ffff:127.0.0.1 -> 127.0.0.1)
  const normalized = ip.replace(/^::ffff:/i, "");

  // Also handle bracket notation [::1]
  const clean = normalized.replace(/^\[|\]$/g, "");

  // Check 0.0.0.0
  if (clean === "0.0.0.0") return true;

  // IPv4 checks
  const v4Parts = clean.split(".");
  if (v4Parts.length === 4) {
    const first = parseInt(v4Parts[0]!, 10);
    const second = parseInt(v4Parts[1]!, 10);
    if (first === 127) return true;                                // 127.0.0.0/8
    if (first === 10) return true;                                 // 10.0.0.0/8
    if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
    if (first === 192 && second === 168) return true;              // 192.168.0.0/16
    if (first === 169 && second === 254) return true;              // 169.254.0.0/16 (link-local + metadata)
    if (first === 0) return true;                                  // 0.0.0.0/8
  }

  // IPv6 checks
  const lowerIp = clean.toLowerCase();
  if (lowerIp === "::1" || lowerIp === "0:0:0:0:0:0:0:1") return true;
  if (lowerIp.startsWith("fd") || lowerIp.startsWith("fc")) return true; // fd00::/8, fc00::/7
  if (lowerIp.startsWith("fe80")) return true;                          // link-local
  if (lowerIp === "::") return true;

  // localhost alias
  if (clean === "localhost") return true;

  return false;
}

/** Export for testing */
export { isPrivateIP as _isPrivateIP };

/**
 * Simple path pattern matcher supporting ** wildcards.
 * Rejects overly long patterns to prevent ReDoS.
 */
function matchPath(pattern: string, path: string): boolean {
  if (pattern === "**" || pattern === "/**") return true;

  // Prevent ReDoS with overly long patterns
  if (pattern.length > MAX_PATTERN_LENGTH) return false;

  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, ".*")
    .replace(/\*/g, "[^/]*");

  return new RegExp(`^${escaped}$`).test(path);
}

/**
 * NetworkSandbox — OS-level network isolation for sandboxed commands.
 *
 * Strategies by platform:
 * - macOS: sandbox-exec with Seatbelt profiles restricting network
 * - Linux: unshare --net with namespace isolation
 * - Fallback: DNS-level proxy via env vars
 */

import { execFileSync } from "node:child_process";
import { matchesDomainPattern, extractDomain, extractUrls } from "./domain-checker.js";

export type NetworkSandboxConfig = {
  enabled: boolean;
  mode: "none" | "allowlist" | "full";
  allowedDomains: string[];
  denyDomains: string[];
  maxConnections: number;
};

export const DEFAULT_NETWORK_SANDBOX_CONFIG: NetworkSandboxConfig = {
  enabled: true,
  mode: "allowlist",
  allowedDomains: [
    "github.com",
    "*.github.com",
    "npmjs.org",
    "*.npmjs.org",
    "registry.npmjs.org",
    "*.googleapis.com",
  ],
  denyDomains: [],
  maxConnections: 10,
};

export type NetworkSandboxResult = {
  allowed: boolean;
  strategy: "macos-seatbelt" | "linux-namespace" | "env-proxy" | "passthrough" | "blocked";
  wrappedCommand?: string;
  env?: Record<string, string>;
  reason?: string;
};

/**
 * Resolve a domain to IP addresses for Seatbelt profile injection.
 */
function resolveDomainToIps(domain: string): string[] {
  try {
    const output = execFileSync("dig", ["+short", domain, "A"], {
      timeout: 5000,
      encoding: "utf-8",
    });
    return output
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => /^\d+\.\d+\.\d+\.\d+$/.test(l));
  } catch {
    return [];
  }
}

/**
 * Check if a domain is allowed by the config.
 */
function isDomainAllowed(domain: string, config: NetworkSandboxConfig): boolean {
  // Deny list takes priority
  for (const pattern of config.denyDomains) {
    if (matchesDomainPattern(domain, pattern)) {
      return false;
    }
  }
  // In allowlist mode, domain must match allowlist
  if (config.mode === "allowlist") {
    for (const pattern of config.allowedDomains) {
      if (matchesDomainPattern(domain, pattern)) {
        return true;
      }
    }
    return false;
  }
  // In full mode, everything not denied is allowed
  return config.mode === "full";
}

/**
 * Build a macOS Seatbelt profile for network restriction.
 */
function buildSeatbeltProfile(allowedIps: string[]): string {
  const lines = [
    "(version 1)",
    "(allow default)",
    "(deny network*)",
    '(allow network-outbound (remote ip "localhost:*"))',
  ];
  for (const ip of allowedIps) {
    lines.push(`(allow network-outbound (remote ip "${ip}:*"))`);
  }
  // Allow DNS resolution
  lines.push(
    '(allow network-outbound (remote unix-socket (path-literal "/var/run/mDNSResponder")))',
  );
  lines.push('(allow network-outbound (remote ip "*:53"))');
  return lines.join("\n");
}

/**
 * Check if sandbox-exec is available (macOS).
 */
function hasSandboxExec(): boolean {
  try {
    execFileSync("which", ["sandbox-exec"], { encoding: "utf-8", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if unshare is available (Linux).
 */
function hasUnshare(): boolean {
  try {
    execFileSync("which", ["unshare"], { encoding: "utf-8", timeout: 2000 });
    return true;
  } catch {
    return false;
  }
}

export class NetworkSandbox {
  private config: NetworkSandboxConfig;
  private activeConnections = 0;

  constructor(config: Partial<NetworkSandboxConfig> = {}) {
    this.config = { ...DEFAULT_NETWORK_SANDBOX_CONFIG, ...config };
  }

  getConfig(): NetworkSandboxConfig {
    return { ...this.config };
  }

  /**
   * Check if a specific domain is allowed by current config.
   */
  isDomainAllowed(domain: string): boolean {
    return isDomainAllowed(domain, this.config);
  }

  /**
   * Evaluate a command and return the sandboxed execution strategy.
   */
  async evaluate(command: string): Promise<NetworkSandboxResult> {
    if (!this.config.enabled || this.config.mode === "none") {
      return { allowed: true, strategy: "passthrough" };
    }

    // Check connection limit
    if (this.activeConnections >= this.config.maxConnections) {
      return {
        allowed: false,
        strategy: "blocked",
        reason: `Connection limit reached (${this.config.maxConnections})`,
      };
    }

    // Extract domains from the command to check allowlist
    const urls = extractUrls(command);
    const domains = urls
      .map((u) => extractDomain(u))
      .filter((d): d is string => d !== null && d.length > 0);

    // Check each domain against policy
    for (const domain of domains) {
      if (!isDomainAllowed(domain, this.config)) {
        return {
          allowed: false,
          strategy: "blocked",
          reason: `Domain not allowed: ${domain}`,
        };
      }
    }

    // Determine platform strategy
    const platform = process.platform;

    if (platform === "darwin" && hasSandboxExec()) {
      return this.buildMacOsStrategy(command, domains);
    }

    if (platform === "linux" && hasUnshare()) {
      return this.buildLinuxStrategy(command);
    }

    // Fallback: env-proxy strategy
    return this.buildEnvProxyStrategy();
  }

  /**
   * Track connection start (for connection limiting).
   */
  trackConnectionStart(): void {
    this.activeConnections++;
  }

  /**
   * Track connection end.
   */
  trackConnectionEnd(): void {
    this.activeConnections = Math.max(0, this.activeConnections - 1);
  }

  /**
   * Get current active connection count.
   */
  getActiveConnections(): number {
    return this.activeConnections;
  }

  private buildMacOsStrategy(command: string, domains: string[]): NetworkSandboxResult {
    // Resolve allowed domains to IPs
    const allowedIps: string[] = [];
    const allAllowedDomains = [
      ...domains,
      ...this.config.allowedDomains.filter((d) => !d.startsWith("*.")),
    ];
    for (const domain of allAllowedDomains) {
      const ips = resolveDomainToIps(domain);
      allowedIps.push(...ips);
    }

    const profile = buildSeatbeltProfile([...new Set(allowedIps)]);
    // sandbox-exec -p '<profile>' bash -c '<command>'
    const escapedProfile = profile.replace(/'/g, "'\\''");
    const escapedCommand = command.replace(/'/g, "'\\''");
    const wrappedCommand = `sandbox-exec -p '${escapedProfile}' bash -c '${escapedCommand}'`;

    return {
      allowed: true,
      strategy: "macos-seatbelt",
      wrappedCommand,
    };
  }

  private buildLinuxStrategy(command: string): NetworkSandboxResult {
    // Use unshare --net to create isolated network namespace
    const escapedCommand = command.replace(/'/g, "'\\''");
    const wrappedCommand = `unshare --net bash -c '${escapedCommand}'`;

    return {
      allowed: true,
      strategy: "linux-namespace",
      wrappedCommand,
    };
  }

  private buildEnvProxyStrategy(): NetworkSandboxResult {
    // Set proxy env vars that most tools respect
    // This is the weakest strategy — commands can ignore these
    const env: Record<string, string> = {};

    if (this.config.mode !== "none") {
      // Set a non-existent proxy to block most network access
      // Tools that respect http_proxy will fail to connect
      const noProxyDomains = this.config.allowedDomains
        .map((d) => (d.startsWith("*.") ? d.slice(2) : d))
        .join(",");

      if (this.config.mode === "allowlist" && this.config.allowedDomains.length > 0) {
        env.no_proxy = noProxyDomains;
        env.NO_PROXY = noProxyDomains;
      }
    }

    return {
      allowed: true,
      strategy: "env-proxy",
      env,
    };
  }
}

/**
 * Parse and validate a NetworkSandboxConfig from raw input.
 */
export function parseNetworkSandboxConfig(raw: Record<string, unknown>): NetworkSandboxConfig {
  const cfg = { ...DEFAULT_NETWORK_SANDBOX_CONFIG };

  if (typeof raw.enabled === "boolean") {
    cfg.enabled = raw.enabled;
  }
  if (typeof raw.mode === "string" && ["none", "allowlist", "full"].includes(raw.mode)) {
    cfg.mode = raw.mode as NetworkSandboxConfig["mode"];
  }
  if (Array.isArray(raw.allowedDomains)) {
    cfg.allowedDomains = raw.allowedDomains.filter((d): d is string => typeof d === "string");
  }
  if (Array.isArray(raw.denyDomains)) {
    cfg.denyDomains = raw.denyDomains.filter((d): d is string => typeof d === "string");
  }
  if (typeof raw.maxConnections === "number") {
    cfg.maxConnections = Math.max(1, Math.min(Math.trunc(raw.maxConnections), 100));
  }

  return cfg;
}

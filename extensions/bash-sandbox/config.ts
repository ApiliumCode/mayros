/**
 * Bash Sandbox Configuration
 *
 * Manual validation following the project's cortex-config pattern.
 * Uses assertAllowedKeys for unknown key rejection, no Zod.
 */

import { assertAllowedKeys } from "../shared/cortex-config.js";

// ============================================================================
// Types
// ============================================================================

export type BashSandboxMode = "enforce" | "warn" | "off";

export type DangerousPattern = {
  id: string;
  pattern: string;
  severity: "block" | "warn";
  message: string;
};

export type BashSandboxConfig = {
  mode: BashSandboxMode;
  domainAllowlist: string[];
  domainDenylist: string[];
  commandBlocklist: string[];
  commandAllowOverrides: string[];
  dangerousPatterns: DangerousPattern[];
  maxCommandLengthBytes: number;
  allowSudo: boolean;
  allowCurlToArbitraryDomains: boolean;
  bypassEnvVar: string;
};

// ============================================================================
// Defaults
// ============================================================================

const VALID_MODES: BashSandboxMode[] = ["enforce", "warn", "off"];

const DEFAULT_MODE: BashSandboxMode = "enforce";

const DEFAULT_DOMAIN_ALLOWLIST: string[] = [
  "github.com",
  "*.github.com",
  "*.githubusercontent.com",
  "npmjs.org",
  "*.npmjs.org",
  "registry.yarnpkg.com",
  "pypi.org",
  "crates.io",
  "rubygems.org",
  "hub.apilium.com",
  "api.apilium.com",
  "localhost",
  "127.0.0.1",
];

const DEFAULT_COMMAND_BLOCKLIST: string[] = [
  "mkfs",
  "fdisk",
  "dd",
  "shutdown",
  "reboot",
  "halt",
  "poweroff",
  "iptables",
  "useradd",
  "userdel",
  "visudo",
  "mount",
  "chroot",
  "insmod",
  "rmmod",
  "sysctl",
];

const DEFAULT_MAX_COMMAND_LENGTH_BYTES = 8192;
const DEFAULT_ALLOW_SUDO = false;
const DEFAULT_ALLOW_CURL_TO_ARBITRARY_DOMAINS = false;
const DEFAULT_BYPASS_ENV_VAR = "MAYROS_BASH_SANDBOX_BYPASS";

const DEFAULT_DANGEROUS_PATTERNS: DangerousPattern[] = [
  {
    id: "recursive-delete-root",
    pattern: "rm\\s+(-[a-zA-Z]*r[a-zA-Z]*f|f[a-zA-Z]*r)[a-zA-Z]*\\s+/(?:\\s|$)",
    severity: "block",
    message: "Recursive deletion of root filesystem",
  },
  {
    id: "env-exfil-curl",
    pattern: "(env|printenv).*\\|.*(curl|wget)",
    severity: "block",
    message: "Environment exfiltration via HTTP",
  },
  {
    id: "reverse-shell",
    pattern: "(bash\\s+-i\\s+>&|nc\\s+(-[a-zA-Z]*e|--exec)|/dev/tcp/)",
    severity: "block",
    message: "Reverse shell detected",
  },
  {
    id: "crypto-mining",
    pattern: "(xmrig|stratum\\+tcp|coinhive)",
    severity: "block",
    message: "Crypto mining detected",
  },
  {
    id: "pipe-to-shell",
    pattern: "(curl|wget).*\\|.*(bash|sh|zsh)\\b",
    severity: "block",
    message: "Piping remote content to shell",
  },
  {
    id: "chmod-world-writable",
    pattern: "chmod\\s+(777|a\\+rwx)\\s+/",
    severity: "warn",
    message: "World-writable permissions on system path",
  },
];

// ============================================================================
// Helpers
// ============================================================================

function parseStringArray(raw: unknown, fallback: string[]): string[] {
  if (!Array.isArray(raw)) return fallback;
  const result: string[] = [];
  for (const item of raw) {
    if (typeof item === "string") {
      result.push(item);
    }
  }
  return result;
}

function parseDangerousPatterns(raw: unknown): DangerousPattern[] {
  if (!Array.isArray(raw)) return DEFAULT_DANGEROUS_PATTERNS;
  const result: DangerousPattern[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string") continue;
    if (typeof entry.pattern !== "string") continue;
    if (entry.severity !== "block" && entry.severity !== "warn") continue;
    if (typeof entry.message !== "string") continue;
    result.push({
      id: entry.id,
      pattern: entry.pattern,
      severity: entry.severity,
      message: entry.message,
    });
  }
  return result;
}

function clampInt(raw: unknown, min: number, max: number, defaultVal: number): number {
  if (typeof raw !== "number") return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

// ============================================================================
// Schema
// ============================================================================

const ALLOWED_KEYS = [
  "mode",
  "domainAllowlist",
  "domainDenylist",
  "commandBlocklist",
  "commandAllowOverrides",
  "dangerousPatterns",
  "maxCommandLengthBytes",
  "allowSudo",
  "allowCurlToArbitraryDomains",
  "bypassEnvVar",
];

export const bashSandboxConfigSchema = {
  parse(value: unknown): BashSandboxConfig {
    const cfg = (value ?? {}) as Record<string, unknown>;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertAllowedKeys(cfg, ALLOWED_KEYS, "bash sandbox config");
    }

    const mode =
      typeof cfg.mode === "string" && VALID_MODES.includes(cfg.mode as BashSandboxMode)
        ? (cfg.mode as BashSandboxMode)
        : DEFAULT_MODE;

    const domainAllowlist = parseStringArray(cfg.domainAllowlist, DEFAULT_DOMAIN_ALLOWLIST);
    const domainDenylist = parseStringArray(cfg.domainDenylist, []);
    const commandBlocklist = parseStringArray(cfg.commandBlocklist, DEFAULT_COMMAND_BLOCKLIST);
    const commandAllowOverrides = parseStringArray(cfg.commandAllowOverrides, []);
    const dangerousPatterns = parseDangerousPatterns(cfg.dangerousPatterns);

    const maxCommandLengthBytes = clampInt(
      cfg.maxCommandLengthBytes,
      64,
      65536,
      DEFAULT_MAX_COMMAND_LENGTH_BYTES,
    );
    const allowSudo = cfg.allowSudo === true ? true : DEFAULT_ALLOW_SUDO;
    const allowCurlToArbitraryDomains =
      cfg.allowCurlToArbitraryDomains === true ? true : DEFAULT_ALLOW_CURL_TO_ARBITRARY_DOMAINS;
    const bypassEnvVar =
      typeof cfg.bypassEnvVar === "string" ? cfg.bypassEnvVar : DEFAULT_BYPASS_ENV_VAR;

    return {
      mode,
      domainAllowlist,
      domainDenylist,
      commandBlocklist,
      commandAllowOverrides,
      dangerousPatterns,
      maxCommandLengthBytes,
      allowSudo,
      allowCurlToArbitraryDomains,
      bypassEnvVar,
    };
  },
  uiHints: {
    mode: {
      label: "Sandbox Mode",
      placeholder: DEFAULT_MODE,
      help: "enforce: block dangerous commands, warn: log but allow, off: disabled",
    },
    domainAllowlist: {
      label: "Domain Allowlist",
      help: "Domains allowed for network commands (curl, wget). Supports wildcards like *.github.com",
    },
    commandBlocklist: {
      label: "Command Blocklist",
      help: "Commands that are always blocked (e.g. mkfs, dd, shutdown)",
    },
    maxCommandLengthBytes: {
      label: "Max Command Length",
      placeholder: String(DEFAULT_MAX_COMMAND_LENGTH_BYTES),
      advanced: true,
      help: "Maximum command string length in bytes (64-65536)",
    },
    allowSudo: {
      label: "Allow Sudo",
      help: "Whether to allow commands prefixed with sudo",
    },
    allowCurlToArbitraryDomains: {
      label: "Allow Arbitrary Domains",
      help: "Whether curl/wget can access domains not in the allowlist",
    },
    bypassEnvVar: {
      label: "Bypass Env Variable",
      placeholder: DEFAULT_BYPASS_ENV_VAR,
      advanced: true,
      help: "Environment variable that, when set to '1', bypasses the sandbox",
    },
  },
};

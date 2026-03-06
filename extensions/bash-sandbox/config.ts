/**
 * Bash Sandbox Configuration
 *
 * Manual validation following the project's cortex-config pattern.
 * Uses assertAllowedKeys for unknown key rejection, no Zod.
 */

import { assertAllowedKeys } from "../shared/cortex-config.js";
import {
  type NetworkSandboxConfig,
  DEFAULT_NETWORK_SANDBOX_CONFIG,
  parseNetworkSandboxConfig,
} from "./network-sandbox.js";

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

export type ContainerRuntime = "auto" | "docker" | "podman" | "gvisor";
export type ContainerMountPolicy = "workdir-only" | "home" | "custom";
export type ContainerNetworkMode = "none" | "host" | "bridge";

export type ContainerSecurityFlags = {
  blockPrivileged: boolean;
  blockHostNetwork: boolean;
  blockRootVolume: boolean;
  readOnlyRootfs: boolean;
  noNewPrivileges: boolean;
  dropCapabilities: string[];
};

export type ContainerResourceLimits = {
  cpus: number;
  memoryMb: number;
  pidsLimit: number;
};

export type ContainerConfig = {
  enabled: boolean;
  runtime: ContainerRuntime;
  image: string;
  allowedRegistries: string[];
  mountPolicy: ContainerMountPolicy;
  customMounts: string[];
  resourceLimits: ContainerResourceLimits;
  networkMode: ContainerNetworkMode;
  securityFlags: ContainerSecurityFlags;
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
  network: NetworkSandboxConfig;
  container: ContainerConfig;
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

const DEFAULT_CONTAINER_SECURITY_FLAGS: ContainerSecurityFlags = {
  blockPrivileged: true,
  blockHostNetwork: true,
  blockRootVolume: true,
  readOnlyRootfs: false,
  noNewPrivileges: true,
  dropCapabilities: ["ALL"],
};

const DEFAULT_CONTAINER_RESOURCE_LIMITS: ContainerResourceLimits = {
  cpus: 2,
  memoryMb: 512,
  pidsLimit: 256,
};

export const DEFAULT_CONTAINER_CONFIG: ContainerConfig = {
  enabled: false,
  runtime: "auto",
  image: "ubuntu:22.04",
  allowedRegistries: ["docker.io", "ghcr.io", "gcr.io", "quay.io"],
  mountPolicy: "workdir-only",
  customMounts: [],
  resourceLimits: { ...DEFAULT_CONTAINER_RESOURCE_LIMITS },
  networkMode: "none",
  securityFlags: { ...DEFAULT_CONTAINER_SECURITY_FLAGS },
};

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

const VALID_CONTAINER_RUNTIMES: ContainerRuntime[] = ["auto", "docker", "podman", "gvisor"];
const VALID_MOUNT_POLICIES: ContainerMountPolicy[] = ["workdir-only", "home", "custom"];
const VALID_CONTAINER_NETWORK_MODES: ContainerNetworkMode[] = ["none", "host", "bridge"];

function parseContainerSecurityFlags(raw: unknown): ContainerSecurityFlags {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CONTAINER_SECURITY_FLAGS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    blockPrivileged:
      typeof obj.blockPrivileged === "boolean"
        ? obj.blockPrivileged
        : DEFAULT_CONTAINER_SECURITY_FLAGS.blockPrivileged,
    blockHostNetwork:
      typeof obj.blockHostNetwork === "boolean"
        ? obj.blockHostNetwork
        : DEFAULT_CONTAINER_SECURITY_FLAGS.blockHostNetwork,
    blockRootVolume:
      typeof obj.blockRootVolume === "boolean"
        ? obj.blockRootVolume
        : DEFAULT_CONTAINER_SECURITY_FLAGS.blockRootVolume,
    readOnlyRootfs:
      typeof obj.readOnlyRootfs === "boolean"
        ? obj.readOnlyRootfs
        : DEFAULT_CONTAINER_SECURITY_FLAGS.readOnlyRootfs,
    noNewPrivileges:
      typeof obj.noNewPrivileges === "boolean"
        ? obj.noNewPrivileges
        : DEFAULT_CONTAINER_SECURITY_FLAGS.noNewPrivileges,
    dropCapabilities: Array.isArray(obj.dropCapabilities)
      ? obj.dropCapabilities.filter((c): c is string => typeof c === "string")
      : [...DEFAULT_CONTAINER_SECURITY_FLAGS.dropCapabilities],
  };
}

function parseContainerResourceLimits(raw: unknown): ContainerResourceLimits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CONTAINER_RESOURCE_LIMITS };
  }
  const obj = raw as Record<string, unknown>;
  return {
    cpus: clampInt(obj.cpus, 0, 32, DEFAULT_CONTAINER_RESOURCE_LIMITS.cpus),
    memoryMb: clampInt(obj.memoryMb, 0, 32768, DEFAULT_CONTAINER_RESOURCE_LIMITS.memoryMb),
    pidsLimit: clampInt(obj.pidsLimit, 0, 65536, DEFAULT_CONTAINER_RESOURCE_LIMITS.pidsLimit),
  };
}

export function parseContainerConfig(raw: unknown): ContainerConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CONTAINER_CONFIG };
  }
  const obj = raw as Record<string, unknown>;

  const runtime =
    typeof obj.runtime === "string" &&
    VALID_CONTAINER_RUNTIMES.includes(obj.runtime as ContainerRuntime)
      ? (obj.runtime as ContainerRuntime)
      : DEFAULT_CONTAINER_CONFIG.runtime;

  const mountPolicy =
    typeof obj.mountPolicy === "string" &&
    VALID_MOUNT_POLICIES.includes(obj.mountPolicy as ContainerMountPolicy)
      ? (obj.mountPolicy as ContainerMountPolicy)
      : DEFAULT_CONTAINER_CONFIG.mountPolicy;

  const networkMode =
    typeof obj.networkMode === "string" &&
    VALID_CONTAINER_NETWORK_MODES.includes(obj.networkMode as ContainerNetworkMode)
      ? (obj.networkMode as ContainerNetworkMode)
      : DEFAULT_CONTAINER_CONFIG.networkMode;

  return {
    enabled: typeof obj.enabled === "boolean" ? obj.enabled : DEFAULT_CONTAINER_CONFIG.enabled,
    runtime,
    image: typeof obj.image === "string" ? obj.image : DEFAULT_CONTAINER_CONFIG.image,
    allowedRegistries: parseStringArray(obj.allowedRegistries, [
      ...DEFAULT_CONTAINER_CONFIG.allowedRegistries,
    ]),
    mountPolicy,
    customMounts: parseStringArray(obj.customMounts, []),
    resourceLimits: parseContainerResourceLimits(obj.resourceLimits),
    networkMode,
    securityFlags: parseContainerSecurityFlags(obj.securityFlags),
  };
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
  "network",
  "container",
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

    const network =
      cfg.network && typeof cfg.network === "object" && !Array.isArray(cfg.network)
        ? parseNetworkSandboxConfig(cfg.network as Record<string, unknown>)
        : { ...DEFAULT_NETWORK_SANDBOX_CONFIG };

    const container = parseContainerConfig(cfg.container);

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
      network,
      container,
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
    network: {
      label: "Network Sandbox",
      help: "OS-level network isolation for sandboxed commands",
      children: {
        enabled: {
          label: "Enabled",
          help: "Enable network isolation (sandbox-exec on macOS, unshare on Linux, env-proxy fallback)",
        },
        mode: {
          label: "Network Mode",
          placeholder: "allowlist",
          help: "none: no restrictions, allowlist: only listed domains, full: all except denied",
        },
        allowedDomains: {
          label: "Allowed Domains",
          help: "Domains permitted for network access. Supports wildcards like *.github.com",
        },
        denyDomains: {
          label: "Deny Domains",
          help: "Domains always blocked (takes priority over allowlist)",
        },
        maxConnections: {
          label: "Max Connections",
          placeholder: "10",
          advanced: true,
          help: "Maximum concurrent network connections per sandbox (1-100)",
        },
      },
    },
    container: {
      label: "Container Sandbox",
      help: "Run commands inside Docker/Podman containers for kernel-level isolation",
      children: {
        enabled: {
          label: "Enabled",
          help: "Enable container-based command execution (requires Docker or Podman)",
        },
        runtime: {
          label: "Runtime",
          placeholder: "auto",
          help: "auto: detect best available, docker, podman, gvisor (Docker+runsc)",
        },
        image: {
          label: "Container Image",
          placeholder: "ubuntu:22.04",
          help: "Default container image for sandboxed commands",
        },
        allowedRegistries: {
          label: "Allowed Registries",
          help: "Trusted container image registries (e.g. docker.io, ghcr.io)",
        },
        mountPolicy: {
          label: "Mount Policy",
          placeholder: "workdir-only",
          help: "workdir-only: only project dir, home: add home (ro), custom: add custom mounts",
        },
        networkMode: {
          label: "Network Mode",
          placeholder: "none",
          help: "none: no network, bridge: isolated bridge network",
        },
        resourceLimits: {
          label: "Resource Limits",
          advanced: true,
          help: "CPU, memory, and PID limits for containers",
        },
        securityFlags: {
          label: "Security Flags",
          advanced: true,
          help: "Container security restrictions (privilege blocking, capabilities, etc.)",
        },
      },
    },
  },
};

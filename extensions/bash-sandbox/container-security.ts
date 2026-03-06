/**
 * Container Security — Validates container flags, mounts, and images.
 *
 * Prevents dangerous container configurations:
 * - --privileged escalation
 * - --net=host network bypass
 * - Root filesystem mount (/ → /host)
 * - Untrusted image registries
 * - Dangerous capabilities (SYS_ADMIN, SYS_PTRACE, etc.)
 */

import type { ContainerConfig } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type SecurityViolation = {
  rule: string;
  severity: "block" | "warn";
  message: string;
  detail?: string;
};

// ============================================================================
// Flag Validation
// ============================================================================

/** Docker run flags that escalate container privileges. */
const DANGEROUS_FLAGS: Array<{
  pattern: RegExp;
  rule: string;
  severity: "block" | "warn";
  message: string;
}> = [
  {
    pattern: /--privileged/,
    rule: "privileged-mode",
    severity: "block",
    message: "Privileged mode gives full host access",
  },
  {
    pattern: /--net(?:work)?=host/,
    rule: "host-network",
    severity: "block",
    message: "Host network bypasses network isolation",
  },
  {
    pattern: /--pid=host/,
    rule: "host-pid",
    severity: "block",
    message: "Host PID namespace allows process manipulation",
  },
  {
    pattern: /--ipc=host/,
    rule: "host-ipc",
    severity: "block",
    message: "Host IPC namespace allows shared memory access",
  },
  {
    pattern: /--userns=host/,
    rule: "host-userns",
    severity: "block",
    message: "Host user namespace bypasses UID isolation",
  },
  {
    pattern: /--cap-add=SYS_ADMIN/,
    rule: "cap-sys-admin",
    severity: "block",
    message: "SYS_ADMIN capability allows mounting and namespace manipulation",
  },
  {
    pattern: /--cap-add=SYS_PTRACE/,
    rule: "cap-sys-ptrace",
    severity: "warn",
    message: "SYS_PTRACE allows process debugging",
  },
  {
    pattern: /--cap-add=NET_ADMIN/,
    rule: "cap-net-admin",
    severity: "warn",
    message: "NET_ADMIN allows network configuration changes",
  },
  {
    pattern: /--cap-add=ALL/,
    rule: "cap-all",
    severity: "block",
    message: "Adding all capabilities is equivalent to privileged mode",
  },
  {
    pattern: /--security-opt\s*(?:=\s*)?(?:seccomp|apparmor)(?:=|:)unconfined/,
    rule: "unconfined-security",
    severity: "block",
    message: "Disabling security profiles removes a defense layer",
  },
  {
    pattern: /--device\s*(?:=\s*)?\/dev\//,
    rule: "device-access",
    severity: "warn",
    message: "Direct device access from container",
  },
];

/**
 * Validate Docker/Podman flags in a raw command string for dangerous options.
 */
export function validateDockerFlags(command: string): SecurityViolation[] {
  const violations: SecurityViolation[] = [];
  for (const flag of DANGEROUS_FLAGS) {
    if (flag.pattern.test(command)) {
      violations.push({
        rule: flag.rule,
        severity: flag.severity,
        message: flag.message,
        detail: command.match(flag.pattern)?.[0],
      });
    }
  }
  return violations;
}

// ============================================================================
// Volume Mount Validation
// ============================================================================

/** Paths that must never be mounted read-write into containers. */
const DANGEROUS_MOUNT_SOURCES = [
  { path: "/", exact: true, rule: "root-mount", message: "Root filesystem mount" },
  { path: "/etc", exact: false, rule: "etc-mount", message: "System config directory mount" },
  { path: "/proc", exact: false, rule: "proc-mount", message: "Proc filesystem mount" },
  { path: "/sys", exact: false, rule: "sys-mount", message: "Sys filesystem mount" },
  { path: "/dev", exact: false, rule: "dev-mount", message: "Device filesystem mount" },
  { path: "/boot", exact: false, rule: "boot-mount", message: "Boot partition mount" },
  {
    path: "/var/run/docker.sock",
    exact: true,
    rule: "docker-socket",
    message: "Docker socket mount (container escape)",
  },
  {
    path: "/run/docker.sock",
    exact: true,
    rule: "docker-socket",
    message: "Docker socket mount (container escape)",
  },
  {
    path: "/var/run/podman",
    exact: false,
    rule: "podman-socket",
    message: "Podman socket mount (container escape)",
  },
];

/**
 * Parse a volume mount string (e.g. "/host/path:/container/path:ro").
 */
export function parseVolumeMount(mount: string): {
  source: string;
  target: string;
  readOnly: boolean;
} | null {
  const parts = mount.split(":");
  if (parts.length < 2) return null;

  // Handle Windows paths (C:\path → C:\path)
  let source: string;
  let target: string;
  let options = "";

  if (parts.length === 2) {
    source = parts[0];
    target = parts[1];
  } else if (parts.length === 3) {
    // Could be /src:/dst:ro or C:\path:/dst
    if (parts[2] === "ro" || parts[2] === "rw" || parts[2].includes(",")) {
      source = parts[0];
      target = parts[1];
      options = parts[2];
    } else {
      // Likely Windows path in first segment
      source = `${parts[0]}:${parts[1]}`;
      target = parts[2];
    }
  } else if (parts.length === 4) {
    // Windows path with options: C:\path:/dst:ro
    source = `${parts[0]}:${parts[1]}`;
    target = parts[2];
    options = parts[3];
  } else {
    return null;
  }

  return {
    source: source.trim(),
    target: target.trim(),
    readOnly: options.includes("ro"),
  };
}

/**
 * Validate volume mounts against security policy.
 */
export function validateVolumeMounts(mounts: string[]): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  for (const mount of mounts) {
    const parsed = parseVolumeMount(mount);
    if (!parsed) continue;

    // Normalize source path
    const normalizedSource = parsed.source.replace(/\/+$/, "") || "/";

    for (const dangerous of DANGEROUS_MOUNT_SOURCES) {
      const matches = dangerous.exact
        ? normalizedSource === dangerous.path
        : normalizedSource === dangerous.path || normalizedSource.startsWith(dangerous.path + "/");

      if (matches && !parsed.readOnly) {
        violations.push({
          rule: dangerous.rule,
          severity: "block",
          message: `${dangerous.message}: ${parsed.source} → ${parsed.target} (read-write)`,
          detail: mount,
        });
      } else if (matches && parsed.readOnly) {
        // Read-only mounts of dangerous paths get a warning
        violations.push({
          rule: dangerous.rule,
          severity: "warn",
          message: `${dangerous.message}: ${parsed.source} → ${parsed.target} (read-only)`,
          detail: mount,
        });
      }
    }
  }

  return violations;
}

// ============================================================================
// Image Registry Validation
// ============================================================================

/**
 * Extract the registry from an image reference.
 *
 * Examples:
 * - "ubuntu" → "docker.io" (implicit default)
 * - "docker.io/library/ubuntu" → "docker.io"
 * - "ghcr.io/owner/image:tag" → "ghcr.io"
 * - "registry.example.com:5000/image" → "registry.example.com"
 */
export function extractImageRegistry(image: string): string {
  // Remove digest (@sha256:...)
  const ref = image.split("@")[0];
  const parts = ref.split("/");

  if (parts.length === 1) {
    // Just image name: "ubuntu", "alpine", "ubuntu:22.04"
    return "docker.io";
  }

  // Check if first part looks like a registry (has dot or port)
  const first = parts[0];
  // Strip port from registry: "registry.example.com:5000" → "registry.example.com"
  const registryHost = first.split(":")[0];
  if (registryHost.includes(".")) {
    return registryHost;
  }

  // "library/ubuntu" or "user/image" → default registry
  return "docker.io";
}

/**
 * Validate an image against allowed registries.
 *
 * Empty allowedRegistries means all registries are allowed.
 */
export function validateImageRegistry(
  image: string,
  allowedRegistries: string[],
): SecurityViolation | null {
  if (allowedRegistries.length === 0) return null;

  const registry = extractImageRegistry(image);

  for (const allowed of allowedRegistries) {
    if (registry === allowed) return null;
    // Wildcard matching: *.example.com matches sub.example.com
    if (allowed.startsWith("*.")) {
      const suffix = allowed.slice(1); // ".example.com"
      if (registry.endsWith(suffix)) return null;
    }
  }

  return {
    rule: "untrusted-registry",
    severity: "block",
    message: `Image registry "${registry}" is not in the allowed list`,
    detail: `Image: ${image}, Allowed: ${allowedRegistries.join(", ")}`,
  };
}

// ============================================================================
// Full Validation
// ============================================================================

/**
 * Run all security validations for a container execution request.
 */
export function validateContainerSecurity(
  command: string,
  mounts: string[],
  image: string,
  config: ContainerConfig,
): SecurityViolation[] {
  const violations: SecurityViolation[] = [];

  // 1. Validate docker flags in the raw command
  violations.push(...validateDockerFlags(command));

  // 2. Validate volume mounts
  violations.push(...validateVolumeMounts(mounts));

  // 3. Validate image registry
  const registryViolation = validateImageRegistry(image, config.allowedRegistries);
  if (registryViolation) {
    violations.push(registryViolation);
  }

  // 4. Config-level security checks
  if (config.securityFlags.blockPrivileged && command.includes("--privileged")) {
    // Already caught by flag validation, but ensure it's a block
    const existing = violations.find((v) => v.rule === "privileged-mode");
    if (existing) existing.severity = "block";
  }

  if (config.securityFlags.blockHostNetwork && /--net(?:work)?=host/.test(command)) {
    const existing = violations.find((v) => v.rule === "host-network");
    if (existing) existing.severity = "block";
  }

  return violations;
}

/**
 * Check if violations contain any blocking rules.
 */
export function hasBlockingViolation(violations: SecurityViolation[]): boolean {
  return violations.some((v) => v.severity === "block");
}

/**
 * Format violations for display.
 */
export function formatViolations(violations: SecurityViolation[]): string {
  if (violations.length === 0) return "No security violations found.";

  const lines: string[] = [`Container security violations (${violations.length}):`];
  for (const v of violations) {
    const icon = v.severity === "block" ? "BLOCK" : "WARN";
    lines.push(`  [${icon}] ${v.rule}: ${v.message}`);
    if (v.detail) {
      lines.push(`         ${v.detail}`);
    }
  }
  return lines.join("\n");
}

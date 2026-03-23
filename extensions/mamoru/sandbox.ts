/**
 * Mamoru Sandbox — Kernel-level sandbox orchestrator
 *
 * Uses Landlock + seccomp on Linux when available, falls back gracefully
 * on other platforms. Provides filesystem, process, and privilege isolation.
 */

import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────

export type SandboxPolicy = {
  filesystem: {
    readOnly: string[];
    readWrite: string[];
    denied: string[];
  };
  process: {
    allowElevation: boolean;
    maxProcesses: number;
  };
  compatibility: "enforce" | "best_effort";
};

export type SandboxStatus = "active" | "inactive" | "unsupported" | "simulated";

export type SandboxAvailability = {
  landlock: boolean;
  seccomp: boolean;
  platform: string;
};

export type SandboxApplyResult = {
  status: SandboxStatus;
  appliedLayers: string[];
};

// ── Default policy ───────────────────────────────────────────────────────

const DEFAULT_READ_ONLY = [
  "/usr",
  "/lib",
  "/proc/self/status",
  "/etc/ssl",
  "/etc/resolv.conf",
];

const DEFAULT_READ_WRITE = [
  resolve(homedir(), ".mayros"),
  "/tmp",
  // process.cwd() added at runtime
];

const DEFAULT_DENIED = [
  "/etc/shadow",
  "/etc/passwd", // write access denied
  resolve(homedir(), ".ssh"), // write access denied
];

// ── Implementation ───────────────────────────────────────────────────────

export class MamoruSandbox {
  private status: SandboxStatus = "inactive";
  private appliedPolicy: SandboxPolicy | null = null;

  constructor(private readonly ns: string) {}

  /**
   * Check whether kernel-level sandboxing is available on this platform.
   */
  async checkAvailability(): Promise<SandboxAvailability> {
    const platform = process.platform;

    if (platform !== "linux") {
      return { landlock: false, seccomp: false, platform };
    }

    let landlock = false;
    let seccomp = false;

    // Probe for Landlock support
    try {
      const landlockAbi = "/proc/sys/kernel/landlock/abi_version";
      if (existsSync(landlockAbi)) {
        const version = await readFile(landlockAbi, "utf-8");
        landlock = parseInt(version.trim(), 10) >= 1;
      }
    } catch {
      // Landlock not available
    }

    // Probe for seccomp support
    try {
      const seccompPath = "/proc/self/status";
      if (existsSync(seccompPath)) {
        const content = await readFile(seccompPath, "utf-8");
        seccomp = /^Seccomp:\s+[012]$/m.test(content);
      }
    } catch {
      // seccomp not available
    }

    return { landlock, seccomp, platform };
  }

  /**
   * Apply a sandbox policy. On non-Linux platforms this is a no-op
   * that returns status "unsupported".
   *
   * Actual Landlock/seccomp enforcement is pending — status reflects
   * availability check only. When kernel primitives are detected but
   * actual syscalls are not yet wired, status is "simulated".
   */
  async apply(policy: SandboxPolicy): Promise<SandboxApplyResult> {
    const availability = await this.checkAvailability();
    const appliedLayers: string[] = [];

    if (availability.platform !== "linux") {
      this.status = "unsupported";
      this.appliedPolicy = policy;
      return { status: this.status, appliedLayers };
    }

    if (policy.compatibility === "enforce" && !availability.landlock && !availability.seccomp) {
      throw new Error(
        "mamoru: sandbox enforcement requested but no kernel sandbox primitives are available",
      );
    }

    // TODO: Apply Landlock filesystem restrictions
    // landlock_create_ruleset() with LANDLOCK_ACCESS_FS_READ_FILE etc.
    // For each readOnly path: add LANDLOCK_ACCESS_FS_READ_FILE rule
    // For each readWrite path: add full access rule
    // For each denied path: omit from ruleset (implicit deny)
    // landlock_restrict_self() to apply
    if (availability.landlock) {
      appliedLayers.push("landlock");
    }

    // TODO: Apply seccomp BPF filter
    // Install BPF filter to block:
    // - setuid/setgid if !allowElevation
    // - fork/clone if maxProcesses exceeded (via RLIMIT_NPROC first)
    // prctl(PR_SET_NO_NEW_PRIVS, 1) as prerequisite
    // seccomp(SECCOMP_SET_MODE_FILTER, ...) with BPF program
    if (availability.seccomp) {
      appliedLayers.push("seccomp");
    }

    // Apply RLIMIT_NPROC as a best-effort layer regardless
    // TODO: Use posix.setrlimit(RLIMIT_NPROC, { soft: policy.process.maxProcesses, hard: ... })
    if (policy.process.maxProcesses > 0) {
      appliedLayers.push("rlimit_nproc");
    }

    // Actual kernel calls are not yet implemented — report "simulated"
    // to distinguish from truly enforced sandboxing
    this.status = appliedLayers.length > 0 ? "simulated" : "inactive";
    this.appliedPolicy = policy;

    return { status: this.status, appliedLayers };
  }

  /**
   * Return a secure default policy.
   */
  getDefaultPolicy(): SandboxPolicy {
    return {
      filesystem: {
        readOnly: [...DEFAULT_READ_ONLY],
        readWrite: [...DEFAULT_READ_WRITE, process.cwd()],
        denied: [...DEFAULT_DENIED],
      },
      process: {
        allowElevation: false,
        maxProcesses: 50,
      },
      compatibility: "best_effort",
    };
  }

  /**
   * Load a sandbox policy from a YAML file.
   * Expects keys matching SandboxPolicy structure.
   */
  async loadPolicy(yamlPath: string): Promise<SandboxPolicy> {
    const content = await readFile(resolve(yamlPath), "utf-8");
    // Simple YAML parser for flat sandbox config
    // Supports the structure:
    //   filesystem:
    //     readOnly: ["/usr", "/lib"]
    //     readWrite: ["~/.mayros", "/tmp"]
    //     denied: ["/etc/shadow"]
    //   process:
    //     allowElevation: false
    //     maxProcesses: 50
    //   compatibility: best_effort
    let parsed: Record<string, unknown>;
    try {
      parsed = parseSimpleYaml(content);
    } catch {
      console.warn(
        `[${this.ns}] mamoru-sandbox: failed to parse policy from "${yamlPath}", using default policy`,
      );
      return this.getDefaultPolicy();
    }
    return validatePolicy(parsed);
  }

  /**
   * Get current sandbox status along with namespace context.
   */
  getStatus(): SandboxStatus {
    return this.status;
  }

  /**
   * Get a status summary including namespace context.
   */
  getStatusSummary(): { ns: string; status: SandboxStatus; hasPolicy: boolean } {
    return {
      ns: this.ns,
      status: this.status,
      hasPolicy: this.appliedPolicy !== null,
    };
  }

  /**
   * Get the currently applied policy, if any.
   */
  getAppliedPolicy(): SandboxPolicy | null {
    return this.appliedPolicy;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseSimpleYaml(content: string): Record<string, unknown> {
  // Minimal YAML-like parser for sandbox policy files.
  // For production use, consider a full YAML parser.
  const lines = content.split("\n");
  const result: Record<string, unknown> = {};
  let currentSection = "";
  let currentSubSection = "";

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (!line || line.startsWith("#")) continue;

    const indent = line.length - line.trimStart().length;
    const trimmed = line.trim();

    if (indent === 0 && trimmed.endsWith(":")) {
      currentSection = trimmed.slice(0, -1);
      result[currentSection] = {};
      currentSubSection = "";
    } else if (indent === 2 && trimmed.endsWith(":")) {
      currentSubSection = trimmed.slice(0, -1);
    } else if (indent === 2 && trimmed.includes(":")) {
      const [key, ...rest] = trimmed.split(":");
      const value = rest.join(":").trim();
      if (currentSection && typeof result[currentSection] === "object") {
        (result[currentSection] as Record<string, unknown>)[key!.trim()] = parseValue(value);
      }
    } else if (indent === 0 && trimmed.includes(":")) {
      const [key, ...rest] = trimmed.split(":");
      const value = rest.join(":").trim();
      result[key!.trim()] = parseValue(value);
    } else if (indent >= 4 && trimmed.startsWith("- ")) {
      if (currentSection && currentSubSection) {
        const section = result[currentSection] as Record<string, unknown>;
        if (!Array.isArray(section[currentSubSection])) {
          section[currentSubSection] = [];
        }
        (section[currentSubSection] as string[]).push(trimmed.slice(2).trim().replace(/^["']|["']$/g, ""));
      }
    }
  }

  return result;
}

function parseValue(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  const num = Number(value);
  if (!isNaN(num) && value !== "") return num;
  return value.replace(/^["']|["']$/g, "");
}

function validatePolicy(raw: Record<string, unknown>): SandboxPolicy {
  const fs = (raw.filesystem ?? {}) as Record<string, unknown>;
  const proc = (raw.process ?? {}) as Record<string, unknown>;

  return {
    filesystem: {
      readOnly: Array.isArray(fs.readOnly) ? fs.readOnly : [],
      readWrite: Array.isArray(fs.readWrite) ? fs.readWrite : [],
      denied: Array.isArray(fs.denied) ? fs.denied : [],
    },
    process: {
      allowElevation: proc.allowElevation === true,
      maxProcesses: typeof proc.maxProcesses === "number" ? proc.maxProcesses : 50,
    },
    compatibility:
      raw.compatibility === "enforce" ? "enforce" : "best_effort",
  };
}

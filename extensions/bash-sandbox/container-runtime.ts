/**
 * Container Runtime — Docker/Podman/gVisor detection and command wrapping.
 *
 * Detects available container runtimes, builds `docker run` / `podman run`
 * commands with proper security flags, volume mounts, and resource limits.
 *
 * Strategies:
 * - Docker: `docker run --rm --security-opt=no-new-privileges ...`
 * - Podman: `podman run --rm --security-opt=no-new-privileges ...` (rootless)
 * - gVisor: `docker run --rm --runtime=runsc ...`
 */

import { execFileSync } from "node:child_process";
import { resolve, isAbsolute } from "node:path";
import { existsSync } from "node:fs";
import type { ContainerConfig } from "./config.js";

// ============================================================================
// Types
// ============================================================================

export type RuntimeId = "docker" | "podman" | "gvisor";

export type DetectedRuntime = {
  id: RuntimeId;
  binary: string;
  version: string;
  available: boolean;
  rootless: boolean;
};

export type ContainerRunOptions = {
  command: string;
  workdir: string;
  config: ContainerConfig;
  env?: Record<string, string>;
  extraMounts?: string[];
};

export type ContainerRunResult = {
  args: string[];
  binary: string;
  runtime: RuntimeId;
};

// ============================================================================
// Detection
// ============================================================================

function execSilent(binary: string, args: string[]): string | null {
  try {
    return execFileSync(binary, args, {
      encoding: "utf-8",
      timeout: 5000,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim();
  } catch {
    return null;
  }
}

function parseVersion(output: string | null): string {
  if (!output) return "";
  // Docker: "Docker version 24.0.7, build ..."
  // Podman: "podman version 4.9.0"
  const match = output.match(/(\d+\.\d+(?:\.\d+)?)/);
  return match?.[1] ?? "";
}

function detectDocker(): DetectedRuntime {
  const version = parseVersion(execSilent("docker", ["--version"]));
  if (!version) {
    return { id: "docker", binary: "docker", version: "", available: false, rootless: false };
  }
  // Check if running rootless
  const info = execSilent("docker", ["info", "--format", "{{.SecurityOptions}}"]);
  const rootless = info?.includes("rootless") ?? false;
  return { id: "docker", binary: "docker", version, available: true, rootless };
}

function detectPodman(): DetectedRuntime {
  const version = parseVersion(execSilent("podman", ["--version"]));
  if (!version) {
    return { id: "podman", binary: "podman", version: "", available: false, rootless: false };
  }
  // Podman is rootless by default
  return { id: "podman", binary: "podman", version, available: true, rootless: true };
}

function detectGvisor(): DetectedRuntime {
  // gVisor uses Docker with --runtime=runsc
  const docker = detectDocker();
  if (!docker.available) {
    return { id: "gvisor", binary: "docker", version: "", available: false, rootless: false };
  }
  // Check if runsc runtime is available
  const info = execSilent("docker", ["info", "--format", "{{.Runtimes}}"]);
  const hasRunsc = info?.includes("runsc") ?? false;
  if (!hasRunsc) {
    return { id: "gvisor", binary: "docker", version: "", available: false, rootless: false };
  }
  return {
    id: "gvisor",
    binary: "docker",
    version: docker.version,
    available: true,
    rootless: docker.rootless,
  };
}

// ============================================================================
// ContainerRuntime
// ============================================================================

const RUNTIME_DETECTORS: Record<RuntimeId, () => DetectedRuntime> = {
  docker: detectDocker,
  podman: detectPodman,
  gvisor: detectGvisor,
};

const RUNTIME_PRIORITY: RuntimeId[] = ["gvisor", "docker", "podman"];

export class ContainerRuntime {
  private cache: Map<RuntimeId, DetectedRuntime> = new Map();

  /**
   * Detect all available container runtimes.
   */
  detectAll(): DetectedRuntime[] {
    const results: DetectedRuntime[] = [];
    for (const id of RUNTIME_PRIORITY) {
      const cached = this.cache.get(id);
      if (cached) {
        results.push(cached);
        continue;
      }
      const detected = RUNTIME_DETECTORS[id]();
      this.cache.set(id, detected);
      results.push(detected);
    }
    return results;
  }

  /**
   * Select the best available runtime based on config preference.
   */
  selectRuntime(preference: ContainerConfig["runtime"]): DetectedRuntime | null {
    if (preference !== "auto") {
      const cached = this.cache.get(preference);
      if (cached) return cached.available ? cached : null;
      const detected = RUNTIME_DETECTORS[preference]();
      this.cache.set(preference, detected);
      return detected.available ? detected : null;
    }

    // Auto-detect: try in priority order
    for (const id of RUNTIME_PRIORITY) {
      const cached = this.cache.get(id);
      if (cached?.available) return cached;
      const detected = RUNTIME_DETECTORS[id]();
      this.cache.set(id, detected);
      if (detected.available) return detected;
    }
    return null;
  }

  /**
   * Build the full `docker run` / `podman run` command arguments.
   */
  buildRunCommand(opts: ContainerRunOptions): ContainerRunResult | null {
    const runtime = this.selectRuntime(opts.config.runtime);
    if (!runtime) return null;

    const args: string[] = ["run", "--rm"];

    // gVisor runtime flag
    if (runtime.id === "gvisor") {
      args.push("--runtime=runsc");
    }

    // Security flags
    const sec = opts.config.securityFlags;
    if (sec.noNewPrivileges) {
      args.push("--security-opt=no-new-privileges");
    }
    if (sec.readOnlyRootfs) {
      args.push("--read-only");
    }
    if (sec.dropCapabilities.length > 0) {
      args.push("--cap-drop=ALL");
      // Re-add only if explicit list does NOT include "ALL"
      for (const cap of sec.dropCapabilities) {
        if (cap !== "ALL") {
          args.push(`--cap-add=${cap}`);
        }
      }
    }

    // Resource limits
    const limits = opts.config.resourceLimits;
    if (limits.cpus > 0) {
      args.push(`--cpus=${limits.cpus}`);
    }
    if (limits.memoryMb > 0) {
      args.push(`--memory=${limits.memoryMb}m`);
    }
    if (limits.pidsLimit > 0) {
      args.push(`--pids-limit=${limits.pidsLimit}`);
    }

    // Network mode
    if (opts.config.networkMode === "none") {
      args.push("--network=none");
    } else if (opts.config.networkMode === "bridge") {
      args.push("--network=bridge");
    }
    // "host" is intentionally NOT wired — blocked by security policy

    // Volume mounts
    const mounts = buildVolumeMounts(opts);
    for (const mount of mounts) {
      args.push("-v", mount);
    }

    // Working directory inside container
    args.push("-w", "/workspace");

    // Environment variables
    if (opts.env) {
      for (const [key, value] of Object.entries(opts.env)) {
        args.push("-e", `${key}=${value}`);
      }
    }

    // Pass through common env vars
    for (const envVar of ["HOME", "USER", "SHELL", "TERM", "LANG", "PATH"]) {
      if (process.env[envVar]) {
        args.push("-e", `${envVar}=${process.env[envVar]}`);
      }
    }

    // Image
    args.push(opts.config.image);

    // Command: bash -c '<command>'
    args.push("bash", "-c", opts.command);

    return {
      args,
      binary: runtime.binary,
      runtime: runtime.id,
    };
  }

  /**
   * Check if an image is available locally.
   */
  isImageAvailable(image: string, runtime?: DetectedRuntime): boolean {
    const binary = runtime?.binary ?? "docker";
    const result = execSilent(binary, ["image", "inspect", image]);
    return result !== null;
  }

  /**
   * Pull a container image.
   */
  pullImage(image: string, runtime?: DetectedRuntime): boolean {
    const binary = runtime?.binary ?? "docker";
    const result = execSilent(binary, ["pull", image]);
    return result !== null;
  }

  /**
   * Clear the detection cache.
   */
  clearCache(): void {
    this.cache.clear();
  }
}

// ============================================================================
// Volume Mount Builder
// ============================================================================

/**
 * Build volume mount strings based on mount policy.
 */
export function buildVolumeMounts(opts: ContainerRunOptions): string[] {
  const mounts: string[] = [];
  const policy = opts.config.mountPolicy;

  // Always mount workdir
  const workdir = isAbsolute(opts.workdir) ? opts.workdir : resolve(opts.workdir);
  mounts.push(`${workdir}:/workspace`);

  if (policy === "home" || policy === "custom") {
    // Mount home directory read-only
    const home = process.env.HOME;
    if (home && existsSync(home) && home !== workdir) {
      mounts.push(`${home}:/home/user:ro`);
    }

    // Temp directory
    const tmpDir = process.env.TMPDIR || "/tmp";
    if (existsSync(tmpDir)) {
      mounts.push(`${tmpDir}:/tmp`);
    }
  }

  if (policy === "custom" && opts.config.customMounts.length > 0) {
    for (const mount of opts.config.customMounts) {
      mounts.push(mount);
    }
  }

  // Extra mounts from caller
  if (opts.extraMounts) {
    for (const mount of opts.extraMounts) {
      mounts.push(mount);
    }
  }

  return mounts;
}

/**
 * Format a runtime detection result for display.
 */
export function formatRuntimeStatus(runtimes: DetectedRuntime[]): string {
  const lines: string[] = ["Container Runtimes:"];
  for (const rt of runtimes) {
    const status = rt.available ? `v${rt.version}` : "not found";
    const flags: string[] = [];
    if (rt.rootless) flags.push("rootless");
    const flagStr = flags.length > 0 ? ` (${flags.join(", ")})` : "";
    lines.push(`  ${rt.id}: ${status}${flagStr}`);
  }
  return lines.join("\n");
}

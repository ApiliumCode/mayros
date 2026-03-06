import { describe, it, expect } from "vitest";
import {
  validateDockerFlags,
  validateVolumeMounts,
  validateImageRegistry,
  extractImageRegistry,
  parseVolumeMount,
  validateContainerSecurity,
  hasBlockingViolation,
  formatViolations,
} from "./container-security.js";
import { DEFAULT_CONTAINER_CONFIG } from "./config.js";

// ============================================================================
// validateDockerFlags
// ============================================================================

describe("validateDockerFlags", () => {
  // 1
  it("detects --privileged flag", () => {
    const violations = validateDockerFlags("docker run --privileged ubuntu bash");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("privileged-mode");
    expect(violations[0].severity).toBe("block");
  });

  // 2
  it("detects --net=host flag", () => {
    const violations = validateDockerFlags("docker run --net=host ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("host-network");
  });

  // 3
  it("detects --network=host flag", () => {
    const violations = validateDockerFlags("docker run --network=host ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("host-network");
  });

  // 4
  it("detects --pid=host flag", () => {
    const violations = validateDockerFlags("docker run --pid=host ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("host-pid");
  });

  // 5
  it("detects --cap-add=SYS_ADMIN", () => {
    const violations = validateDockerFlags("docker run --cap-add=SYS_ADMIN ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("cap-sys-admin");
    expect(violations[0].severity).toBe("block");
  });

  // 6
  it("detects --cap-add=ALL", () => {
    const violations = validateDockerFlags("docker run --cap-add=ALL ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("cap-all");
    expect(violations[0].severity).toBe("block");
  });

  // 7
  it("detects --cap-add=SYS_PTRACE as warning", () => {
    const violations = validateDockerFlags("docker run --cap-add=SYS_PTRACE ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("warn");
  });

  // 8
  it("detects seccomp=unconfined", () => {
    const violations = validateDockerFlags("docker run --security-opt seccomp=unconfined ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("unconfined-security");
  });

  // 9
  it("detects device access", () => {
    const violations = validateDockerFlags("docker run --device /dev/sda ubuntu");
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("device-access");
    expect(violations[0].severity).toBe("warn");
  });

  // 10
  it("returns empty for safe command", () => {
    const violations = validateDockerFlags("docker run --rm ubuntu echo hello");
    expect(violations).toHaveLength(0);
  });

  // 11
  it("detects multiple violations", () => {
    const violations = validateDockerFlags(
      "docker run --privileged --net=host --cap-add=SYS_ADMIN ubuntu",
    );
    expect(violations.length).toBeGreaterThanOrEqual(3);
  });
});

// ============================================================================
// parseVolumeMount
// ============================================================================

describe("parseVolumeMount", () => {
  // 12
  it("parses simple mount", () => {
    const result = parseVolumeMount("/host:/container");
    expect(result).toEqual({ source: "/host", target: "/container", readOnly: false });
  });

  // 13
  it("parses mount with :ro", () => {
    const result = parseVolumeMount("/host:/container:ro");
    expect(result).toEqual({ source: "/host", target: "/container", readOnly: true });
  });

  // 14
  it("parses mount with :rw", () => {
    const result = parseVolumeMount("/host:/container:rw");
    expect(result).toEqual({ source: "/host", target: "/container", readOnly: false });
  });

  // 15
  it("returns null for invalid mount", () => {
    expect(parseVolumeMount("nocolon")).toBeNull();
  });
});

// ============================================================================
// validateVolumeMounts
// ============================================================================

describe("validateVolumeMounts", () => {
  // 16
  it("blocks root filesystem mount", () => {
    const violations = validateVolumeMounts(["/:/host"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("root-mount");
    expect(violations[0].severity).toBe("block");
  });

  // 17
  it("warns on root mount read-only", () => {
    const violations = validateVolumeMounts(["/:/host:ro"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].severity).toBe("warn");
  });

  // 18
  it("blocks /etc mount read-write", () => {
    const violations = validateVolumeMounts(["/etc:/etc"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("etc-mount");
  });

  // 19
  it("blocks docker socket mount", () => {
    const violations = validateVolumeMounts(["/var/run/docker.sock:/var/run/docker.sock"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("docker-socket");
  });

  // 20
  it("blocks /proc mount", () => {
    const violations = validateVolumeMounts(["/proc:/proc"]);
    expect(violations).toHaveLength(1);
    expect(violations[0].rule).toBe("proc-mount");
  });

  // 21
  it("allows safe mounts", () => {
    const violations = validateVolumeMounts(["/home/user/project:/workspace", "/tmp:/tmp"]);
    expect(violations).toHaveLength(0);
  });

  // 22
  it("detects multiple violations", () => {
    const violations = validateVolumeMounts([
      "/:/host",
      "/var/run/docker.sock:/var/run/docker.sock",
    ]);
    expect(violations.length).toBeGreaterThanOrEqual(2);
  });
});

// ============================================================================
// extractImageRegistry
// ============================================================================

describe("extractImageRegistry", () => {
  // 23
  it("returns docker.io for bare image name", () => {
    expect(extractImageRegistry("ubuntu")).toBe("docker.io");
  });

  // 24
  it("returns docker.io for library image", () => {
    expect(extractImageRegistry("library/ubuntu")).toBe("docker.io");
  });

  // 25
  it("extracts ghcr.io registry", () => {
    expect(extractImageRegistry("ghcr.io/owner/image:latest")).toBe("ghcr.io");
  });

  // 26
  it("extracts registry with port", () => {
    expect(extractImageRegistry("registry.example.com:5000/image")).toBe("registry.example.com");
  });

  // 27
  it("extracts gcr.io registry", () => {
    expect(extractImageRegistry("gcr.io/project/image")).toBe("gcr.io");
  });

  // 28
  it("handles image with digest", () => {
    expect(extractImageRegistry("ghcr.io/owner/image@sha256:abc123")).toBe("ghcr.io");
  });

  // 29
  it("returns docker.io for user/image pattern", () => {
    expect(extractImageRegistry("username/myimage")).toBe("docker.io");
  });
});

// ============================================================================
// validateImageRegistry
// ============================================================================

describe("validateImageRegistry", () => {
  // 30
  it("allows any image when registries list is empty", () => {
    expect(validateImageRegistry("evil.com/image", [])).toBeNull();
  });

  // 31
  it("allows image from allowed registry", () => {
    expect(validateImageRegistry("ghcr.io/owner/image", ["ghcr.io", "docker.io"])).toBeNull();
  });

  // 32
  it("blocks image from non-allowed registry", () => {
    const violation = validateImageRegistry("evil.com/image", ["docker.io"]);
    expect(violation).not.toBeNull();
    expect(violation!.rule).toBe("untrusted-registry");
    expect(violation!.severity).toBe("block");
  });

  // 33
  it("supports wildcard registry matching", () => {
    expect(validateImageRegistry("sub.example.com/image", ["*.example.com"])).toBeNull();
  });

  // 34
  it("allows bare image names against docker.io", () => {
    expect(validateImageRegistry("ubuntu:22.04", ["docker.io"])).toBeNull();
  });
});

// ============================================================================
// validateContainerSecurity (integration)
// ============================================================================

describe("validateContainerSecurity", () => {
  const baseConfig = { ...DEFAULT_CONTAINER_CONFIG, enabled: true };

  // 35
  it("returns no violations for safe config", () => {
    const violations = validateContainerSecurity(
      "echo hello",
      ["/project:/workspace"],
      "ubuntu:22.04",
      baseConfig,
    );
    expect(violations).toHaveLength(0);
  });

  // 36
  it("catches privileged flag in command", () => {
    const violations = validateContainerSecurity(
      "docker run --privileged ubuntu",
      [],
      "ubuntu:22.04",
      baseConfig,
    );
    expect(violations.some((v) => v.rule === "privileged-mode")).toBe(true);
  });

  // 37
  it("catches untrusted registry", () => {
    const violations = validateContainerSecurity("echo hello", [], "evil.com/backdoor", baseConfig);
    expect(violations.some((v) => v.rule === "untrusted-registry")).toBe(true);
  });

  // 38
  it("catches dangerous volume mount", () => {
    const violations = validateContainerSecurity(
      "echo hello",
      ["/:/rootfs"],
      "ubuntu:22.04",
      baseConfig,
    );
    expect(violations.some((v) => v.rule === "root-mount")).toBe(true);
  });
});

// ============================================================================
// hasBlockingViolation
// ============================================================================

describe("hasBlockingViolation", () => {
  // 39
  it("returns true for block violations", () => {
    expect(hasBlockingViolation([{ rule: "test", severity: "block", message: "bad" }])).toBe(true);
  });

  // 40
  it("returns false for warn-only violations", () => {
    expect(hasBlockingViolation([{ rule: "test", severity: "warn", message: "maybe" }])).toBe(
      false,
    );
  });

  // 41
  it("returns false for empty violations", () => {
    expect(hasBlockingViolation([])).toBe(false);
  });
});

// ============================================================================
// formatViolations
// ============================================================================

describe("formatViolations", () => {
  // 42
  it("formats empty violations", () => {
    expect(formatViolations([])).toContain("No security violations");
  });

  // 43
  it("formats block violations with BLOCK prefix", () => {
    const output = formatViolations([
      { rule: "privileged-mode", severity: "block", message: "test msg" },
    ]);
    expect(output).toContain("[BLOCK]");
    expect(output).toContain("privileged-mode");
    expect(output).toContain("test msg");
  });

  // 44
  it("formats warn violations with WARN prefix", () => {
    const output = formatViolations([
      { rule: "device-access", severity: "warn", message: "device" },
    ]);
    expect(output).toContain("[WARN]");
  });

  // 45
  it("includes detail when present", () => {
    const output = formatViolations([
      { rule: "test", severity: "block", message: "msg", detail: "some detail" },
    ]);
    expect(output).toContain("some detail");
  });
});

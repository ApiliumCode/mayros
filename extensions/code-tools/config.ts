/**
 * Code Tools Configuration
 *
 * Manual validation following the project's cortex-config pattern.
 * Uses assertAllowedKeys for unknown key rejection, no Zod.
 */

// ============================================================================
// Types
// ============================================================================

export type CodeToolsConfig = {
  workspaceRoot: string;
  maxFileSizeBytes: number;
  shellTimeout: number;
  maxGlobResults: number;
  maxGrepResults: number;
  shellEnabled: boolean;
};

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_WORKSPACE_ROOT = process.cwd();
const DEFAULT_MAX_FILE_SIZE_BYTES = 2_097_152; // 2 MB
const DEFAULT_SHELL_TIMEOUT = 120_000; // 2 minutes
const DEFAULT_MAX_GLOB_RESULTS = 200;
const DEFAULT_MAX_GREP_RESULTS = 50;
const DEFAULT_SHELL_ENABLED = true;

// ============================================================================
// Helpers
// ============================================================================

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length === 0) return;
  throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
}

function clampInt(raw: unknown, min: number, max: number, defaultVal: number): number {
  if (typeof raw !== "number") return defaultVal;
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

// ============================================================================
// Schema
// ============================================================================

const ALLOWED_KEYS = [
  "workspaceRoot",
  "maxFileSizeBytes",
  "shellTimeout",
  "maxGlobResults",
  "maxGrepResults",
  "shellEnabled",
];

export const codeToolsConfigSchema = {
  parse(value: unknown): CodeToolsConfig {
    const cfg = (value ?? {}) as Record<string, unknown>;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertAllowedKeys(cfg, ALLOWED_KEYS, "code tools config");
    }

    const workspaceRoot =
      typeof cfg.workspaceRoot === "string" && cfg.workspaceRoot.trim()
        ? cfg.workspaceRoot.trim()
        : DEFAULT_WORKSPACE_ROOT;

    const maxFileSizeBytes = clampInt(
      cfg.maxFileSizeBytes,
      1024,
      50_000_000,
      DEFAULT_MAX_FILE_SIZE_BYTES,
    );

    const shellTimeout = clampInt(cfg.shellTimeout, 1000, 600_000, DEFAULT_SHELL_TIMEOUT);

    const maxGlobResults = clampInt(cfg.maxGlobResults, 10, 5000, DEFAULT_MAX_GLOB_RESULTS);

    const maxGrepResults = clampInt(cfg.maxGrepResults, 1, 500, DEFAULT_MAX_GREP_RESULTS);

    const shellEnabled =
      typeof cfg.shellEnabled === "boolean" ? cfg.shellEnabled : DEFAULT_SHELL_ENABLED;

    return {
      workspaceRoot,
      maxFileSizeBytes,
      shellTimeout,
      maxGlobResults,
      maxGrepResults,
      shellEnabled,
    };
  },
  uiHints: {
    workspaceRoot: {
      label: "Workspace Root",
      placeholder: DEFAULT_WORKSPACE_ROOT,
      help: "Root directory for file operations. All paths are resolved relative to this.",
    },
    maxFileSizeBytes: {
      label: "Max File Size",
      placeholder: String(DEFAULT_MAX_FILE_SIZE_BYTES),
      help: "Maximum file size in bytes for read operations (1024-50000000)",
    },
    shellTimeout: {
      label: "Shell Timeout",
      placeholder: String(DEFAULT_SHELL_TIMEOUT),
      help: "Maximum execution time in milliseconds for shell commands (1000-600000)",
    },
    maxGlobResults: {
      label: "Max Glob Results",
      placeholder: String(DEFAULT_MAX_GLOB_RESULTS),
      help: "Maximum number of glob results returned (10-5000)",
    },
    maxGrepResults: {
      label: "Max Grep Results",
      placeholder: String(DEFAULT_MAX_GREP_RESULTS),
      help: "Maximum number of grep results returned (1-500)",
    },
    shellEnabled: {
      label: "Shell Enabled",
      help: "Whether shell command execution is allowed",
    },
  },
};

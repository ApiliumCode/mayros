/**
 * Remote Exec Configuration
 *
 * Manual validation following the project's cortex-config pattern.
 * Uses assertAllowedKeys for unknown key rejection, no Zod.
 */

import os from "node:os";
import { assertAllowedKeys } from "../shared/cortex-config.js";
import type { RiskLevel } from "../interactive-permissions/intent-classifier.js";

// ============================================================================
// Types
// ============================================================================

export type RemoteExecRateLimits = {
  maxCallsPerWindow: number;
  windowMs: number;
};

export type ConfirmationConfig = {
  autoApproveMaxRisk: RiskLevel;
  approvalTtlMs: number;
  maxPending: number;
  showRiskLevel: boolean;
};

export type RemoteExecConfig = {
  enabled: boolean;
  allowedPaths: string[];
  commandTimeout: number;
  maxOutputBytes: number;
  auditLogPath: string;
  rateLimits: RemoteExecRateLimits;
  confirmation: ConfirmationConfig;
};

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_ENABLED = false;
const DEFAULT_COMMAND_TIMEOUT = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 100_000;
const DEFAULT_AUDIT_LOG_PATH = "~/.mayros/remote-exec-audit.jsonl";
const DEFAULT_RATE_LIMITS: RemoteExecRateLimits = {
  maxCallsPerWindow: 10,
  windowMs: 60_000,
};

const DEFAULT_CONFIRMATION: ConfirmationConfig = {
  autoApproveMaxRisk: "safe",
  approvalTtlMs: 120_000,
  maxPending: 10,
  showRiskLevel: true,
};

const VALID_RISK_LEVELS: RiskLevel[] = ["safe", "low", "medium", "high", "critical"];

const MIN_COMMAND_TIMEOUT = 1_000;
const MAX_COMMAND_TIMEOUT = 120_000;
const MIN_MAX_OUTPUT_BYTES = 1_024;
const MAX_MAX_OUTPUT_BYTES = 1_000_000;

// ============================================================================
// Helpers
// ============================================================================

function clampInt(raw: unknown, min: number, max: number, defaultVal: number): number {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return defaultVal;
  if (raw < 0) {
    throw new Error(`Value must be non-negative, got ${raw}`);
  }
  return Math.max(min, Math.min(max, Math.floor(raw)));
}

function parseRateLimits(raw: unknown): RemoteExecRateLimits {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_RATE_LIMITS };
  }
  const obj = raw as Record<string, unknown>;
  assertAllowedKeys(obj, ["maxCallsPerWindow", "windowMs"], "rateLimits");

  const maxCallsPerWindow =
    typeof obj.maxCallsPerWindow === "number" &&
    Number.isFinite(obj.maxCallsPerWindow) &&
    obj.maxCallsPerWindow > 0
      ? Math.floor(obj.maxCallsPerWindow)
      : DEFAULT_RATE_LIMITS.maxCallsPerWindow;

  const windowMs =
    typeof obj.windowMs === "number" && Number.isFinite(obj.windowMs) && obj.windowMs > 0
      ? Math.floor(obj.windowMs)
      : DEFAULT_RATE_LIMITS.windowMs;

  return { maxCallsPerWindow, windowMs };
}

function parseConfirmation(raw: unknown): ConfirmationConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_CONFIRMATION };
  }
  const obj = raw as Record<string, unknown>;
  assertAllowedKeys(
    obj,
    ["autoApproveMaxRisk", "approvalTtlMs", "maxPending", "showRiskLevel"],
    "confirmation",
  );

  const autoApproveMaxRisk =
    typeof obj.autoApproveMaxRisk === "string" &&
    VALID_RISK_LEVELS.includes(obj.autoApproveMaxRisk as RiskLevel)
      ? (obj.autoApproveMaxRisk as RiskLevel)
      : DEFAULT_CONFIRMATION.autoApproveMaxRisk;

  const approvalTtlMs = clampInt(
    obj.approvalTtlMs,
    10_000,
    600_000,
    DEFAULT_CONFIRMATION.approvalTtlMs,
  );

  const maxPending = clampInt(obj.maxPending, 1, 100, DEFAULT_CONFIRMATION.maxPending);

  const showRiskLevel =
    typeof obj.showRiskLevel === "boolean" ? obj.showRiskLevel : DEFAULT_CONFIRMATION.showRiskLevel;

  return { autoApproveMaxRisk, approvalTtlMs, maxPending, showRiskLevel };
}

// ============================================================================
// Schema
// ============================================================================

const ALLOWED_KEYS = [
  "enabled",
  "allowedPaths",
  "commandTimeout",
  "maxOutputBytes",
  "auditLogPath",
  "rateLimits",
  "confirmation",
];

export const remoteExecConfigSchema = {
  parse(value: unknown): RemoteExecConfig {
    if (value === null || value === undefined) {
      return {
        enabled: DEFAULT_ENABLED,
        allowedPaths: [],
        commandTimeout: DEFAULT_COMMAND_TIMEOUT,
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
        auditLogPath: DEFAULT_AUDIT_LOG_PATH.replace(/^~/, os.homedir()),
        rateLimits: { ...DEFAULT_RATE_LIMITS },
        confirmation: { ...DEFAULT_CONFIRMATION },
      };
    }

    if (typeof value !== "object" || Array.isArray(value)) {
      return {
        enabled: DEFAULT_ENABLED,
        allowedPaths: [],
        commandTimeout: DEFAULT_COMMAND_TIMEOUT,
        maxOutputBytes: DEFAULT_MAX_OUTPUT_BYTES,
        auditLogPath: DEFAULT_AUDIT_LOG_PATH.replace(/^~/, os.homedir()),
        rateLimits: { ...DEFAULT_RATE_LIMITS },
        confirmation: { ...DEFAULT_CONFIRMATION },
      };
    }

    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(cfg, ALLOWED_KEYS, "remote-exec config");

    const enabled = cfg.enabled === true;

    // Parse allowedPaths
    const allowedPaths: string[] = [];
    if (Array.isArray(cfg.allowedPaths)) {
      for (const item of cfg.allowedPaths) {
        if (typeof item !== "string" || !item.trim()) {
          throw new Error("allowedPaths entries must be non-empty strings");
        }
        allowedPaths.push(item.trim());
      }
    }

    // Enforce: enabled requires allowedPaths
    if (enabled && allowedPaths.length === 0) {
      throw new Error("remote-exec: allowedPaths is required when enabled is true");
    }

    // Parse numeric fields — NaN/Infinity rejected via clampInt
    if (
      cfg.commandTimeout !== undefined &&
      (typeof cfg.commandTimeout !== "number" || !Number.isFinite(cfg.commandTimeout))
    ) {
      throw new Error("commandTimeout must be a finite number");
    }
    if (
      cfg.maxOutputBytes !== undefined &&
      (typeof cfg.maxOutputBytes !== "number" || !Number.isFinite(cfg.maxOutputBytes))
    ) {
      throw new Error("maxOutputBytes must be a finite number");
    }

    const commandTimeout = clampInt(
      cfg.commandTimeout,
      MIN_COMMAND_TIMEOUT,
      MAX_COMMAND_TIMEOUT,
      DEFAULT_COMMAND_TIMEOUT,
    );
    const maxOutputBytes = clampInt(
      cfg.maxOutputBytes,
      MIN_MAX_OUTPUT_BYTES,
      MAX_MAX_OUTPUT_BYTES,
      DEFAULT_MAX_OUTPUT_BYTES,
    );

    const auditLogPath =
      typeof cfg.auditLogPath === "string" && cfg.auditLogPath.trim()
        ? cfg.auditLogPath.trim().replace(/^~/, os.homedir())
        : DEFAULT_AUDIT_LOG_PATH.replace(/^~/, os.homedir());

    const rateLimits = parseRateLimits(cfg.rateLimits);
    const confirmation = parseConfirmation(cfg.confirmation);

    return {
      enabled,
      allowedPaths,
      commandTimeout,
      maxOutputBytes,
      auditLogPath,
      rateLimits,
      confirmation,
    };
  },
  uiHints: {
    enabled: {
      label: "Enable Remote Exec",
      help: "Enable remote command execution (opt-in, default: false)",
    },
    allowedPaths: {
      label: "Allowed Paths",
      help: "Directories where commands may execute. Required when enabled.",
    },
    commandTimeout: {
      label: "Command Timeout (ms)",
      placeholder: String(DEFAULT_COMMAND_TIMEOUT),
      help: `Timeout for command execution (${MIN_COMMAND_TIMEOUT}-${MAX_COMMAND_TIMEOUT}ms)`,
    },
    maxOutputBytes: {
      label: "Max Output Bytes",
      placeholder: String(DEFAULT_MAX_OUTPUT_BYTES),
      advanced: true,
      help: `Maximum output size in bytes (${MIN_MAX_OUTPUT_BYTES}-${MAX_MAX_OUTPUT_BYTES})`,
    },
    auditLogPath: {
      label: "Audit Log Path",
      placeholder: DEFAULT_AUDIT_LOG_PATH,
      advanced: true,
      help: "Path for the JSONL audit log",
    },
    rateLimits: {
      label: "Rate Limits",
      advanced: true,
      help: "Sliding window rate limit for all remote-exec tools",
    },
    confirmation: {
      label: "Confirmation UX",
      advanced: true,
      help: "Controls /run command approval thresholds and pending request limits",
    },
  },
};

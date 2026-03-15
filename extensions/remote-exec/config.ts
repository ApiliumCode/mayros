/**
 * Remote Exec Configuration
 *
 * Manual validation following the project's cortex-config pattern.
 * Uses assertAllowedKeys for unknown key rejection, no Zod.
 */

import os from "node:os";
import { assertAllowedKeys } from "../shared/cortex-config.js";
import type { RiskLevel } from "../interactive-permissions/intent-classifier.js";
import type { PinConfig } from "./pin-auth.js";

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

export type SessionConfig = {
  sessionTtlMs: number;
  outputPageSize: number;
  outputCacheTtlMs: number;
  maxHistorySize: number;
  maxEnvVars: number;
  maxAliases: number;
};

export type RemoteExecConfig = {
  enabled: boolean;
  allowedPaths: string[];
  commandTimeout: number;
  maxOutputBytes: number;
  auditLogPath: string;
  rateLimits: RemoteExecRateLimits;
  confirmation: ConfirmationConfig;
  session: SessionConfig;
  maskOutput: boolean;
  blockedPatterns: RegExp[];
  pin: PinConfig;
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

const DEFAULT_SESSION: SessionConfig = {
  sessionTtlMs: 1_800_000,
  outputPageSize: 3_500,
  outputCacheTtlMs: 300_000,
  maxHistorySize: 20,
  maxEnvVars: 20,
  maxAliases: 10,
};

const MIN_MAX_HISTORY_SIZE = 1;
const MAX_MAX_HISTORY_SIZE = 100;

const MIN_MAX_ENV_VARS = 1;
const MAX_MAX_ENV_VARS = 50;

const MIN_MAX_ALIASES = 1;
const MAX_MAX_ALIASES = 50;

const DEFAULT_MASK_OUTPUT = true;
const DEFAULT_BLOCKED_PATTERNS: RegExp[] = [];

const DEFAULT_PIN: PinConfig = {
  pinHash: null,
  pinLockoutMs: 300_000,
  pinMaxAttempts: 3,
  pinAutoLockMs: 300_000,
};

const MIN_PIN_LOCKOUT_MS = 60_000;
const MAX_PIN_LOCKOUT_MS = 900_000;
const MIN_PIN_MAX_ATTEMPTS = 1;
const MAX_PIN_MAX_ATTEMPTS = 10;
const MIN_PIN_AUTO_LOCK_MS = 60_000;
const MAX_PIN_AUTO_LOCK_MS = 3_600_000;
const PIN_HASH_PATTERN = /^scrypt:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/;

const MIN_SESSION_TTL = 60_000;
const MAX_SESSION_TTL = 86_400_000;
const MIN_OUTPUT_PAGE_SIZE = 500;
const MAX_OUTPUT_PAGE_SIZE = 10_000;
const MIN_OUTPUT_CACHE_TTL = 30_000;
const MAX_OUTPUT_CACHE_TTL = 3_600_000;

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

function parseSession(raw: unknown): SessionConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_SESSION };
  }
  const obj = raw as Record<string, unknown>;
  assertAllowedKeys(
    obj,
    [
      "sessionTtlMs",
      "outputPageSize",
      "outputCacheTtlMs",
      "maxHistorySize",
      "maxEnvVars",
      "maxAliases",
    ],
    "session",
  );

  const sessionTtlMs = clampInt(
    obj.sessionTtlMs,
    MIN_SESSION_TTL,
    MAX_SESSION_TTL,
    DEFAULT_SESSION.sessionTtlMs,
  );
  const outputPageSize = clampInt(
    obj.outputPageSize,
    MIN_OUTPUT_PAGE_SIZE,
    MAX_OUTPUT_PAGE_SIZE,
    DEFAULT_SESSION.outputPageSize,
  );
  const outputCacheTtlMs = clampInt(
    obj.outputCacheTtlMs,
    MIN_OUTPUT_CACHE_TTL,
    MAX_OUTPUT_CACHE_TTL,
    DEFAULT_SESSION.outputCacheTtlMs,
  );

  const maxHistorySize = clampInt(
    obj.maxHistorySize,
    MIN_MAX_HISTORY_SIZE,
    MAX_MAX_HISTORY_SIZE,
    DEFAULT_SESSION.maxHistorySize,
  );
  const maxEnvVars = clampInt(
    obj.maxEnvVars,
    MIN_MAX_ENV_VARS,
    MAX_MAX_ENV_VARS,
    DEFAULT_SESSION.maxEnvVars,
  );
  const maxAliases = clampInt(
    obj.maxAliases,
    MIN_MAX_ALIASES,
    MAX_MAX_ALIASES,
    DEFAULT_SESSION.maxAliases,
  );

  return { sessionTtlMs, outputPageSize, outputCacheTtlMs, maxHistorySize, maxEnvVars, maxAliases };
}

const MAX_BLOCKED_PATTERN_LENGTH = 200;
const MAX_BLOCKED_PATTERNS_COUNT = 50;

function parseBlockedPatterns(raw: unknown): RegExp[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new Error("blockedPatterns must be an array of regex strings");
  }
  if (raw.length > MAX_BLOCKED_PATTERNS_COUNT) {
    throw new Error(`blockedPatterns exceeds max count (${MAX_BLOCKED_PATTERNS_COUNT})`);
  }
  const patterns: RegExp[] = [];
  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== "string" || !item.trim()) {
      throw new Error(`blockedPatterns[${i}] must be a non-empty string`);
    }
    const trimmed = item.trim();
    if (trimmed.length > MAX_BLOCKED_PATTERN_LENGTH) {
      throw new Error(
        `blockedPatterns[${i}] exceeds max length (${MAX_BLOCKED_PATTERN_LENGTH} chars)`,
      );
    }
    try {
      patterns.push(new RegExp(trimmed));
    } catch {
      throw new Error(`blockedPatterns[${i}] is not a valid regex: ${item}`);
    }
  }
  return patterns;
}

function parsePin(raw: unknown): PinConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ...DEFAULT_PIN };
  }
  const obj = raw as Record<string, unknown>;
  assertAllowedKeys(obj, ["pinHash", "pinLockoutMs", "pinMaxAttempts", "pinAutoLockMs"], "pin");

  let pinHash: string | null = null;
  if (obj.pinHash !== undefined && obj.pinHash !== null) {
    if (typeof obj.pinHash !== "string") {
      throw new Error("pin.pinHash must be a string or null");
    }
    if (!PIN_HASH_PATTERN.test(obj.pinHash)) {
      throw new Error("pin.pinHash must match format: scrypt:<base64salt>:<base64hash>");
    }
    pinHash = obj.pinHash;
  }

  const pinLockoutMs = clampInt(
    obj.pinLockoutMs,
    MIN_PIN_LOCKOUT_MS,
    MAX_PIN_LOCKOUT_MS,
    DEFAULT_PIN.pinLockoutMs,
  );
  const pinMaxAttempts = clampInt(
    obj.pinMaxAttempts,
    MIN_PIN_MAX_ATTEMPTS,
    MAX_PIN_MAX_ATTEMPTS,
    DEFAULT_PIN.pinMaxAttempts,
  );
  const pinAutoLockMs = clampInt(
    obj.pinAutoLockMs,
    MIN_PIN_AUTO_LOCK_MS,
    MAX_PIN_AUTO_LOCK_MS,
    DEFAULT_PIN.pinAutoLockMs,
  );

  return { pinHash, pinLockoutMs, pinMaxAttempts, pinAutoLockMs };
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
  "session",
  "maskOutput",
  "blockedPatterns",
  "pin",
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
        session: { ...DEFAULT_SESSION },
        maskOutput: DEFAULT_MASK_OUTPUT,
        blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
        pin: { ...DEFAULT_PIN },
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
        session: { ...DEFAULT_SESSION },
        maskOutput: DEFAULT_MASK_OUTPUT,
        blockedPatterns: DEFAULT_BLOCKED_PATTERNS,
        pin: { ...DEFAULT_PIN },
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
    const session = parseSession(cfg.session);

    const maskOutput = typeof cfg.maskOutput === "boolean" ? cfg.maskOutput : DEFAULT_MASK_OUTPUT;
    const blockedPatterns = parseBlockedPatterns(cfg.blockedPatterns);
    const pin = parsePin(cfg.pin);

    return {
      enabled,
      allowedPaths,
      commandTimeout,
      maxOutputBytes,
      auditLogPath,
      rateLimits,
      confirmation,
      session,
      maskOutput,
      blockedPatterns,
      pin,
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
    session: {
      label: "Session Management",
      advanced: true,
      help: "Controls per-sender session state (workdir persistence, output paging)",
    },
    maskOutput: {
      label: "Mask Output",
      help: "Redact secrets (API keys, tokens, passwords) from /run output (default: true)",
    },
    blockedPatterns: {
      label: "Blocked Patterns",
      help: "Array of regex strings. Commands matching any pattern are always rejected.",
    },
  },
};

import { assertAllowedKeys } from "../shared/cortex-config.js";

export type OsameruMode = "enforce" | "warn" | "audit-only" | "off";

export type OsameruConfig = {
  mode: OsameruMode;
  policyPaths: string[];
  auditLogPath: string;
  hmacSecret?: string;
  trustTiers: {
    enabled: boolean;
    promotionThreshold: number;
    demotionThreshold: number;
  };
};

const DEFAULTS: OsameruConfig = {
  mode: "warn",
  policyPaths: ["MAYROS.md"],
  auditLogPath: "~/.mayros/governance-audit.jsonl",
  trustTiers: {
    enabled: true,
    promotionThreshold: 0.8,
    demotionThreshold: 0.3,
  },
};

export function parseOsameruConfig(raw: unknown): OsameruConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
  const cfg = raw as Record<string, unknown>;
  assertAllowedKeys(
    cfg,
    ["mode", "policyPaths", "auditLogPath", "hmacSecret", "trustTiers"],
    "osameru config",
  );

  const validModes: OsameruMode[] = ["enforce", "warn", "audit-only", "off"];
  const mode =
    typeof cfg.mode === "string" && validModes.includes(cfg.mode as OsameruMode)
      ? (cfg.mode as OsameruMode)
      : DEFAULTS.mode;

  const policyPaths = Array.isArray(cfg.policyPaths)
    ? cfg.policyPaths.filter((p): p is string => typeof p === "string")
    : DEFAULTS.policyPaths;

  const auditLogPath =
    typeof cfg.auditLogPath === "string" ? cfg.auditLogPath : DEFAULTS.auditLogPath;
  const hmacSecret = typeof cfg.hmacSecret === "string" ? cfg.hmacSecret : undefined;

  let trustTiers = { ...DEFAULTS.trustTiers };
  if (cfg.trustTiers && typeof cfg.trustTiers === "object" && !Array.isArray(cfg.trustTiers)) {
    const t = cfg.trustTiers as Record<string, unknown>;
    trustTiers = {
      enabled: typeof t.enabled === "boolean" ? t.enabled : DEFAULTS.trustTiers.enabled,
      promotionThreshold:
        typeof t.promotionThreshold === "number"
          ? t.promotionThreshold
          : DEFAULTS.trustTiers.promotionThreshold,
      demotionThreshold:
        typeof t.demotionThreshold === "number"
          ? t.demotionThreshold
          : DEFAULTS.trustTiers.demotionThreshold,
    };
  }

  return { mode, policyPaths, auditLogPath, hmacSecret, trustTiers };
}

export const osameruConfigSchema = {
  parse: parseOsameruConfig,
  uiHints: {
    mode: {
      label: "Governance Mode",
      help: "enforce=block violations, warn=log only, audit-only=record, off=disabled",
    },
    policyPaths: { label: "Policy Files", placeholder: "MAYROS.md" },
    auditLogPath: {
      label: "Audit Log Path",
      placeholder: "~/.mayros/governance-audit.jsonl",
      advanced: true,
    },
    hmacSecret: { label: "HMAC Secret", sensitive: true, advanced: true },
  },
};

import { assertAllowedKeys } from "../shared/cortex-config.js";

export type HayameruConfig = {
  enabled: boolean;
  confidenceThreshold: number;
  maxFileSize: number;
  transforms: Record<string, boolean>;
  metrics: { enabled: boolean };
};

const DEFAULTS: HayameruConfig = {
  enabled: true,
  confidenceThreshold: 0.85,
  maxFileSize: 100_000,
  transforms: {
    "var-to-const": true,
    "remove-console": true,
    "sort-imports": true,
    "add-semicolons": true,
    "remove-comments": true,
  },
  metrics: { enabled: true },
};

export function parseHayameruConfig(raw: unknown): HayameruConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
  const cfg = raw as Record<string, unknown>;
  assertAllowedKeys(
    cfg,
    ["enabled", "confidenceThreshold", "maxFileSize", "transforms", "metrics"],
    "hayameru config",
  );

  const enabled = typeof cfg.enabled === "boolean" ? cfg.enabled : DEFAULTS.enabled;
  const confidenceThreshold =
    typeof cfg.confidenceThreshold === "number" &&
    cfg.confidenceThreshold > 0 &&
    cfg.confidenceThreshold <= 1
      ? cfg.confidenceThreshold
      : DEFAULTS.confidenceThreshold;
  const maxFileSize =
    typeof cfg.maxFileSize === "number" && cfg.maxFileSize > 0
      ? Math.floor(cfg.maxFileSize)
      : DEFAULTS.maxFileSize;

  let transforms = { ...DEFAULTS.transforms };
  if (cfg.transforms && typeof cfg.transforms === "object" && !Array.isArray(cfg.transforms)) {
    const raw = cfg.transforms as Record<string, unknown>;
    for (const [k, v] of Object.entries(raw)) {
      if (typeof v === "boolean") transforms[k] = v;
    }
  }

  let metricsEnabled = DEFAULTS.metrics.enabled;
  if (cfg.metrics && typeof cfg.metrics === "object" && !Array.isArray(cfg.metrics)) {
    const m = cfg.metrics as Record<string, unknown>;
    if (typeof m.enabled === "boolean") metricsEnabled = m.enabled;
  }

  return {
    enabled,
    confidenceThreshold,
    maxFileSize,
    transforms,
    metrics: { enabled: metricsEnabled },
  };
}

export const hayameruConfigSchema = {
  parse: parseHayameruConfig,
  uiHints: {
    enabled: {
      label: "Enable Hayameru",
      help: "Enable deterministic code transforms that bypass LLM",
    },
    confidenceThreshold: { label: "Confidence Threshold", placeholder: "0.85", advanced: true },
    maxFileSize: { label: "Max File Size (bytes)", placeholder: "100000", advanced: true },
  },
};

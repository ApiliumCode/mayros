import { assertAllowedKeys } from "../shared/cortex-config.js";

export type KakeruConfig = {
  enabled: boolean;
  codex: {
    enabled: boolean;
    binaryPath: string;
    apiKeyEnv: string;
    defaultTimeout: number;
  };
  branchPrefix: string;
  autoMerge: boolean;
};

const DEFAULTS: KakeruConfig = {
  enabled: false,
  codex: {
    enabled: false,
    binaryPath: "codex",
    apiKeyEnv: "OPENAI_API_KEY",
    defaultTimeout: 300_000,
  },
  branchPrefix: "kakeru",
  autoMerge: false,
};

export function parseKakeruConfig(raw: unknown): KakeruConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULTS };
  const cfg = raw as Record<string, unknown>;
  assertAllowedKeys(cfg, ["enabled", "codex", "branchPrefix", "autoMerge"], "kakeru config");

  const enabled = cfg.enabled === true;
  const branchPrefix =
    typeof cfg.branchPrefix === "string" ? cfg.branchPrefix : DEFAULTS.branchPrefix;
  const autoMerge = cfg.autoMerge === true;

  let codex = { ...DEFAULTS.codex };
  if (cfg.codex && typeof cfg.codex === "object" && !Array.isArray(cfg.codex)) {
    const c = cfg.codex as Record<string, unknown>;
    codex = {
      enabled: c.enabled === true,
      binaryPath: typeof c.binaryPath === "string" ? c.binaryPath : DEFAULTS.codex.binaryPath,
      apiKeyEnv: typeof c.apiKeyEnv === "string" ? c.apiKeyEnv : DEFAULTS.codex.apiKeyEnv,
      defaultTimeout:
        typeof c.defaultTimeout === "number" ? c.defaultTimeout : DEFAULTS.codex.defaultTimeout,
    };
  }

  return { enabled, codex, branchPrefix, autoMerge };
}

export const kakeruConfigSchema = {
  parse: parseKakeruConfig,
  uiHints: {
    enabled: { label: "Enable Kakeru", help: "Enable dual-platform coordination (opt-in)" },
    "codex.enabled": { label: "Enable Codex Bridge", help: "Enable OpenAI Codex CLI bridge" },
    "codex.binaryPath": { label: "Codex Binary Path", placeholder: "codex", advanced: true },
    branchPrefix: { label: "Branch Prefix", placeholder: "kakeru", advanced: true },
    autoMerge: { label: "Auto-Merge", help: "Automatically merge platform results" },
  },
};

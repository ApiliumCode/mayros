export type TokenBudgetCacheConfig = {
  enabled: boolean;
  maxEntries: number;
  ttlMs: number;
};

export type TokenBudgetConfig = {
  sessionLimitUsd?: number;
  dailyLimitUsd?: number;
  monthlyLimitUsd?: number;
  warnThreshold: number;
  persistPath: string;
  cache: TokenBudgetCacheConfig;
  enforcement: "soft" | "hard";
  gracePeriodCalls: number;
};

const DEFAULT_WARN_THRESHOLD = 0.8;
const DEFAULT_PERSIST_PATH = "~/.mayros/token-budget.json";
const DEFAULT_CACHE_MAX_ENTRIES = 256;
const DEFAULT_CACHE_TTL_MS = 300_000;

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

function parseCacheConfig(raw: unknown): TokenBudgetCacheConfig {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { enabled: true, maxEntries: DEFAULT_CACHE_MAX_ENTRIES, ttlMs: DEFAULT_CACHE_TTL_MS };
  }
  const c = raw as Record<string, unknown>;
  assertAllowedKeys(c, ["enabled", "maxEntries", "ttlMs"], "cache config");
  return {
    enabled: c.enabled !== false,
    maxEntries:
      typeof c.maxEntries === "number" && c.maxEntries > 0
        ? Math.floor(c.maxEntries)
        : DEFAULT_CACHE_MAX_ENTRIES,
    ttlMs: typeof c.ttlMs === "number" && c.ttlMs > 0 ? Math.floor(c.ttlMs) : DEFAULT_CACHE_TTL_MS,
  };
}

export function parseTokenBudgetConfig(value: unknown): TokenBudgetConfig {
  const cfg = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<
    string,
    unknown
  >;

  assertAllowedKeys(
    cfg,
    [
      "sessionLimitUsd",
      "dailyLimitUsd",
      "monthlyLimitUsd",
      "warnThreshold",
      "persistPath",
      "cache",
      "enforcement",
      "gracePeriodCalls",
    ],
    "token-economy config",
  );

  const warnThreshold =
    typeof cfg.warnThreshold === "number" && cfg.warnThreshold > 0 && cfg.warnThreshold <= 1
      ? cfg.warnThreshold
      : DEFAULT_WARN_THRESHOLD;

  const persistPath =
    typeof cfg.persistPath === "string" && cfg.persistPath.length > 0
      ? cfg.persistPath
      : DEFAULT_PERSIST_PATH;

  const enforcement = cfg.enforcement === "hard" ? ("hard" as const) : ("soft" as const);

  const gracePeriodCalls =
    typeof cfg.gracePeriodCalls === "number" && cfg.gracePeriodCalls >= 0
      ? Math.floor(cfg.gracePeriodCalls)
      : 3;

  return {
    sessionLimitUsd:
      typeof cfg.sessionLimitUsd === "number" && cfg.sessionLimitUsd > 0
        ? cfg.sessionLimitUsd
        : undefined,
    dailyLimitUsd:
      typeof cfg.dailyLimitUsd === "number" && cfg.dailyLimitUsd > 0
        ? cfg.dailyLimitUsd
        : undefined,
    monthlyLimitUsd:
      typeof cfg.monthlyLimitUsd === "number" && cfg.monthlyLimitUsd > 0
        ? cfg.monthlyLimitUsd
        : undefined,
    warnThreshold,
    persistPath,
    cache: parseCacheConfig(cfg.cache),
    enforcement,
    gracePeriodCalls,
  };
}

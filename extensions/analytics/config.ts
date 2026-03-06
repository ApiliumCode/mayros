/**
 * Analytics Configuration — privacy controls and parsing.
 */

export type AnalyticsConfig = {
  /** Enable analytics collection (default: false — opt-in). */
  enabled: boolean;
  /** Privacy mode: "anonymous" hashes IDs, "off" disables collection (default: "anonymous"). */
  privacyMode: "anonymous" | "identified" | "off";
  /** Max events in buffer (default: 500). */
  maxBufferSize: number;
  /** Flush interval in ms (default: 30_000). */
  flushIntervalMs: number;
  /** Event TTL in ms (default: 3_600_000). */
  eventTtlMs: number;
};

const ALLOWED_KEYS = ["enabled", "privacyMode", "maxBufferSize", "flushIntervalMs", "eventTtlMs"];

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

export function parseAnalyticsConfig(value: unknown): AnalyticsConfig {
  const cfg = (value && typeof value === "object" && !Array.isArray(value) ? value : {}) as Record<
    string,
    unknown
  >;

  assertAllowedKeys(cfg, ALLOWED_KEYS, "analytics config");

  // Respect environment variable override
  if (process.env.MAYROS_ANALYTICS_DISABLED === "1") {
    return {
      enabled: false,
      privacyMode: "off",
      maxBufferSize: 500,
      flushIntervalMs: 30_000,
      eventTtlMs: 3_600_000,
    };
  }

  const privacyMode = ((): "anonymous" | "identified" | "off" => {
    if (cfg.privacyMode === "identified") return "identified";
    if (cfg.privacyMode === "off") return "off";
    return "anonymous";
  })();

  return {
    enabled: cfg.enabled === true,
    privacyMode,
    maxBufferSize:
      typeof cfg.maxBufferSize === "number" && cfg.maxBufferSize > 0
        ? Math.min(Math.floor(cfg.maxBufferSize), 10_000)
        : 500,
    flushIntervalMs:
      typeof cfg.flushIntervalMs === "number" && cfg.flushIntervalMs >= 1000
        ? Math.floor(cfg.flushIntervalMs)
        : 30_000,
    eventTtlMs:
      typeof cfg.eventTtlMs === "number" && cfg.eventTtlMs >= 60_000
        ? Math.floor(cfg.eventTtlMs)
        : 3_600_000,
  };
}

/** Check if analytics is enabled via config or environment. */
export function isAnalyticsEnabled(config: AnalyticsConfig): boolean {
  return config.enabled && config.privacyMode !== "off";
}

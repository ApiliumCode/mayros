/**
 * Tomeru Guard Configuration
 *
 * Rate limiting and loop breaking configuration.
 */

export type TomeruConfig = {
  mode: "enforce" | "warn" | "off";
  defaultLimit: {
    maxCallsPerWindow: number;
    windowMs: number;
  };
  burstLimit: {
    maxCallsPerSecond: number;
  };
  perToolLimits: Record<string, { maxCallsPerWindow: number; windowMs: number }>;
  loopBreaker: {
    enabled: boolean;
    maxIdenticalCalls: number;
    maxTotalCallsPerMinute: number;
  };
  exemptTools: string[];
};

const DEFAULT_MAX_CALLS_PER_WINDOW = 60;
const DEFAULT_WINDOW_MS = 60_000;
const DEFAULT_MAX_CALLS_PER_SECOND = 10;
const DEFAULT_MAX_IDENTICAL_CALLS = 15;
const DEFAULT_MAX_TOTAL_CALLS_PER_MINUTE = 120;

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], label: string) {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new Error(`${label} has unknown keys: ${unknown.join(", ")}`);
  }
}

export function parseTomeruConfig(raw: unknown): TomeruConfig {
  const cfg = (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<
    string,
    unknown
  >;

  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      cfg,
      ["mode", "defaultLimit", "burstLimit", "perToolLimits", "loopBreaker", "exemptTools"],
      "tomeru-guard config",
    );
  }

  const validModes = ["enforce", "warn", "off"];
  const mode =
    typeof cfg.mode === "string" && validModes.includes(cfg.mode)
      ? (cfg.mode as "enforce" | "warn" | "off")
      : ("enforce" as const);

  // defaultLimit
  const dlRaw = (cfg.defaultLimit ?? {}) as Record<string, unknown>;
  const defaultLimit = {
    maxCallsPerWindow:
      typeof dlRaw.maxCallsPerWindow === "number" && dlRaw.maxCallsPerWindow > 0
        ? Math.floor(dlRaw.maxCallsPerWindow)
        : DEFAULT_MAX_CALLS_PER_WINDOW,
    windowMs:
      typeof dlRaw.windowMs === "number" && dlRaw.windowMs > 0
        ? Math.floor(dlRaw.windowMs)
        : DEFAULT_WINDOW_MS,
  };

  // burstLimit
  const blRaw = (cfg.burstLimit ?? {}) as Record<string, unknown>;
  const burstLimit = {
    maxCallsPerSecond:
      typeof blRaw.maxCallsPerSecond === "number" && blRaw.maxCallsPerSecond > 0
        ? blRaw.maxCallsPerSecond
        : DEFAULT_MAX_CALLS_PER_SECOND,
  };

  // perToolLimits
  const ptRaw = (cfg.perToolLimits ?? {}) as Record<string, unknown>;
  const perToolLimits: Record<string, { maxCallsPerWindow: number; windowMs: number }> = {};
  for (const [tool, limitRaw] of Object.entries(ptRaw)) {
    if (limitRaw && typeof limitRaw === "object" && !Array.isArray(limitRaw)) {
      const lr = limitRaw as Record<string, unknown>;
      perToolLimits[tool] = {
        maxCallsPerWindow:
          typeof lr.maxCallsPerWindow === "number" && lr.maxCallsPerWindow > 0
            ? Math.floor(lr.maxCallsPerWindow)
            : defaultLimit.maxCallsPerWindow,
        windowMs:
          typeof lr.windowMs === "number" && lr.windowMs > 0
            ? Math.floor(lr.windowMs)
            : defaultLimit.windowMs,
      };
    }
  }

  // loopBreaker
  const lbRaw = (cfg.loopBreaker ?? {}) as Record<string, unknown>;
  const loopBreaker = {
    enabled: lbRaw.enabled !== false,
    maxIdenticalCalls:
      typeof lbRaw.maxIdenticalCalls === "number" && lbRaw.maxIdenticalCalls > 0
        ? Math.floor(lbRaw.maxIdenticalCalls)
        : DEFAULT_MAX_IDENTICAL_CALLS,
    maxTotalCallsPerMinute:
      typeof lbRaw.maxTotalCallsPerMinute === "number" && lbRaw.maxTotalCallsPerMinute > 0
        ? Math.floor(lbRaw.maxTotalCallsPerMinute)
        : DEFAULT_MAX_TOTAL_CALLS_PER_MINUTE,
  };

  // exemptTools
  const exemptTools = Array.isArray(cfg.exemptTools)
    ? (cfg.exemptTools as unknown[]).filter((t): t is string => typeof t === "string")
    : [];

  return { mode, defaultLimit, burstLimit, perToolLimits, loopBreaker, exemptTools };
}

export const tomeruConfigSchema = {
  parse: (value: unknown) => parseTomeruConfig(value),
  uiHints: {
    mode: {
      label: "Enforcement Mode",
      placeholder: "enforce",
      help: "enforce = block excessive calls, warn = log only, off = disabled",
    },
    "defaultLimit.maxCallsPerWindow": {
      label: "Max Calls Per Window",
      placeholder: String(DEFAULT_MAX_CALLS_PER_WINDOW),
      advanced: true,
    },
    "defaultLimit.windowMs": {
      label: "Window Duration (ms)",
      placeholder: String(DEFAULT_WINDOW_MS),
      advanced: true,
    },
    "burstLimit.maxCallsPerSecond": {
      label: "Max Calls Per Second (burst)",
      placeholder: String(DEFAULT_MAX_CALLS_PER_SECOND),
      advanced: true,
    },
    "loopBreaker.enabled": {
      label: "Loop Breaker",
      help: "Detect and break infinite tool call loops",
    },
    "loopBreaker.maxIdenticalCalls": {
      label: "Max Identical Calls",
      placeholder: String(DEFAULT_MAX_IDENTICAL_CALLS),
      advanced: true,
    },
  },
};

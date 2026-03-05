import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";

export type { CortexConfig };

export type TrustTier = "untrusted" | "basic" | "verified" | "trusted";

export type VerificationConfig = {
  requireSignature: boolean;
  polValidation: boolean;
  sandboxTest: boolean;
  sandboxTtlSeconds: number;
  /** When true, unsigned skills are blocked at load time (not just warned). Default: false. */
  blockUnsigned: boolean;
  /** Minimum author trust tier for Hub-installed skills. Default: "untrusted" (no enforcement). */
  minTrustTier: TrustTier;
};

export type NotificationsConfig = {
  checkOnSessionStart: boolean;
  checkIntervalMs: number;
};

export type RatingConfig = {
  enabled: boolean;
  minScore: number;
  maxScore: number;
};

export type SkillHubConfig = {
  hubUrl: string;
  cortex: CortexConfig;
  agentNamespace: string;
  keysDir: string;
  verification: VerificationConfig;
  notifications: NotificationsConfig;
  rating: RatingConfig;
};

const DEFAULT_HUB_URL = "https://hub.apilium.com";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_KEYS_DIR = "~/.mayros/keys";

const VALID_TRUST_TIERS = new Set<TrustTier>(["untrusted", "basic", "verified", "trusted"]);

function parseVerificationConfig(raw: unknown): VerificationConfig {
  const ver = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      ver,
      [
        "requireSignature",
        "polValidation",
        "sandboxTest",
        "sandboxTtlSeconds",
        "blockUnsigned",
        "minTrustTier",
      ],
      "verification config",
    );
  }

  const minTrustTierRaw = typeof ver.minTrustTier === "string" ? ver.minTrustTier : "untrusted";
  if (!VALID_TRUST_TIERS.has(minTrustTierRaw as TrustTier)) {
    throw new Error(
      `verification.minTrustTier must be one of: ${[...VALID_TRUST_TIERS].join(", ")}`,
    );
  }

  return {
    requireSignature: ver.requireSignature !== false,
    polValidation: ver.polValidation !== false,
    sandboxTest: ver.sandboxTest !== false,
    sandboxTtlSeconds:
      typeof ver.sandboxTtlSeconds === "number" ? Math.floor(ver.sandboxTtlSeconds) : 60,
    blockUnsigned: ver.blockUnsigned === true,
    minTrustTier: minTrustTierRaw as TrustTier,
  };
}

function parseNotificationsConfig(raw: unknown): NotificationsConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(cfg, ["checkOnSessionStart", "checkIntervalMs"], "notifications config");
  }

  return {
    checkOnSessionStart: cfg.checkOnSessionStart === true,
    checkIntervalMs:
      typeof cfg.checkIntervalMs === "number"
        ? Math.max(60_000, Math.floor(cfg.checkIntervalMs))
        : 3_600_000,
  };
}

function parseRatingConfig(raw: unknown): RatingConfig {
  const cfg = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(cfg, ["enabled", "minScore", "maxScore"], "rating config");
  }

  return {
    enabled: cfg.enabled !== false,
    minScore: typeof cfg.minScore === "number" ? Math.max(1, Math.floor(cfg.minScore)) : 1,
    maxScore: typeof cfg.maxScore === "number" ? Math.min(5, Math.floor(cfg.maxScore)) : 5,
  };
}

function expandHome(p: string): string {
  if (p.startsWith("~/")) {
    return p.replace("~", process.env.HOME ?? "");
  }
  return p;
}

export const skillHubConfigSchema = {
  parse(value: unknown): SkillHubConfig {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("skill hub config required");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["hubUrl", "cortex", "agentNamespace", "keysDir", "verification", "notifications", "rating"],
      "skill hub config",
    );

    const hubUrl = typeof cfg.hubUrl === "string" ? cfg.hubUrl : DEFAULT_HUB_URL;
    const cortex = parseCortexConfig(cfg.cortex);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const keysDir = expandHome(typeof cfg.keysDir === "string" ? cfg.keysDir : DEFAULT_KEYS_DIR);
    const verification = parseVerificationConfig(cfg.verification);
    const notifications = parseNotificationsConfig(cfg.notifications);
    const rating = parseRatingConfig(cfg.rating);

    return { hubUrl, cortex, agentNamespace, keysDir, verification, notifications, rating };
  },
  uiHints: {
    hubUrl: {
      label: "Hub URL",
      placeholder: DEFAULT_HUB_URL,
      help: "Base URL for the Apilium Hub marketplace",
    },
    "cortex.host": {
      label: "Cortex Host",
      placeholder: DEFAULT_HOST,
      advanced: true,
      help: "Hostname where AIngle Cortex is listening",
    },
    "cortex.port": {
      label: "Cortex Port",
      placeholder: String(DEFAULT_PORT),
      advanced: true,
      help: "Port for Cortex REST API",
    },
    keysDir: {
      label: "Keys Directory",
      placeholder: DEFAULT_KEYS_DIR,
      advanced: true,
      help: "Directory for Ed25519 keypair storage",
    },
  },
};

// ============================================================================
// Trust tier utilities
// ============================================================================

const TIER_ORDER: Record<TrustTier, number> = {
  untrusted: 0,
  basic: 1,
  verified: 2,
  trusted: 3,
};

/** Compute trust tier from a consistency score (0..1). */
export function tierFromScore(score: number): TrustTier {
  if (score >= 0.9) return "trusted";
  if (score >= 0.7) return "verified";
  if (score >= 0.4) return "basic";
  return "untrusted";
}

/** Returns true if `actual` tier meets or exceeds the `required` tier. */
export function meetsTier(actual: TrustTier, required: TrustTier): boolean {
  return TIER_ORDER[actual] >= TIER_ORDER[required];
}

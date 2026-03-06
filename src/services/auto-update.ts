/**
 * Auto-Update Checker Service
 *
 * Checks for new versions of Mayros from the npm registry
 * and provides user-friendly upgrade notifications.
 */

// ============================================================================
// Types
// ============================================================================

export type UpdateCheckResult = {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  channel: "stable" | "beta" | "dev";
  checkedAt: number;
};

export type UpdateCheckConfig = {
  registryUrl: string;
  checkIntervalMs: number;
  channel: "stable" | "beta" | "dev";
};

// ============================================================================
// Registry response shape (subset)
// ============================================================================

type RegistryResponse = {
  "dist-tags"?: Record<string, string>;
};

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_REGISTRY_URL = "https://registry.npmjs.org/@apilium/mayros";
const DEFAULT_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1_000; // 24 hours

// ============================================================================
// AutoUpdateChecker
// ============================================================================

export class AutoUpdateChecker {
  private readonly config: UpdateCheckConfig;

  constructor(config?: Partial<UpdateCheckConfig>) {
    this.config = {
      registryUrl: config?.registryUrl ?? DEFAULT_REGISTRY_URL,
      checkIntervalMs: config?.checkIntervalMs ?? DEFAULT_CHECK_INTERVAL_MS,
      channel: config?.channel ?? "stable",
    };
  }

  /**
   * Return true if enough time has passed since the last check.
   */
  shouldCheck(lastCheckedAt?: number): boolean {
    if (lastCheckedAt === undefined) return true;
    return Date.now() - lastCheckedAt > this.config.checkIntervalMs;
  }

  /**
   * Fetch the latest version from the npm registry and compare
   * against the provided currentVersion.
   */
  async checkForUpdate(currentVersion: string): Promise<UpdateCheckResult> {
    const checkedAt = Date.now();

    try {
      const res = await fetch(this.config.registryUrl, {
        headers: { Accept: "application/json" },
      });

      if (!res.ok) {
        return {
          currentVersion,
          latestVersion: null,
          updateAvailable: false,
          channel: this.config.channel,
          checkedAt,
        };
      }

      const data = (await res.json()) as RegistryResponse;
      const distTags = data["dist-tags"] ?? {};

      // Map channel to dist-tag key.
      const tagKey = this.config.channel === "stable" ? "latest" : this.config.channel;
      const latestVersion = distTags[tagKey] ?? null;

      return {
        currentVersion,
        latestVersion,
        updateAvailable:
          latestVersion !== null && AutoUpdateChecker.isNewer(currentVersion, latestVersion),
        channel: this.config.channel,
        checkedAt,
      };
    } catch {
      // Network errors should not break the CLI.
      return {
        currentVersion,
        latestVersion: null,
        updateAvailable: false,
        channel: this.config.channel,
        checkedAt,
      };
    }
  }

  /**
   * Compare two semver strings. Returns true if `latest` is newer than `current`.
   *
   * Supports simple `major.minor.patch` format. Pre-release suffixes
   * (e.g. `-beta.1`) are stripped for comparison.
   */
  static isNewer(current: string, latest: string): boolean {
    const parse = (v: string): [number, number, number] => {
      const clean = v.replace(/^v/, "").split("-")[0];
      const parts = clean.split(".").map(Number);
      return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0];
    };

    const [cMaj, cMin, cPat] = parse(current);
    const [lMaj, lMin, lPat] = parse(latest);

    if (lMaj !== cMaj) return lMaj > cMaj;
    if (lMin !== cMin) return lMin > cMin;
    return lPat > cPat;
  }

  /**
   * Format a user-friendly update notification.
   * Returns null when no update is available.
   */
  static formatNotification(result: UpdateCheckResult): string | null {
    if (!result.updateAvailable || result.latestVersion === null) {
      return null;
    }

    return `Update available: v${result.currentVersion} → v${result.latestVersion}. Run \`mayros update\` to upgrade.`;
  }
}

/**
 * Eruberu Proxy — Inference routing proxy
 *
 * All LLM calls flow through the gateway with logging, policy enforcement,
 * and usage tracking. Supports multiple providers with built-in profiles.
 */

import { randomUUID } from "node:crypto";

// ── Types ────────────────────────────────────────────────────────────────

export type InferenceProfile = {
  id: string;
  name: string;
  providerType: "anthropic" | "openai" | "google" | "local" | "custom";
  endpoint: string;
  model: string;
  credentialEnv: string;
  credentialDefault?: string;
};

export type InferenceLog = {
  id: string;
  profileId: string;
  model: string;
  provider: string;
  inputTokens: number;
  outputTokens: number;
  durationMs: number;
  status: "success" | "error" | "blocked";
  timestamp: string;
  agentId?: string;
  ventureId?: string;
};

export type InferencePolicy = {
  allowedProviders: string[];
  allowedModels: string[];
  maxTokensPerRequest: number;
  requireApproval: boolean;
  logAllRequests: boolean;
};

export type UsageSummary = {
  totalRequests: number;
  totalTokens: number;
  byProvider: Record<string, number>;
  byModel: Record<string, number>;
};

// ── Built-in profiles ────────────────────────────────────────────────────

const BUILT_IN_PROFILES: Record<string, InferenceProfile> = {
  "anthropic-cloud": {
    id: "anthropic-cloud",
    name: "Anthropic Cloud",
    providerType: "anthropic",
    endpoint: "https://api.anthropic.com",
    model: "claude-sonnet-4-6",
    credentialEnv: "ANTHROPIC_API_KEY",
  },
  "openai-cloud": {
    id: "openai-cloud",
    name: "OpenAI Cloud",
    providerType: "openai",
    endpoint: "https://api.openai.com",
    model: "gpt-4o",
    credentialEnv: "OPENAI_API_KEY",
  },
  "google-cloud": {
    id: "google-cloud",
    name: "Google AI",
    providerType: "google",
    endpoint: "https://generativelanguage.googleapis.com",
    model: "gemini-2.5-pro",
    credentialEnv: "GOOGLE_API_KEY",
  },
  "ollama-local": {
    id: "ollama-local",
    name: "Ollama (Local)",
    providerType: "local",
    endpoint: "http://localhost:11434/v1",
    model: "llama3.3",
    credentialEnv: "OLLAMA_API_KEY",
    credentialDefault: "ollama",
  },
  "vllm-local": {
    id: "vllm-local",
    name: "vLLM (Local)",
    providerType: "local",
    endpoint: "http://localhost:8000/v1",
    model: "meta-llama/Llama-3.3-70B",
    credentialEnv: "VLLM_API_KEY",
    credentialDefault: "dummy",
  },
};

// ── Default policy ───────────────────────────────────────────────────────

const DEFAULT_POLICY: InferencePolicy = {
  allowedProviders: ["anthropic", "openai", "google", "local"],
  allowedModels: ["*"],
  maxTokensPerRequest: 200_000,
  requireApproval: false,
  logAllRequests: true,
};

const MAX_LOG_ENTRIES = 1000;
const MAX_CUSTOM_PROFILES = 50;

// ── Implementation ───────────────────────────────────────────────────────

export class EruberuProxy {
  private logs: InferenceLog[] = [];
  private policy: InferencePolicy;
  private profiles: Map<string, InferenceProfile>;
  private activeProfileId: string | null = null;

  constructor(private readonly ns: string) {
    this.policy = { ...DEFAULT_POLICY };
    this.profiles = new Map(
      Object.entries(BUILT_IN_PROFILES).map(([k, v]) => [k, { ...v }]),
    );
  }

  /**
   * List all available inference profiles (built-in + custom).
   */
  listProfiles(): InferenceProfile[] {
    return Array.from(this.profiles.values());
  }

  /**
   * Get the currently active profile.
   */
  getActiveProfile(): InferenceProfile | null {
    if (!this.activeProfileId) return null;
    return this.profiles.get(this.activeProfileId) ?? null;
  }

  /**
   * Set the active inference profile by ID.
   */
  setActiveProfile(profileId: string): void {
    if (!this.profiles.has(profileId)) {
      throw new Error(`eruberu: unknown profile "${profileId}"`);
    }
    this.activeProfileId = profileId;
  }

  /**
   * Add a custom inference profile.
   */
  addProfile(profile: InferenceProfile): void {
    if (!profile.id || !profile.endpoint || !profile.model) {
      throw new Error("eruberu: profile must have id, endpoint, and model");
    }
    // Enforce max cap on custom profiles (built-in profiles don't count)
    if (
      !this.profiles.has(profile.id) &&
      this.profiles.size >= Object.keys(BUILT_IN_PROFILES).length + MAX_CUSTOM_PROFILES
    ) {
      throw new Error(
        `eruberu: max custom profiles reached (${MAX_CUSTOM_PROFILES}). Remove a profile before adding a new one.`,
      );
    }
    this.profiles.set(profile.id, { ...profile });
  }

  /**
   * Remove a profile by ID.
   */
  removeProfile(profileId: string): boolean {
    if (this.activeProfileId === profileId) {
      this.activeProfileId = null;
    }
    return this.profiles.delete(profileId);
  }

  /**
   * Check whether a request to a given provider/model is allowed by policy.
   */
  checkPolicy(
    provider: string,
    model: string,
  ): { allowed: boolean; reason?: string } {
    // Check provider
    if (
      this.policy.allowedProviders.length > 0 &&
      !this.policy.allowedProviders.includes(provider)
    ) {
      return {
        allowed: false,
        reason: `[${this.ns}] Provider "${provider}" is not in the allowed list`,
      };
    }

    // Check model against glob patterns
    if (
      this.policy.allowedModels.length > 0 &&
      !this.policy.allowedModels.includes("*")
    ) {
      const modelAllowed = this.policy.allowedModels.some((pattern) =>
        matchGlob(pattern, model),
      );
      if (!modelAllowed) {
        return {
          allowed: false,
          reason: `[${this.ns}] Model "${model}" is not in the allowed list`,
        };
      }
    }

    return { allowed: true };
  }

  /**
   * Log an inference request. Maintains a ring buffer of max 1000 entries.
   */
  logRequest(
    entry: Omit<InferenceLog, "id" | "timestamp">,
  ): InferenceLog {
    const log: InferenceLog = {
      ...entry,
      id: randomUUID(),
      timestamp: new Date().toISOString(),
    };

    this.logs.push(log);

    // Ring buffer: keep only the most recent entries
    if (this.logs.length > MAX_LOG_ENTRIES) {
      this.logs = this.logs.slice(this.logs.length - MAX_LOG_ENTRIES);
    }

    return log;
  }

  /**
   * Get recent inference logs, most recent first.
   */
  getRecentLogs(limit = 50): InferenceLog[] {
    const start = Math.max(0, this.logs.length - limit);
    return this.logs.slice(start).reverse();
  }

  /**
   * Get aggregated usage summary across all logged requests.
   */
  getUsageSummary(): UsageSummary {
    const byProvider: Record<string, number> = {};
    const byModel: Record<string, number> = {};
    let totalTokens = 0;

    for (const log of this.logs) {
      const tokens = log.inputTokens + log.outputTokens;
      totalTokens += tokens;

      byProvider[log.provider] = (byProvider[log.provider] ?? 0) + tokens;
      byModel[log.model] = (byModel[log.model] ?? 0) + tokens;
    }

    return {
      totalRequests: this.logs.length,
      totalTokens,
      byProvider,
      byModel,
    };
  }

  /**
   * Get the current inference policy.
   */
  getPolicy(): InferencePolicy {
    return { ...this.policy };
  }

  /**
   * Update the inference policy (partial merge).
   */
  setPolicy(update: Partial<InferencePolicy>): void {
    this.policy = { ...this.policy, ...update };
  }

  /**
   * Clear all logs.
   */
  clearLogs(): void {
    this.logs = [];
  }

  /**
   * Get total log count.
   */
  getLogCount(): number {
    return this.logs.length;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

/**
 * Simple glob matcher supporting * and ** wildcards.
 * Rejects overly long patterns to prevent ReDoS.
 */
function matchGlob(pattern: string, value: string): boolean {
  if (pattern === "*") return true;

  // Prevent ReDoS with overly long patterns
  if (pattern.length > 200) return false;

  // Convert glob to regex
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{DOUBLESTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{DOUBLESTAR\}\}/g, ".*");

  return new RegExp(`^${escaped}$`).test(value);
}

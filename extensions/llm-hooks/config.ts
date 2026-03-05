/**
 * LLM Hooks configuration.
 *
 * Markdown-defined hooks evaluated by LLM for policy enforcement.
 * Config uses the manual parse() pattern shared across all Mayros extensions.
 */

import { assertAllowedKeys } from "../shared/cortex-config.js";

// ============================================================================
// Types
// ============================================================================

export type CacheScope = "none" | "session" | "global";

export type LlmHooksConfig = {
  enabled: boolean;
  projectHooksDir: string;
  userHooksDir: string;
  defaultModel: string;
  defaultTimeoutMs: number;
  defaultCache: CacheScope;
  maxConcurrentEvals: number;
  globalCacheTtlMs: number;
};

// ============================================================================
// Defaults
// ============================================================================

const DEFAULT_ENABLED = true;
const DEFAULT_PROJECT_HOOKS_DIR = ".mayros/hooks";
const DEFAULT_USER_HOOKS_DIR = "~/.mayros/hooks";
const DEFAULT_MODEL = "anthropic/claude-sonnet-4-20250514";
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_CACHE: CacheScope = "session";
const DEFAULT_MAX_CONCURRENT_EVALS = 3;
const DEFAULT_GLOBAL_CACHE_TTL_MS = 300000; // 5 minutes

const VALID_CACHE_SCOPES: CacheScope[] = ["none", "session", "global"];

// ============================================================================
// Parser
// ============================================================================

export const llmHooksConfigSchema = {
  parse(value: unknown): LlmHooksConfig {
    const cfg = (value ?? {}) as Record<string, unknown>;
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertAllowedKeys(
        cfg,
        [
          "enabled",
          "projectHooksDir",
          "userHooksDir",
          "defaultModel",
          "defaultTimeoutMs",
          "defaultCache",
          "maxConcurrentEvals",
          "globalCacheTtlMs",
        ],
        "llm-hooks config",
      );
    }

    const enabled = cfg.enabled !== false ? DEFAULT_ENABLED : false;

    const projectHooksDir =
      typeof cfg.projectHooksDir === "string" ? cfg.projectHooksDir : DEFAULT_PROJECT_HOOKS_DIR;

    const userHooksDir =
      typeof cfg.userHooksDir === "string" ? cfg.userHooksDir : DEFAULT_USER_HOOKS_DIR;

    const defaultModel =
      typeof cfg.defaultModel === "string" && cfg.defaultModel.length > 0
        ? cfg.defaultModel
        : DEFAULT_MODEL;

    const defaultTimeoutMs =
      typeof cfg.defaultTimeoutMs === "number"
        ? Math.floor(cfg.defaultTimeoutMs)
        : DEFAULT_TIMEOUT_MS;
    if (defaultTimeoutMs < 1000) {
      throw new Error("llm-hooks.defaultTimeoutMs must be at least 1000");
    }
    if (defaultTimeoutMs > 120000) {
      throw new Error("llm-hooks.defaultTimeoutMs must be at most 120000");
    }

    const defaultCache =
      typeof cfg.defaultCache === "string" &&
      VALID_CACHE_SCOPES.includes(cfg.defaultCache as CacheScope)
        ? (cfg.defaultCache as CacheScope)
        : DEFAULT_CACHE;

    const maxConcurrentEvals =
      typeof cfg.maxConcurrentEvals === "number"
        ? Math.floor(cfg.maxConcurrentEvals)
        : DEFAULT_MAX_CONCURRENT_EVALS;
    if (maxConcurrentEvals < 1) {
      throw new Error("llm-hooks.maxConcurrentEvals must be at least 1");
    }
    if (maxConcurrentEvals > 10) {
      throw new Error("llm-hooks.maxConcurrentEvals must be at most 10");
    }

    const globalCacheTtlMs =
      typeof cfg.globalCacheTtlMs === "number"
        ? Math.floor(cfg.globalCacheTtlMs)
        : DEFAULT_GLOBAL_CACHE_TTL_MS;
    if (globalCacheTtlMs < 10000) {
      throw new Error("llm-hooks.globalCacheTtlMs must be at least 10000");
    }

    return {
      enabled,
      projectHooksDir,
      userHooksDir,
      defaultModel,
      defaultTimeoutMs,
      defaultCache,
      maxConcurrentEvals,
      globalCacheTtlMs,
    };
  },
  uiHints: {
    enabled: {
      label: "Enable LLM Hooks",
      help: "Enable or disable markdown-defined LLM hook evaluation",
    },
    projectHooksDir: {
      label: "Project Hooks Directory",
      placeholder: DEFAULT_PROJECT_HOOKS_DIR,
      advanced: true,
      help: "Directory for project-level hook definitions (relative to project root)",
    },
    userHooksDir: {
      label: "User Hooks Directory",
      placeholder: DEFAULT_USER_HOOKS_DIR,
      advanced: true,
      help: "Directory for user-level hook definitions (supports ~ expansion)",
    },
    defaultModel: {
      label: "Default Model",
      placeholder: DEFAULT_MODEL,
      advanced: true,
      help: "Default LLM model used for hook evaluation",
    },
    defaultTimeoutMs: {
      label: "Default Timeout (ms)",
      placeholder: String(DEFAULT_TIMEOUT_MS),
      advanced: true,
      help: "Default timeout in milliseconds for LLM hook evaluation",
    },
    defaultCache: {
      label: "Default Cache Scope",
      placeholder: DEFAULT_CACHE,
      advanced: true,
      help: "Default cache scope for hook results (none, session, global)",
    },
    maxConcurrentEvals: {
      label: "Max Concurrent Evaluations",
      placeholder: String(DEFAULT_MAX_CONCURRENT_EVALS),
      advanced: true,
      help: "Maximum number of concurrent LLM hook evaluations",
    },
    globalCacheTtlMs: {
      label: "Global Cache TTL (ms)",
      placeholder: String(DEFAULT_GLOBAL_CACHE_TTL_MS),
      advanced: true,
      help: "Time-to-live in milliseconds for global cache entries",
    },
  },
};

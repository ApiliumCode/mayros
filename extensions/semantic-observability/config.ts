import {
  type CortexConfig,
  parseCortexConfig,
  assertAllowedKeys,
} from "../shared/cortex-config.js";

export type { CortexConfig };

export type TracingConfig = {
  enabled: boolean;
  captureToolCalls: boolean;
  captureLLMCalls: boolean;
  captureDelegations: boolean;
  flushIntervalMs: number;
};

export type MetricsConfig = {
  enabled: boolean;
  path: string;
};

export type SessionConfig = {
  maxCheckpointsPerSession: number;
  maxForksPerSession: number;
};

export type ObservabilityConfig = {
  cortex: CortexConfig;
  agentNamespace: string;
  tracing: TracingConfig;
  metrics: MetricsConfig;
  session: SessionConfig;
};

const DEFAULT_NAMESPACE = "mayros";
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_PORT = 8080;
const DEFAULT_FLUSH_INTERVAL_MS = 5000;
const DEFAULT_MAX_CHECKPOINTS = 50;
const DEFAULT_MAX_FORKS = 10;

function parseTracingConfig(raw: unknown): TracingConfig {
  const tracing = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      tracing,
      ["enabled", "captureToolCalls", "captureLLMCalls", "captureDelegations", "flushIntervalMs"],
      "tracing config",
    );
  }

  const enabled = tracing.enabled !== false;
  const captureToolCalls = tracing.captureToolCalls !== false;
  const captureLLMCalls = tracing.captureLLMCalls !== false;
  const captureDelegations = tracing.captureDelegations !== false;
  const flushIntervalMs =
    typeof tracing.flushIntervalMs === "number"
      ? Math.floor(tracing.flushIntervalMs)
      : DEFAULT_FLUSH_INTERVAL_MS;

  if (flushIntervalMs < 100) {
    throw new Error("tracing.flushIntervalMs must be at least 100");
  }

  return { enabled, captureToolCalls, captureLLMCalls, captureDelegations, flushIntervalMs };
}

function parseMetricsConfig(raw: unknown): MetricsConfig {
  const metrics = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(metrics, ["enabled", "path"], "metrics config");
  }

  return {
    enabled: metrics.enabled === true,
    path: typeof metrics.path === "string" ? metrics.path : "/metrics",
  };
}

function parseSessionConfig(raw: unknown): SessionConfig {
  const session = (raw ?? {}) as Record<string, unknown>;
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    assertAllowedKeys(
      session,
      ["maxCheckpointsPerSession", "maxForksPerSession"],
      "session config",
    );
  }

  const maxCheckpointsPerSession =
    typeof session.maxCheckpointsPerSession === "number"
      ? Math.floor(session.maxCheckpointsPerSession)
      : DEFAULT_MAX_CHECKPOINTS;
  if (maxCheckpointsPerSession < 1) {
    throw new Error("session.maxCheckpointsPerSession must be at least 1");
  }

  const maxForksPerSession =
    typeof session.maxForksPerSession === "number"
      ? Math.floor(session.maxForksPerSession)
      : DEFAULT_MAX_FORKS;
  if (maxForksPerSession < 1) {
    throw new Error("session.maxForksPerSession must be at least 1");
  }

  return { maxCheckpointsPerSession, maxForksPerSession };
}

export const observabilityConfigSchema = {
  parse(value: unknown): ObservabilityConfig {
    if (value === null || value === undefined) {
      value = {};
    }
    if (typeof value !== "object" || Array.isArray(value)) {
      throw new Error("observability config must be an object");
    }
    const cfg = value as Record<string, unknown>;
    assertAllowedKeys(
      cfg,
      ["cortex", "agentNamespace", "tracing", "metrics", "session"],
      "observability config",
    );

    const cortex = parseCortexConfig(cfg.cortex);

    const agentNamespace =
      typeof cfg.agentNamespace === "string" ? cfg.agentNamespace : DEFAULT_NAMESPACE;
    if (!/^[a-zA-Z][a-zA-Z0-9_-]*$/.test(agentNamespace)) {
      throw new Error(
        "agentNamespace must start with a letter and contain only letters, digits, hyphens, or underscores",
      );
    }

    const tracing = parseTracingConfig(cfg.tracing);
    const metrics = parseMetricsConfig(cfg.metrics);
    const session = parseSessionConfig(cfg.session);

    return { cortex, agentNamespace, tracing, metrics, session };
  },
  uiHints: {
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
    "cortex.authToken": {
      label: "Cortex Auth Token",
      sensitive: true,
      placeholder: "Bearer ...",
      help: "Optional authentication token for Cortex API (or use ${CORTEX_AUTH_TOKEN})",
    },
    agentNamespace: {
      label: "Agent Namespace",
      placeholder: DEFAULT_NAMESPACE,
      advanced: true,
      help: "RDF namespace prefix for observability data",
    },
    "tracing.enabled": {
      label: "Tracing Enabled",
      help: "Enable or disable trace event collection",
    },
    "tracing.captureToolCalls": {
      label: "Capture Tool Calls",
      help: "Record tool invocation events",
    },
    "tracing.captureLLMCalls": {
      label: "Capture LLM Calls",
      help: "Record LLM request/response events",
    },
    "tracing.captureDelegations": {
      label: "Capture Delegations",
      help: "Record subagent delegation events",
    },
    "tracing.flushIntervalMs": {
      label: "Flush Interval (ms)",
      placeholder: String(DEFAULT_FLUSH_INTERVAL_MS),
      advanced: true,
      help: "How often buffered trace events are flushed to Cortex (milliseconds)",
    },
    "session.maxCheckpointsPerSession": {
      label: "Max Checkpoints",
      placeholder: String(DEFAULT_MAX_CHECKPOINTS),
      advanced: true,
      help: "Maximum number of checkpoints allowed per session",
    },
    "session.maxForksPerSession": {
      label: "Max Forks",
      placeholder: String(DEFAULT_MAX_FORKS),
      advanced: true,
      help: "Maximum number of forks allowed per session",
    },
  },
};

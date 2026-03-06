/**
 * Analytics Event Schema — structured analytics events.
 */

export type AnalyticsCategory =
  | "command" // slash command execution
  | "tool" // tool call
  | "model" // model selection/switch
  | "session" // session lifecycle
  | "feature" // feature usage (vim, theme, etc)
  | "error" // errors and failures
  | "performance"; // timing and resource metrics

export type AnalyticsEvent = {
  /** Unique event ID (uuid v4). */
  id: string;
  /** Event category. */
  category: AnalyticsCategory;
  /** Action within category (e.g., "execute", "switch", "start"). */
  action: string;
  /** Optional label for further classification. */
  label?: string;
  /** Numeric value (e.g., duration in ms, token count). */
  value?: number;
  /** ISO 8601 timestamp. */
  timestamp: string;
  /** Session identifier (hashed). */
  sessionId?: string;
  /** Additional attributes. */
  attributes?: Record<string, string | number | boolean>;
};

export type AnalyticsBatch = {
  /** Client version (from package.json). */
  clientVersion: string;
  /** Platform (darwin, linux, win32). */
  platform: string;
  /** Node.js version. */
  nodeVersion: string;
  /** Batch of events. */
  events: AnalyticsEvent[];
  /** When this batch was assembled. */
  batchedAt: string;
};

/** Create a new analytics event with defaults filled in. */
export function createEvent(
  category: AnalyticsCategory,
  action: string,
  opts?: {
    label?: string;
    value?: number;
    sessionId?: string;
    attributes?: Record<string, string | number | boolean>;
  },
): AnalyticsEvent {
  return {
    id: crypto.randomUUID(),
    category,
    action,
    label: opts?.label,
    value: opts?.value,
    timestamp: new Date().toISOString(),
    sessionId: opts?.sessionId,
    attributes: opts?.attributes,
  };
}

/** Create an AnalyticsBatch from events. */
export function createBatch(events: AnalyticsEvent[], clientVersion: string): AnalyticsBatch {
  return {
    clientVersion,
    platform: process.platform,
    nodeVersion: process.version,
    events,
    batchedAt: new Date().toISOString(),
  };
}

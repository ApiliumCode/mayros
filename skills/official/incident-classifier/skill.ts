/**
 * incident-classifier — semantic skill runtime
 *
 * Classifies errors and incidents by type, severity, and remediation steps.
 * Recognizes HTTP status codes and 8 common error patterns.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

// ---------------------------------------------------------------------------
// HTTP status code classification map
// ---------------------------------------------------------------------------

type HttpClassification = {
  label: string;
  priority: string;
  type: string;
  remediation: string;
};

const HTTP_STATUS_MAP: Record<number, HttpClassification> = {
  400: {
    label: "Bad Request",
    priority: "P3",
    type: "validation",
    remediation: "Check request parameters and body format",
  },
  401: {
    label: "Unauthorized",
    priority: "P2",
    type: "authentication",
    remediation: "Verify API key or token validity",
  },
  403: {
    label: "Forbidden",
    priority: "P2",
    type: "authorization",
    remediation: "Check permissions and access policies",
  },
  404: {
    label: "Not Found",
    priority: "P3",
    type: "routing",
    remediation: "Verify endpoint URL and resource existence",
  },
  408: {
    label: "Request Timeout",
    priority: "P2",
    type: "timeout",
    remediation: "Increase timeout or optimize request",
  },
  409: {
    label: "Conflict",
    priority: "P3",
    type: "concurrency",
    remediation: "Retry with updated resource state",
  },
  413: {
    label: "Payload Too Large",
    priority: "P3",
    type: "validation",
    remediation: "Reduce request payload size",
  },
  422: {
    label: "Unprocessable Entity",
    priority: "P3",
    type: "validation",
    remediation: "Fix request data format",
  },
  429: {
    label: "Too Many Requests",
    priority: "P1",
    type: "rate-limit",
    remediation: "Implement backoff and respect rate limits",
  },
  500: {
    label: "Internal Server Error",
    priority: "P1",
    type: "server",
    remediation: "Check server logs and escalate",
  },
  502: {
    label: "Bad Gateway",
    priority: "P1",
    type: "infrastructure",
    remediation: "Check upstream service health",
  },
  503: {
    label: "Service Unavailable",
    priority: "P0",
    type: "outage",
    remediation: "Trigger incident response protocol",
  },
  504: {
    label: "Gateway Timeout",
    priority: "P1",
    type: "timeout",
    remediation: "Check upstream service response times",
  },
};

// ---------------------------------------------------------------------------
// Error type patterns (regex-based)
// ---------------------------------------------------------------------------

type ErrorPattern = {
  type: string;
  priority: string;
  pattern: RegExp;
  remediation: string;
};

const ERROR_PATTERNS: ErrorPattern[] = [
  {
    type: "timeout",
    priority: "P2",
    pattern: /timeout|timed out|deadline exceeded/i,
    remediation: "Increase timeout thresholds or optimize slow operations",
  },
  {
    type: "auth",
    priority: "P2",
    pattern: /unauthorized|forbidden|invalid token|expired token/i,
    remediation: "Refresh credentials or rotate API keys",
  },
  {
    type: "rate-limit",
    priority: "P1",
    pattern: /rate limit|too many requests|throttl/i,
    remediation: "Implement exponential backoff and request queuing",
  },
  {
    type: "network",
    priority: "P1",
    pattern: /ECONNREFUSED|ECONNRESET|ETIMEDOUT|DNS/i,
    remediation: "Check network connectivity and DNS resolution",
  },
  {
    type: "validation",
    priority: "P3",
    pattern: /invalid|missing required|malformed/i,
    remediation: "Validate input data before sending requests",
  },
  {
    type: "oom",
    priority: "P0",
    pattern: /out of memory|heap|OOM|allocation failed/i,
    remediation: "Increase memory limits or fix memory leaks",
  },
  {
    type: "deadlock",
    priority: "P0",
    pattern: /deadlock|lock timeout|lock wait/i,
    remediation: "Review transaction ordering and lock acquisition",
  },
  {
    type: "disk",
    priority: "P1",
    pattern: /ENOSPC|disk full|no space left/i,
    remediation: "Free disk space or expand storage volume",
  },
];

// ---------------------------------------------------------------------------
// Severity mapping
// ---------------------------------------------------------------------------

const SEVERITY_LABELS: Record<string, string> = {
  P0: "critical",
  P1: "high",
  P2: "medium",
  P3: "low",
  P4: "info",
};

// ---------------------------------------------------------------------------
// Classification helpers
// ---------------------------------------------------------------------------

type Classification = {
  source: string;
  type: string;
  priority: string;
  severity: string;
  label: string;
  remediation: string;
};

function classifyText(text: string): Classification[] {
  const classifications: Classification[] = [];

  // Check HTTP status codes
  const statusCodeRegex = /\b(4\d{2}|5\d{2})\b/g;
  let match: RegExpExecArray | null;
  const seenCodes = new Set<number>();

  match = statusCodeRegex.exec(text);
  while (match !== null) {
    const code = parseInt(match[1], 10);
    if (!seenCodes.has(code)) {
      seenCodes.add(code);
      const info = HTTP_STATUS_MAP[code];
      if (info) {
        classifications.push({
          source: `HTTP ${code}`,
          type: info.type,
          priority: info.priority,
          severity: SEVERITY_LABELS[info.priority] ?? "info",
          label: info.label,
          remediation: info.remediation,
        });
      }
    }
    match = statusCodeRegex.exec(text);
  }

  // Check error patterns
  for (const ep of ERROR_PATTERNS) {
    if (ep.pattern.test(text)) {
      // Avoid duplicate type classification from HTTP + pattern
      const alreadyClassified = classifications.some((c) => c.type === ep.type);
      if (!alreadyClassified) {
        classifications.push({
          source: "pattern",
          type: ep.type,
          priority: ep.priority,
          severity: SEVERITY_LABELS[ep.priority] ?? "info",
          label: ep.type,
          remediation: ep.remediation,
        });
      }
    }
  }

  return classifications;
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime: SkillRuntime = {
  name: "incident-classifier",

  async onActivate(ctx) {
    ctx.logger.info(`incident-classifier: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    const allClassifications: Classification[] = [];
    const enriched = ctx.results.map((r) => {
      const text = typeof r.object === "string" ? r.object : JSON.stringify(r.object);
      const classifications = classifyText(text);
      allClassifications.push(...classifications);

      if (classifications.length === 0) {
        return { subject: r.subject, object: { value: r.object, incident: null } };
      }

      // Use the highest-severity classification as the primary
      const sorted = [...classifications].sort((a, b) => {
        const pa = parseInt(a.priority.slice(1), 10);
        const pb = parseInt(b.priority.slice(1), 10);
        return pa - pb;
      });
      const primary = sorted[0];

      return {
        subject: r.subject,
        object: {
          value: r.object,
          incident: {
            type: primary.type,
            priority: primary.priority,
            severity: primary.severity,
            remediation: primary.remediation,
            allFindings: classifications,
          },
        },
      };
    });

    // Count by priority
    const counts: Record<string, number> = { P0: 0, P1: 0, P2: 0, P3: 0 };
    for (const c of allClassifications) {
      if (c.priority in counts) {
        counts[c.priority]++;
      }
    }

    const total = allClassifications.length;
    const summary =
      total > 0
        ? `[incident-classifier] Classified ${total} incidents: ${counts.P0} P0, ${counts.P1} P1, ${counts.P2} P2, ${counts.P3} P3`
        : `[incident-classifier] No incidents detected in ${ctx.results.length} results`;

    return {
      results: enriched,
      additionalContext: summary,
    };
  },

  async onError(ctx) {
    ctx.logger.error(`incident-classifier: error during ${ctx.operation}: ${ctx.error.message}`);
  },
};

export default runtime;

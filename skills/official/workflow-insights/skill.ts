/**
 * workflow-insights — semantic skill runtime
 *
 * Detects anti-patterns in agent workflows and computes health scores
 * based on 7 weighted pattern detectors. Health score starts at 100
 * and is reduced by each detected anti-pattern's weight.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

// ---------------------------------------------------------------------------
// Anti-pattern types
// ---------------------------------------------------------------------------

type AntiPattern = {
  id: string;
  name: string;
  description: string;
  weight: number;
};

type DetectedPattern = AntiPattern & {
  evidence: string;
};

type HealthRating = "healthy" | "needs attention" | "degraded" | "critical";

type WorkflowAnalysis = {
  healthScore: number;
  rating: HealthRating;
  detectedPatterns: DetectedPattern[];
};

// ---------------------------------------------------------------------------
// Anti-pattern definitions
// ---------------------------------------------------------------------------

const ANTI_PATTERNS: AntiPattern[] = [
  {
    id: "repeated-failure",
    name: "Repeated Failure",
    description: "Same error appearing 3+ times suggests retry without fix",
    weight: 20,
  },
  {
    id: "long-chain",
    name: "Long Chain",
    description: "Delegation chain exceeding 5 steps suggests over-decomposition",
    weight: 15,
  },
  {
    id: "unused-tool",
    name: "Unused Tool",
    description: "Tool registered but never called suggests bloated configuration",
    weight: 5,
  },
  {
    id: "redundant-query",
    name: "Redundant Query",
    description: "Same query pattern appearing multiple times suggests missing caching",
    weight: 10,
  },
  {
    id: "timeout-pattern",
    name: "Timeout Pattern",
    description: "Multiple timeouts in sequence suggests resource contention",
    weight: 20,
  },
  {
    id: "resource-waste",
    name: "Resource Waste",
    description: "Large context sent to simple tasks suggests poor task routing",
    weight: 15,
  },
  {
    id: "error-cascade",
    name: "Error Cascade",
    description:
      "Error in one step causing errors in 3+ downstream steps suggests missing error boundaries",
    weight: 15,
  },
];

// ---------------------------------------------------------------------------
// Detection logic
// ---------------------------------------------------------------------------

/**
 * Check for repeated failure: the same error string appearing 3+ times.
 * Extracts error-like substrings and counts occurrences.
 */
function detectRepeatedFailure(texts: string[]): string | null {
  const errorCounts = new Map<string, number>();
  const errorPattern = /(?:error|fail|exception|threw|crashed|rejected)[:;\s]+([^\n.]{5,80})/gi;

  for (const text of texts) {
    let match = errorPattern.exec(text);
    while (match !== null) {
      const key = match[1].trim().toLowerCase();
      errorCounts.set(key, (errorCounts.get(key) ?? 0) + 1);
      match = errorPattern.exec(text);
    }
  }

  for (const [key, count] of errorCounts) {
    if (count >= 3) {
      return `"${key}" appeared ${count} times`;
    }
  }
  return null;
}

/**
 * Check for long delegation chains: references to step/delegate counts > 5.
 */
function detectLongChain(texts: string[]): string | null {
  const chainPattern = /(?:step|delegate|hop|depth|level|chain)\s*[:=#]?\s*(\d+)/gi;

  for (const text of texts) {
    let match = chainPattern.exec(text);
    while (match !== null) {
      const depth = parseInt(match[1], 10);
      if (depth > 5) {
        return `Chain depth ${depth} detected`;
      }
      match = chainPattern.exec(text);
    }
  }

  // Also detect chains described as lists: "delegated to A -> B -> C -> D -> E -> F"
  const arrowPattern = /(?:->|→|>>|=>)\s*\w+/g;
  for (const text of texts) {
    const arrows = text.match(arrowPattern);
    if (arrows && arrows.length > 5) {
      return `Arrow chain with ${arrows.length} hops detected`;
    }
  }

  return null;
}

/**
 * Check for unused tools: tools that are registered/loaded but never invoked.
 */
function detectUnusedTool(texts: string[]): string | null {
  const registered =
    /(?:registered|loaded|available|configured)\s+tool[s]?\s*[:=]?\s*([a-z_-]+(?:,\s*[a-z_-]+)*)/gi;
  const invoked = /(?:called|invoked|used|ran|executed)\s+(?:tool\s+)?([a-z_-]+)/gi;

  const registeredTools = new Set<string>();
  const invokedTools = new Set<string>();

  for (const text of texts) {
    let match = registered.exec(text);
    while (match !== null) {
      for (const t of match[1].split(",")) {
        registeredTools.add(t.trim().toLowerCase());
      }
      match = registered.exec(text);
    }

    match = invoked.exec(text);
    while (match !== null) {
      invokedTools.add(match[1].trim().toLowerCase());
      match = invoked.exec(text);
    }
  }

  const unused: string[] = [];
  for (const tool of registeredTools) {
    if (!invokedTools.has(tool)) {
      unused.push(tool);
    }
  }

  if (unused.length > 0) {
    return `${unused.length} unused tool(s): ${unused.slice(0, 3).join(", ")}`;
  }

  // Fallback heuristic: explicit "unused" or "never called" mentions
  const unusedKeyword = /(?:unused|never\s+called|not\s+used|idle)\s+tool/i;
  for (const text of texts) {
    if (unusedKeyword.test(text)) {
      return "Unused tool reference detected";
    }
  }

  return null;
}

/**
 * Check for redundant queries: duplicate query patterns in the text.
 */
function detectRedundantQuery(texts: string[]): string | null {
  const queryPattern = /(?:query|request|lookup|search|find)\s*[:([{]\s*([^\n)}\]]{5,60})/gi;
  const queryCounts = new Map<string, number>();

  for (const text of texts) {
    let match = queryPattern.exec(text);
    while (match !== null) {
      const key = match[1].trim().toLowerCase();
      queryCounts.set(key, (queryCounts.get(key) ?? 0) + 1);
      match = queryPattern.exec(text);
    }
  }

  for (const [key, count] of queryCounts) {
    if (count >= 2) {
      return `Query "${key.slice(0, 40)}" repeated ${count} times`;
    }
  }

  // Fallback: explicit "duplicate query" or "redundant" mentions
  const redundantKeyword = /(?:duplicate|redundant|repeated)\s+(?:query|request|lookup)/i;
  for (const text of texts) {
    if (redundantKeyword.test(text)) {
      return "Redundant query pattern detected";
    }
  }

  return null;
}

/**
 * Check for timeout patterns: multiple timeouts appearing in sequence.
 */
function detectTimeoutPattern(texts: string[]): string | null {
  const timeoutPattern =
    /(?:timeout|timed\s+out|deadline\s+exceeded|ETIMEDOUT|request\s+timeout)/gi;

  let totalTimeouts = 0;
  for (const text of texts) {
    const matches = text.match(timeoutPattern);
    if (matches) {
      totalTimeouts += matches.length;
    }
  }

  if (totalTimeouts >= 2) {
    return `${totalTimeouts} timeout occurrences detected`;
  }

  return null;
}

/**
 * Check for resource waste: large context sent to simple tasks.
 */
function detectResourceWaste(texts: string[]): string | null {
  const largeContext =
    /(?:large\s+context|oversized|excessive\s+(?:input|context|payload)|(?:token|char)\s+count\s*[:=]?\s*(\d{4,}))/gi;
  const simpleTask = /(?:simple|trivial|basic|minor|small)\s+(?:task|operation|request|action)/i;

  for (const text of texts) {
    const hasLarge = largeContext.test(text);
    largeContext.lastIndex = 0; // reset after test
    const hasSimple = simpleTask.test(text);

    if (hasLarge && hasSimple) {
      return "Large context paired with simple task detected";
    }
  }

  // Heuristic: token counts over 10000 for classification/formatting tasks
  const highTokens = /(?:tokens?|chars?)\s*[:=]?\s*(\d{5,})/i;
  const simpleVerbs = /(?:classify|format|label|tag|categorize|extract\s+field)/i;

  for (const text of texts) {
    if (highTokens.test(text) && simpleVerbs.test(text)) {
      return "High token count for low-complexity operation";
    }
  }

  return null;
}

/**
 * Check for error cascades: an error causing 3+ downstream errors.
 */
function detectErrorCascade(texts: string[]): string | null {
  const cascadePattern =
    /(?:cascade|propagat|downstream\s+(?:error|failure)|caused\s+(?:\d+|multiple|several)\s+(?:error|failure))/i;
  const multiError = /(?:(\d+)\s+(?:downstream|subsequent|following)\s+(?:error|failure))/i;

  for (const text of texts) {
    if (cascadePattern.test(text)) {
      const countMatch = multiError.exec(text);
      if (countMatch) {
        const count = parseInt(countMatch[1], 10);
        if (count >= 3) {
          return `Error propagated to ${count} downstream steps`;
        }
      }
      return "Error cascade pattern detected";
    }
  }

  // Heuristic: count error lines and check if sequential errors cluster
  const errorLines: number[] = [];
  for (const text of texts) {
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (/(?:error|fail|exception)/i.test(lines[i])) {
        errorLines.push(i);
      }
    }
  }

  // If 4+ consecutive or near-consecutive error lines, likely cascade
  let consecutive = 1;
  for (let i = 1; i < errorLines.length; i++) {
    if (errorLines[i] - errorLines[i - 1] <= 2) {
      consecutive++;
      if (consecutive >= 4) {
        return `${consecutive} near-consecutive errors suggest cascade`;
      }
    } else {
      consecutive = 1;
    }
  }

  return null;
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------

type DetectorFn = (texts: string[]) => string | null;

const DETECTORS: Array<{ pattern: AntiPattern; detect: DetectorFn }> = [
  { pattern: ANTI_PATTERNS[0], detect: detectRepeatedFailure },
  { pattern: ANTI_PATTERNS[1], detect: detectLongChain },
  { pattern: ANTI_PATTERNS[2], detect: detectUnusedTool },
  { pattern: ANTI_PATTERNS[3], detect: detectRedundantQuery },
  { pattern: ANTI_PATTERNS[4], detect: detectTimeoutPattern },
  { pattern: ANTI_PATTERNS[5], detect: detectResourceWaste },
  { pattern: ANTI_PATTERNS[6], detect: detectErrorCascade },
];

function analyzeWorkflow(texts: string[]): WorkflowAnalysis {
  const detected: DetectedPattern[] = [];

  for (const { pattern, detect } of DETECTORS) {
    const evidence = detect(texts);
    if (evidence !== null) {
      detected.push({ ...pattern, evidence });
    }
  }

  // Health score: start at 100, subtract weight for each detected pattern
  let score = 100;
  for (const p of detected) {
    score -= p.weight;
  }
  // Clamp to 0-100
  score = Math.max(0, Math.min(100, score));

  let rating: HealthRating;
  if (score >= 80) {
    rating = "healthy";
  } else if (score >= 60) {
    rating = "needs attention";
  } else if (score >= 40) {
    rating = "degraded";
  } else {
    rating = "critical";
  }

  return { healthScore: score, rating, detectedPatterns: detected };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime: SkillRuntime = {
  name: "workflow-insights",

  async onActivate(ctx) {
    ctx.logger.info(`workflow-insights: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    // Collect all text from results for cross-result analysis
    const texts = ctx.results.map((r) =>
      typeof r.object === "string" ? r.object : JSON.stringify(r.object),
    );

    const analysis = analyzeWorkflow(texts);

    const enriched = ctx.results.map((r) => ({
      subject: r.subject,
      object: {
        value: r.object,
        workflowAnalysis: {
          healthScore: analysis.healthScore,
          rating: analysis.rating,
          detectedPatterns: analysis.detectedPatterns.map((p) => ({
            id: p.id,
            name: p.name,
            weight: p.weight,
            evidence: p.evidence,
          })),
        },
      },
    }));

    const patternCount = analysis.detectedPatterns.length;
    const summary =
      `[workflow-insights] Health score: ${analysis.healthScore}/100 (${analysis.rating})` +
      ` \u2014 detected ${patternCount} anti-pattern${patternCount === 1 ? "" : "s"}`;

    return {
      results: enriched,
      additionalContext: summary,
    };
  },

  async onError(ctx) {
    ctx.logger.error(`workflow-insights: error during ${ctx.operation}: ${ctx.error.message}`);
  },
};

export default runtime;

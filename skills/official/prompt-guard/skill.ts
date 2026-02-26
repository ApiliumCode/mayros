/**
 * prompt-guard — semantic skill runtime
 *
 * Detects prompt injection patterns in graph query results and classifies
 * each item as safe, suspicious, or dangerous.
 */
import type { SkillRuntime } from "../../../extensions/semantic-skills/skill-runtime-contract.js";

// ---------------------------------------------------------------------------
// Classification types
// ---------------------------------------------------------------------------

type RiskLevel = "safe" | "suspicious" | "dangerous";

type Finding = {
  pattern: string;
  risk: RiskLevel;
  description: string;
};

type ScanResult = {
  classification: RiskLevel;
  findings: Finding[];
};

// ---------------------------------------------------------------------------
// Detection patterns
// ---------------------------------------------------------------------------

type DetectionRule = {
  id: string;
  risk: RiskLevel;
  description: string;
  test: (text: string) => boolean;
};

/**
 * Build a case-insensitive regex from a pattern string.
 * Kept as a helper to avoid repeating flags everywhere.
 */
function iRe(pattern: string): RegExp {
  return new RegExp(pattern, "i");
}

const DETECTION_RULES: DetectionRule[] = [
  // --- Dangerous: active injection attempts ---
  {
    id: "ignore-previous",
    risk: "dangerous",
    description: "Instruction to ignore or disregard previous context",
    test: (t) =>
      iRe(
        "\\b(ignore|disregard|forget)\\s+(all\\s+)?(previous|prior|above|earlier)\\s+(instructions?|context|rules?|prompts?)",
      ).test(t),
  },
  {
    id: "role-override",
    risk: "dangerous",
    description: "Attempt to override the assistant role",
    test: (t) =>
      iRe(
        "\\b(pretend\\s+to\\s+be|roleplay\\s+as|switch\\s+to\\s+role|from\\s+now\\s+on\\s+.*\\brole)",
      ).test(t),
  },
  {
    id: "system-override",
    risk: "dangerous",
    description: "Attempt to inject a system-level override",
    test: (t) => iRe("\\bsystem\\s*:\\s*(override|update|new|replace|patch)").test(t),
  },
  {
    id: "system-message-injection",
    risk: "dangerous",
    description: "Fake system message injection",
    test: (t) => iRe("\\bsystem\\s*(message|instruction|prompt|notice|alert)\\s*:").test(t),
  },
  {
    id: "new-instructions",
    risk: "dangerous",
    description: "Attempt to inject new instructions",
    test: (t) => iRe("\\b(new|override|updated?)\\s+instructions?\\b").test(t),
  },
  {
    id: "execute-command",
    risk: "dangerous",
    description: "Instruction to run or invoke commands",
    test: (t) => iRe("\\b(run|invoke)\\s+(the\\s+following|this|command|tool)").test(t),
  },
  {
    id: "shell-command-curl",
    risk: "dangerous",
    description: "Shell command reference: curl",
    test: (t) => iRe("\\bcurl\\s+(-[a-zA-Z]|https?://)").test(t),
  },
  {
    id: "shell-command-wget",
    risk: "dangerous",
    description: "Shell command reference: wget",
    test: (t) => iRe("\\bwget\\s+(-[a-zA-Z]|https?://)").test(t),
  },
  {
    id: "shell-rm-rf",
    risk: "dangerous",
    description: "Destructive shell command: rm -rf",
    test: (t) => iRe("\\brm\\s+-rf\\b").test(t),
  },
  {
    id: "jailbreak-dan",
    risk: "dangerous",
    description: "Jailbreak attempt: DAN (Do Anything Now) pattern",
    test: (t) =>
      iRe("\\bdo\\s+anything\\s+now\\b").test(t) ||
      iRe("\\bDAN\\s+(mode|prompt|jailbreak)").test(t),
  },
  {
    id: "important-override",
    risk: "dangerous",
    description: "Priority escalation injection",
    test: (t) => iRe("\\bimportant\\s*:\\s*(the\\s+user|ignore|disregard|new\\s+rule)").test(t),
  },
  {
    id: "xml-tag-system",
    risk: "dangerous",
    description: "XML tag injection targeting system or instruction blocks",
    test: (t) => /<\s*(system|instructions?|prompt|rules?|context)\s*>/i.test(t),
  },
  {
    id: "markdown-js-link",
    risk: "dangerous",
    description: "Markdown link with javascript: URI",
    test: (t) => /\[.*?\]\(\s*javascript\s*:/i.test(t),
  },
  {
    id: "data-uri-html",
    risk: "dangerous",
    description: "Data URI with HTML content type",
    test: (t) => /data\s*:\s*text\/html/i.test(t),
  },
  // --- Suspicious: evasion or anomaly ---
  {
    id: "zero-width-chars",
    risk: "suspicious",
    description: "Zero-width or invisible Unicode characters detected",
    test: (t) => /[\u200B\u200C\u200D\u2060\uFEFF]/.test(t),
  },
  {
    id: "homoglyph-mix",
    risk: "suspicious",
    description: "Mixed script detected: Cyrillic or Greek characters alongside ASCII",
    test: (t) => {
      const hasCyrillicOrGreek = /[\u0400-\u04FF\u0370-\u03FF]/.test(t);
      const hasAsciiAlpha = /[a-zA-Z]/.test(t);
      return hasCyrillicOrGreek && hasAsciiAlpha;
    },
  },
  {
    id: "base64-payload",
    risk: "suspicious",
    description: "Long base64-encoded payload detected",
    test: (t) => /[A-Za-z0-9+/=]{100,}/.test(t),
  },
  {
    id: "encoding-html-entity",
    risk: "suspicious",
    description: "HTML entity encoding evasion (&#x hex entities)",
    test: (t) => /(&#x[0-9a-fA-F]{2,4};?\s*){3,}/.test(t),
  },
  {
    id: "encoding-url-percent",
    risk: "suspicious",
    description: "URL percent-encoding evasion (%3C, %3E, etc.)",
    test: (t) => /(%[0-9a-fA-F]{2}\s*){3,}/.test(t),
  },
  {
    id: "encoding-hex-escape",
    risk: "suspicious",
    description: "Hex escape sequence evasion (\\x3C, etc.)",
    test: (t) => /(\\x[0-9a-fA-F]{2}\s*){3,}/.test(t),
  },
  {
    id: "template-injection",
    risk: "suspicious",
    description: "Template injection markers detected",
    test: (t) => /(\{\{|<%|%>)/.test(t) || /\$\{[^}]{2,}\}/.test(t),
  },
  {
    id: "fullwidth-chars",
    risk: "suspicious",
    description: "Fullwidth ASCII characters detected (possible evasion)",
    test: (t) => /[\uFF01-\uFF5E]{3,}/.test(t),
  },
];

// ---------------------------------------------------------------------------
// Scanning logic
// ---------------------------------------------------------------------------

function scanText(text: string): ScanResult {
  const findings: Finding[] = [];

  for (const rule of DETECTION_RULES) {
    if (rule.test(text)) {
      findings.push({
        pattern: rule.id,
        risk: rule.risk,
        description: rule.description,
      });
    }
  }

  let classification: RiskLevel = "safe";
  if (findings.some((f) => f.risk === "dangerous")) {
    classification = "dangerous";
  } else if (findings.some((f) => f.risk === "suspicious")) {
    classification = "suspicious";
  }

  return { classification, findings };
}

// ---------------------------------------------------------------------------
// Runtime
// ---------------------------------------------------------------------------

const runtime: SkillRuntime = {
  name: "prompt-guard",

  async onActivate(ctx) {
    ctx.logger.info(`prompt-guard: activated for agent ${ctx.agentId}`);
  },

  async onQuery(ctx) {
    let dangerousCount = 0;
    let suspiciousCount = 0;
    let safeCount = 0;

    const enriched = ctx.results.map((r) => {
      const text = typeof r.object === "string" ? r.object : JSON.stringify(r.object);

      const scan = scanText(text);

      if (scan.classification === "dangerous") dangerousCount++;
      else if (scan.classification === "suspicious") suspiciousCount++;
      else safeCount++;

      return {
        subject: r.subject,
        object: {
          original: r.object,
          classification: scan.classification,
          findings: scan.findings,
          findingCount: scan.findings.length,
        },
      };
    });

    const total = ctx.results.length;

    return {
      results: enriched,
      additionalContext: `[prompt-guard] Scanned ${total} items: ${dangerousCount} dangerous, ${suspiciousCount} suspicious, ${safeCount} safe`,
    };
  },

  async onError(ctx) {
    // Log scanning errors for audit trail
    ctx.logger.error(`prompt-guard: error during ${ctx.operation} - ${ctx.error.message}`);
  },
};

export default runtime;

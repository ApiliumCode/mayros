/**
 * Task Classification — Shared Module
 *
 * Keyword-based classification of tasks into taskType, complexity, and domain.
 * Used by TaskRouter (Q-learning routing) and LearningProfileManager (expertise tracking).
 *
 * Single source of truth for classification keywords — avoids divergent
 * keyword lists across modules.
 */

// ============================================================================
// Types
// ============================================================================

export type TaskClassification = {
  taskType: string;
  complexity: "low" | "medium" | "high";
  domain: string;
};

// ============================================================================
// Keywords
// ============================================================================

export const TASK_TYPE_KEYWORDS: Record<string, string[]> = {
  "code-review": [
    "review",
    "pr",
    "pull request",
    "check",
    "lint",
    "inspect",
    "approve",
    "feedback",
  ],
  "security-scan": ["security", "vulnerability", "cve", "owasp", "audit", "pentest"],
  implementation: ["implement", "build", "create", "add", "feature", "develop"],
  refactoring: ["refactor", "clean", "simplify", "extract", "restructure"],
  testing: ["test", "spec", "coverage", "assertion"],
  documentation: ["document", "docs", "readme", "explain"],
  debugging: ["debug", "fix", "bug", "error", "crash"],
  analysis: ["analyze", "report", "benchmark", "profile"],
};

export const DOMAIN_EXTENSIONS: Record<string, string[]> = {
  typescript: [".ts", ".tsx"],
  javascript: [".js", ".jsx", ".mjs"],
  python: [".py"],
  rust: [".rs"],
  go: [".go"],
  java: [".java"],
};

export const DOMAIN_NAMES = Object.keys(DOMAIN_EXTENSIONS);

// ============================================================================
// Classification Functions
// ============================================================================

/** Detect task type from description keywords. */
export function detectTaskType(description: string): string {
  const lower = description.toLowerCase();
  let bestType = "general";
  let bestScore = 0;

  for (const [type, keywords] of Object.entries(TASK_TYPE_KEYWORDS)) {
    let score = 0;
    for (const kw of keywords) {
      if (lower.includes(kw)) score++;
    }
    if (score > bestScore) {
      bestScore = score;
      bestType = type;
    }
  }

  return bestType;
}

/** Detect complexity from description length and scope keywords. */
export function detectComplexity(description: string): "low" | "medium" | "high" {
  const words = description.split(/\s+/).length;
  const hasScope = /\b(all|entire|full|complete|whole)\b/i.test(description);
  const hasMultiple = /\b(multiple|several|many|each|every)\b/i.test(description);

  if (words > 100 || (hasScope && hasMultiple)) return "high";
  if (words > 30 || hasScope || hasMultiple) return "medium";
  return "low";
}

/** Detect domain from file path extension or description keywords. */
export function detectDomain(description: string, path?: string): string {
  if (path) {
    for (const [domain, exts] of Object.entries(DOMAIN_EXTENSIONS)) {
      for (const ext of exts) {
        if (path.endsWith(ext)) return domain;
      }
    }
  }

  const lower = description.toLowerCase();
  for (const domain of DOMAIN_NAMES) {
    if (lower.includes(domain)) return domain;
  }

  return "general";
}

/** Full classification: taskType + complexity + domain. */
export function classifyTask(description: string, path?: string): TaskClassification {
  return {
    taskType: detectTaskType(description),
    complexity: detectComplexity(description),
    domain: detectDomain(description, path),
  };
}

/** Simplified classification from title only (no path, no complexity). */
export function classifyMission(title: string): { domain: string; taskType: string } {
  return {
    taskType: detectTaskType(title),
    domain: detectDomain(title),
  };
}

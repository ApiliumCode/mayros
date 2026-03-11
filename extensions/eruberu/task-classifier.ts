/**
 * Task Classifier
 *
 * Classifies prompts into task types using keyword heuristics.
 * No LLM calls — operates purely on string analysis.
 */

export type TaskType = "code" | "chat" | "analysis" | "creative";

const CODE_KEYWORDS = [
  "implement",
  "fix",
  "debug",
  "function",
  "refactor",
  "compile",
  "build",
  "test",
  "import",
  "class",
  "method",
  "variable",
  "type",
  "interface",
  "module",
  "error",
  "bug",
  "patch",
  "syntax",
  "runtime",
  "lint",
  "deploy",
  "endpoint",
  "api",
  "database",
  "query",
  "migration",
];

const ANALYSIS_KEYWORDS = [
  "analyze",
  "explain",
  "review",
  "compare",
  "evaluate",
  "assess",
  "summarize",
  "describe",
  "investigate",
  "diagnose",
  "benchmark",
  "profile",
  "audit",
  "inspect",
  "examine",
  "report",
];

const CREATIVE_KEYWORDS = [
  "write",
  "story",
  "design",
  "create",
  "compose",
  "draft",
  "brainstorm",
  "ideate",
  "imagine",
  "generate",
  "style",
  "format",
  "template",
  "layout",
  "prose",
  "poem",
  "essay",
  "blog",
  "narrative",
];

/**
 * Classify a prompt into a task type based on keyword frequency.
 */
export function classifyTask(prompt: string): TaskType {
  const lower = prompt.toLowerCase();
  const words = lower.split(/\s+/);

  let codeScore = 0;
  let analysisScore = 0;
  let creativeScore = 0;

  for (const word of words) {
    const cleaned = word.replace(/[^a-z]/g, "");
    if (CODE_KEYWORDS.includes(cleaned)) codeScore++;
    if (ANALYSIS_KEYWORDS.includes(cleaned)) analysisScore++;
    if (CREATIVE_KEYWORDS.includes(cleaned)) creativeScore++;
  }

  // Check for code-like patterns (backticks, file extensions, function syntax)
  if (/```/.test(prompt)) codeScore += 2;
  if (/\.(ts|js|py|rs|go|java|cpp|c|rb|sh)\b/.test(lower)) codeScore += 2;
  if (/\bfunction\s*\(/.test(lower) || /\bconst\s+\w+\s*=/.test(lower)) codeScore += 2;

  const max = Math.max(codeScore, analysisScore, creativeScore);

  if (max === 0) return "chat";
  if (codeScore === max) return "code";
  if (analysisScore === max) return "analysis";
  return "creative";
}

/**
 * Determine budget level from a usage fraction (0.0 - 1.0+).
 */
export type BudgetLevel = "low" | "mid" | "high" | "critical";

export function classifyBudgetLevel(usageFraction: number | undefined): BudgetLevel {
  if (usageFraction === undefined || usageFraction < 0.3) return "low";
  if (usageFraction < 0.7) return "mid";
  if (usageFraction < 0.9) return "high";
  return "critical";
}

/**
 * Determine time slot based on current hour (UTC).
 */
export type TimeSlot = "peak" | "off-peak";

export function classifyTimeSlot(): TimeSlot {
  const hour = new Date().getUTCHours();
  // Peak: 9 AM - 6 PM UTC (business hours)
  return hour >= 9 && hour < 18 ? "peak" : "off-peak";
}

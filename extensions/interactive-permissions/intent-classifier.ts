/**
 * Bash Intent Classifier.
 *
 * Classifies shell commands into risk levels (safe, low, medium, high, critical)
 * based on pattern matching. Used by the interactive-permissions plugin to
 * determine whether a command needs explicit user approval.
 *
 * Risk levels are checked from critical down to safe; highest match wins.
 * All matched patterns are returned for transparency.
 */

// ============================================================================
// Types
// ============================================================================

export type RiskLevel = "safe" | "low" | "medium" | "high" | "critical";

export type IntentClassification = {
  riskLevel: RiskLevel;
  category: string;
  description: string;
  matchedPatterns: string[];
};

// ============================================================================
// Risk Level Ordering
// ============================================================================

const RISK_ORDER: Record<RiskLevel, number> = {
  safe: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4,
};

export function riskLevelSatisfies(actual: RiskLevel, maxAllowed: RiskLevel): boolean {
  return RISK_ORDER[actual] <= RISK_ORDER[maxAllowed];
}

// ============================================================================
// Pattern Definitions
// ============================================================================

type RiskPattern = {
  pattern: RegExp;
  label: string;
  category: string;
  description: string;
};

const CRITICAL_PATTERNS: RiskPattern[] = [
  {
    pattern: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\/\s*$/,
    label: "rm-rf-root",
    category: "destructive",
    description: "Recursive forced deletion of filesystem root",
  },
  {
    pattern: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\s+\/(?!\S)/,
    label: "rm-rf-root",
    category: "destructive",
    description: "Recursive forced deletion of filesystem root",
  },
  {
    pattern: /\bmkfs\b/,
    label: "mkfs",
    category: "destructive",
    description: "Filesystem format command",
  },
  {
    pattern: /\bdd\s+if=/,
    label: "dd-if",
    category: "destructive",
    description: "Low-level disk write (dd with input file)",
  },
  {
    pattern: /:\(\)\s*\{\s*:\|:\s*&\s*\}\s*;?\s*:/,
    label: "fork-bomb",
    category: "destructive",
    description: "Fork bomb — exponential process spawning",
  },
  {
    pattern: /\bshutdown\b/,
    label: "shutdown",
    category: "system",
    description: "System shutdown command",
  },
  {
    pattern: /\breboot\b/,
    label: "reboot",
    category: "system",
    description: "System reboot command",
  },
];

const HIGH_PATTERNS: RiskPattern[] = [
  {
    pattern: /\brm\s+(-\w*r\w*f\w*|-\w*f\w*r\w*)\b/,
    label: "rm-rf",
    category: "destructive",
    description: "Recursive forced deletion",
  },
  {
    pattern: /\bgit\s+push\s+--force\b/,
    label: "git-push-force",
    category: "git",
    description: "Force push to remote (may overwrite history)",
  },
  {
    pattern: /\bgit\s+push\s+-f\b/,
    label: "git-push-force",
    category: "git",
    description: "Force push to remote (may overwrite history)",
  },
  {
    pattern: /\bgit\s+reset\s+--hard\b/,
    label: "git-reset-hard",
    category: "git",
    description: "Hard reset — discards uncommitted changes",
  },
  {
    pattern: /\bcurl\b.*\|\s*\bbash\b/,
    label: "curl-pipe-bash",
    category: "remote-exec",
    description: "Piping remote content to bash for execution",
  },
  {
    pattern: /\bwget\b.*\|\s*\bbash\b/,
    label: "wget-pipe-bash",
    category: "remote-exec",
    description: "Piping remote content to bash for execution",
  },
  {
    pattern: /\bcurl\b.*\|\s*\bsh\b/,
    label: "curl-pipe-sh",
    category: "remote-exec",
    description: "Piping remote content to sh for execution",
  },
  {
    pattern: /\beval\b/,
    label: "eval",
    category: "dynamic-exec",
    description: "Dynamic code evaluation",
  },
  {
    pattern: /\bnc\s+(-\w*l|-\w*p)\b/,
    label: "nc-listen",
    category: "network",
    description: "Network listener (netcat)",
  },
  {
    pattern: /\bsocat\b/,
    label: "socat",
    category: "network",
    description: "Network relay tool",
  },
];

const MEDIUM_PATTERNS: RiskPattern[] = [
  {
    pattern: /\bgit\s+commit\b/,
    label: "git-commit",
    category: "git",
    description: "Git commit — creates a new commit",
  },
  {
    pattern: /\bgit\s+push\b/,
    label: "git-push",
    category: "git",
    description: "Git push to remote repository",
  },
  {
    pattern: /\s>>?\s/,
    label: "file-redirect",
    category: "file-write",
    description: "File write via redirect operator",
  },
  {
    pattern: /\bnpm\s+publish\b/,
    label: "npm-publish",
    category: "publish",
    description: "Publish package to npm registry",
  },
  {
    pattern: /\bdocker\s+run\b/,
    label: "docker-run",
    category: "container",
    description: "Run a Docker container",
  },
  {
    pattern: /\bcurl\b/,
    label: "curl",
    category: "network",
    description: "HTTP request tool",
  },
  {
    pattern: /\bwget\b/,
    label: "wget",
    category: "network",
    description: "HTTP download tool",
  },
];

const LOW_PATTERNS: RiskPattern[] = [
  {
    pattern: /\bgit\s+add\b/,
    label: "git-add",
    category: "git",
    description: "Stage files for commit",
  },
  {
    pattern: /\bnpm\s+install\b/,
    label: "npm-install",
    category: "package",
    description: "Install npm packages",
  },
  {
    pattern: /\bpnpm\s+install\b/,
    label: "pnpm-install",
    category: "package",
    description: "Install pnpm packages",
  },
  {
    pattern: /\byarn\s+(add|install)\b/,
    label: "yarn-install",
    category: "package",
    description: "Install yarn packages",
  },
  {
    pattern: /\bmkdir\b/,
    label: "mkdir",
    category: "filesystem",
    description: "Create directory",
  },
  {
    pattern: /\btouch\b/,
    label: "touch",
    category: "filesystem",
    description: "Create or update file timestamp",
  },
  {
    pattern: /\bcp\b/,
    label: "cp",
    category: "filesystem",
    description: "Copy files",
  },
  {
    pattern: /\bmv\b/,
    label: "mv",
    category: "filesystem",
    description: "Move or rename files",
  },
];

const SAFE_PATTERNS: RiskPattern[] = [
  {
    pattern: /\bls\b/,
    label: "ls",
    category: "read",
    description: "List directory contents",
  },
  {
    pattern: /\bcat\b/,
    label: "cat",
    category: "read",
    description: "Display file contents",
  },
  {
    pattern: /\bgrep\b/,
    label: "grep",
    category: "read",
    description: "Search file contents",
  },
  {
    pattern: /\bfind\b/,
    label: "find",
    category: "read",
    description: "Find files",
  },
  {
    pattern: /\bgit\s+status\b/,
    label: "git-status",
    category: "git-read",
    description: "Show working tree status",
  },
  {
    pattern: /\bgit\s+log\b/,
    label: "git-log",
    category: "git-read",
    description: "Show commit log",
  },
  {
    pattern: /\bgit\s+diff\b/,
    label: "git-diff",
    category: "git-read",
    description: "Show file differences",
  },
  {
    pattern: /\bpwd\b/,
    label: "pwd",
    category: "read",
    description: "Print working directory",
  },
  {
    pattern: /\becho\b/,
    label: "echo",
    category: "read",
    description: "Print text to stdout",
  },
  {
    pattern: /\bhead\b/,
    label: "head",
    category: "read",
    description: "Display beginning of file",
  },
  {
    pattern: /\btail\b/,
    label: "tail",
    category: "read",
    description: "Display end of file",
  },
  {
    pattern: /\bwc\b/,
    label: "wc",
    category: "read",
    description: "Word/line/byte count",
  },
];

// ============================================================================
// Classification Logic
// ============================================================================

type PatternMatch = {
  riskLevel: RiskLevel;
  pattern: RiskPattern;
};

function matchPatterns(command: string): PatternMatch[] {
  const matches: PatternMatch[] = [];

  const levels: Array<{ risk: RiskLevel; patterns: RiskPattern[] }> = [
    { risk: "critical", patterns: CRITICAL_PATTERNS },
    { risk: "high", patterns: HIGH_PATTERNS },
    { risk: "medium", patterns: MEDIUM_PATTERNS },
    { risk: "low", patterns: LOW_PATTERNS },
    { risk: "safe", patterns: SAFE_PATTERNS },
  ];

  for (const { risk, patterns } of levels) {
    for (const pat of patterns) {
      if (pat.pattern.test(command)) {
        matches.push({ riskLevel: risk, pattern: pat });
      }
    }
  }

  return matches;
}

/**
 * Classify a shell command's risk level.
 *
 * Checks patterns from critical down to safe. The highest risk level among
 * all matches determines the final classification. All matched patterns are
 * returned for transparency.
 *
 * Empty/whitespace commands and unknown commands default to "low".
 */
export function classifyCommand(command: string): IntentClassification {
  const trimmed = command.trim();

  if (!trimmed) {
    return {
      riskLevel: "low",
      category: "unknown",
      description: "Empty command",
      matchedPatterns: [],
    };
  }

  const matches = matchPatterns(trimmed);

  if (matches.length === 0) {
    return {
      riskLevel: "low",
      category: "unknown",
      description: "Unrecognized command — defaulting to low risk",
      matchedPatterns: [],
    };
  }

  // Highest risk wins
  let highestRisk: RiskLevel = "safe";
  let primaryMatch = matches[0];

  for (const m of matches) {
    if (RISK_ORDER[m.riskLevel] > RISK_ORDER[highestRisk]) {
      highestRisk = m.riskLevel;
      primaryMatch = m;
    }
  }

  return {
    riskLevel: highestRisk,
    category: primaryMatch.pattern.category,
    description: primaryMatch.pattern.description,
    matchedPatterns: matches.map((m) => m.pattern.label),
  };
}

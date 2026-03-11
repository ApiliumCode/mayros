export type IntentKind =
  | "var-to-const"
  | "remove-console"
  | "sort-imports"
  | "add-semicolons"
  | "remove-comments"
  | "none";

export type DetectedIntent = {
  kind: IntentKind;
  confidence: number;
  filePath?: string;
  targetPattern?: string;
};

const INTENT_PATTERNS: Array<{ kind: IntentKind; keywords: string[][]; boost: number }> = [
  {
    kind: "var-to-const",
    keywords: [
      ["var", "const"],
      ["var", "let"],
      ["convert", "var"],
      ["replace", "var"],
      ["change", "var", "const"],
      ["var to const"],
      ["var to let"],
    ],
    boost: 0.1,
  },
  {
    kind: "remove-console",
    keywords: [
      ["remove", "console"],
      ["delete", "console"],
      ["strip", "console"],
      ["clean", "console"],
      ["remove", "log"],
      ["strip", "debug"],
    ],
    boost: 0.1,
  },
  {
    kind: "sort-imports",
    keywords: [
      ["sort", "import"],
      ["organize", "import"],
      ["order", "import"],
      ["alphabetize", "import"],
      ["clean", "import"],
    ],
    boost: 0.1,
  },
  {
    kind: "add-semicolons",
    keywords: [
      ["add", "semicolon"],
      ["missing", "semicolon"],
      ["insert", "semicolon"],
      ["fix", "semicolon"],
    ],
    boost: 0.05,
  },
  {
    kind: "remove-comments",
    keywords: [
      ["remove", "comment"],
      ["delete", "comment"],
      ["strip", "comment"],
      ["clean", "comment"],
      ["remove all comments"],
    ],
    boost: 0.1,
  },
];

// File path extraction patterns
const FILE_PATH_PATTERNS = [
  /`([^`]+\.[a-zA-Z]{1,10})`/,
  /(?:in|file|from|of)\s+(\S+\.[a-zA-Z]{1,10})/i,
  /(\S+\.[tj]sx?)/,
  /(\S+\.(?:js|ts|jsx|tsx|mjs|cjs|mts|cts))/,
];

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
}

function extractFilePath(prompt: string): string | undefined {
  for (const pattern of FILE_PATH_PATTERNS) {
    const match = prompt.match(pattern);
    if (match?.[1]) return match[1];
  }
  return undefined;
}

export function detectIntent(prompt: string): DetectedIntent {
  const tokens = tokenize(prompt);
  const promptLower = prompt.toLowerCase();
  let bestKind: IntentKind = "none";
  let bestScore = 0;

  for (const { kind, keywords, boost } of INTENT_PATTERNS) {
    let matchScore = 0;
    let matchCount = 0;

    for (const keywordSet of keywords) {
      // Check if all keywords in the set are present
      const allPresent = keywordSet.every((kw) =>
        kw.includes(" ")
          ? promptLower.includes(kw)
          : tokens.some((t) => t === kw || t === kw + "s" || t + "s" === kw),
      );
      if (allPresent) {
        matchCount++;
        matchScore += keywordSet.length * 0.2;
      }
    }

    if (matchCount > 0) {
      // Normalize and add boost for multiple pattern matches
      const score = Math.min(1.0, matchScore + (matchCount > 1 ? boost * matchCount : 0));
      if (score > bestScore) {
        bestScore = score;
        bestKind = kind;
      }
    }
  }

  const filePath = extractFilePath(prompt);
  // Boost confidence when a file path is explicitly mentioned
  if (filePath && bestKind !== "none") {
    bestScore = Math.min(1.0, bestScore + 0.15);
  }

  return {
    kind: bestKind,
    confidence: bestScore,
    filePath,
  };
}

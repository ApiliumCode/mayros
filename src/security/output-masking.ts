/**
 * Tool output masking — detects and redacts sensitive values (API keys,
 * tokens, passwords, connection strings) in tool output text.
 */

export type MaskingResult = {
  text: string;
  masked: boolean;
  redactions: number;
};

type MaskPattern = {
  name: string;
  pattern: RegExp;
  replacement: string;
};

const MASK_PATTERNS: MaskPattern[] = [
  // API keys (common formats)
  {
    name: "aws-key",
    pattern: /\b(AKIA[0-9A-Z]{16})\b/g,
    replacement: "AKIA***REDACTED***",
  },
  {
    name: "aws-secret",
    pattern: /(?<=aws_secret_access_key\s*=\s*)[A-Za-z0-9/+=]{40}/g,
    replacement: "***REDACTED***",
  },
  {
    name: "github-token",
    pattern: /\b(ghp_[A-Za-z0-9]{36,})\b/g,
    replacement: "ghp_***REDACTED***",
  },
  {
    name: "github-oauth",
    pattern: /\b(gho_[A-Za-z0-9]{36,})\b/g,
    replacement: "gho_***REDACTED***",
  },
  {
    name: "github-pat",
    pattern: /\b(github_pat_[A-Za-z0-9_]{82,})\b/g,
    replacement: "github_pat_***REDACTED***",
  },
  {
    name: "gitlab-token",
    pattern: /\b(glpat-[A-Za-z0-9\-_]{20,})\b/g,
    replacement: "glpat-***REDACTED***",
  },
  {
    name: "slack-token",
    pattern: /\b(xox[baprs]-[A-Za-z0-9-]{10,})\b/g,
    replacement: "xox?-***REDACTED***",
  },
  {
    name: "slack-webhook",
    pattern: /\b(https:\/\/hooks\.slack\.com\/services\/T[A-Z0-9]+\/B[A-Z0-9]+\/[A-Za-z0-9]+)\b/g,
    replacement: "https://hooks.slack.com/services/***REDACTED***",
  },
  {
    name: "npm-token",
    pattern: /\b(npm_[A-Za-z0-9]{36,})\b/g,
    replacement: "npm_***REDACTED***",
  },
  {
    name: "openai-key",
    pattern: /\b(sk-[A-Za-z0-9-]{20,})\b/g,
    replacement: "sk-***REDACTED***",
  },
  {
    name: "anthropic-key",
    pattern: /\b(sk-ant-[A-Za-z0-9-]{20,})\b/g,
    replacement: "sk-ant-***REDACTED***",
  },
  // Generic patterns
  {
    name: "bearer-token",
    pattern: /(?<=Bearer\s+)[A-Za-z0-9\-._~+/]+=*/g,
    replacement: "***REDACTED***",
  },
  {
    name: "basic-auth",
    pattern: /(?<=Basic\s+)[A-Za-z0-9+/]+=*/g,
    replacement: "***REDACTED***",
  },
  {
    name: "password-field",
    pattern: /(?<=(password|passwd|pwd|secret)\s*[:=]\s*["']?)[^\s"'\n]{8,}/gi,
    replacement: "***REDACTED***",
  },
  {
    name: "connection-string-password",
    pattern: /(?<=:\/\/[^:]+:)[^@\s]{8,}(?=@)/g,
    replacement: "***REDACTED***",
  },
  // Stripe keys
  {
    name: "stripe-key",
    pattern: /\b[sr]k_live_[A-Za-z0-9]{24,}\b/g,
    replacement: "***REDACTED_STRIPE***",
  },
  // SendGrid keys
  {
    name: "sendgrid-key",
    pattern: /\bSG\.[A-Za-z0-9_-]{22,}\.[A-Za-z0-9_-]{22,}\b/g,
    replacement: "SG.***REDACTED***",
  },
  // Azure storage keys
  {
    name: "azure-key",
    pattern: /AccountKey=[A-Za-z0-9+/=]{44,}/g,
    replacement: "AccountKey=***REDACTED***",
  },
  // Discord bot tokens
  {
    name: "discord-token",
    pattern: /[A-Za-z0-9]{24,}\.[A-Za-z0-9_-]{6}\.[A-Za-z0-9_-]{27,}/g,
    replacement: "***REDACTED_DISCORD***",
  },
  // JWT tokens
  {
    name: "jwt-token",
    pattern: /eyJ[A-Za-z0-9_-]{50,}\.eyJ[A-Za-z0-9_-]{50,}\.[A-Za-z0-9_-]{20,}/g,
    replacement: "***REDACTED_JWT***",
  },
  // Generic token/api_key fields (must be AFTER specific token patterns to avoid shadowing)
  {
    name: "generic-token-field",
    pattern:
      /(?<=(api_key|apikey|auth_token|access_token|secret_key)\s*[:=]\s*["']?)[^\s"'\n*]{16,}/gi,
    replacement: "***REDACTED***",
  },
  // Private keys (bounded to 16KB to prevent ReDoS on unmatched BEGIN without END)
  {
    name: "private-key",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]{0,16384}?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "-----BEGIN PRIVATE KEY-----\n***REDACTED***\n-----END PRIVATE KEY-----",
  },
];

export function maskSensitiveOutput(text: string): MaskingResult {
  let result = text;
  let redactions = 0;

  for (const { pattern, replacement } of MASK_PATTERNS) {
    // Reset regex state
    pattern.lastIndex = 0;
    const matches = result.match(pattern);
    if (matches) {
      redactions += matches.length;
      result = result.replace(pattern, replacement);
    }
  }

  return { text: result, masked: redactions > 0, redactions };
}

export function isSensitivePath(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  const sensitivePatterns = [
    ".env",
    ".env.local",
    ".env.production",
    ".env.development",
    "credentials",
    ".netrc",
    ".npmrc",
    "id_rsa",
    "id_ed25519",
    "id_ecdsa",
    "id_dsa",
    ".pem",
    ".key",
    ".p12",
    ".pfx",
    "secrets.yml",
    "secrets.yaml",
    "secrets.json",
    "service-account",
    "serviceaccount",
  ];
  return sensitivePatterns.some((p) => lower.includes(p));
}

/** List of known pattern names for diagnostic/audit purposes. */
export function listMaskPatternNames(): string[] {
  return MASK_PATTERNS.map((p) => p.name);
}

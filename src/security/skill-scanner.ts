import fs from "node:fs/promises";
import path from "node:path";
import { hasErrnoCode } from "../infra/errors.js";
import { isPathInside } from "./scan-paths.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SkillScanSeverity = "info" | "warn" | "critical";

export type SkillScanFinding = {
  ruleId: string;
  severity: SkillScanSeverity;
  file: string;
  line: number;
  message: string;
  evidence: string;
};

export type SkillScanSummary = {
  scannedFiles: number;
  critical: number;
  warn: number;
  info: number;
  findings: SkillScanFinding[];
};

export type SkillScanOptions = {
  includeFiles?: string[];
  maxFiles?: number;
  maxFileBytes?: number;
};

// ---------------------------------------------------------------------------
// Scannable extensions
// ---------------------------------------------------------------------------

const SCANNABLE_EXTENSIONS = new Set([
  ".js",
  ".ts",
  ".mjs",
  ".cjs",
  ".mts",
  ".cts",
  ".jsx",
  ".tsx",
]);

const DEFAULT_MAX_SCAN_FILES = 500;
const DEFAULT_MAX_FILE_BYTES = 1024 * 1024;

export function isScannable(filePath: string): boolean {
  return SCANNABLE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

// ---------------------------------------------------------------------------
// Rule definitions
// ---------------------------------------------------------------------------

type LineRule = {
  ruleId: string;
  severity: SkillScanSeverity;
  message: string;
  pattern: RegExp;
  /** If set, the rule only fires when the *full source* also matches this pattern. */
  requiresContext?: RegExp;
};

type SourceRule = {
  ruleId: string;
  severity: SkillScanSeverity;
  message: string;
  /** Primary pattern tested against the full source. */
  pattern: RegExp;
  /** Secondary context pattern; both must match for the rule to fire. */
  requiresContext?: RegExp;
};

const LINE_RULES: LineRule[] = [
  {
    ruleId: "dangerous-exec",
    severity: "critical",
    message: "Shell command execution detected (child_process)",
    pattern: /\b(exec|execSync|spawn|spawnSync|execFile|execFileSync)\s*\(/,
    requiresContext: /child_process/,
  },
  {
    ruleId: "dynamic-code-execution",
    severity: "critical",
    message: "Dynamic code execution detected",
    pattern: /\beval\s*\(|new\s+Function\s*\(/,
  },
  {
    ruleId: "crypto-mining",
    severity: "critical",
    message: "Possible crypto-mining reference detected",
    pattern: /stratum\+tcp|stratum\+ssl|coinhive|cryptonight|xmrig/i,
  },
  {
    ruleId: "suspicious-network",
    severity: "warn",
    message: "WebSocket connection to non-standard port",
    pattern: /new\s+WebSocket\s*\(\s*["']wss?:\/\/[^"']*:(\d+)/,
  },
  {
    ruleId: "semantic-unbounded-query",
    severity: "warn",
    message: "Graph query without limit — may return excessive results",
    pattern: /patternQuery\s*\(\s*\{[^}]*(?!limit)[^}]*\}/,
    requiresContext: /type:\s*["']?semantic/,
  },
  {
    ruleId: "semantic-unproven-assertion",
    severity: "warn",
    message: "Assertion without requireProof — consider requiring proof for verifiability",
    pattern: /requireProof:\s*false/,
    requiresContext: /type:\s*["']?semantic/,
  },
  // --- Anti-evasion rules (Phase 5.5) ---
  {
    ruleId: "bracket-property-exec",
    severity: "critical",
    message: "Bracket-notation access to dangerous function (exec/spawn/eval evasion)",
    pattern: /\[["'](exec|spawn|eval|execSync|spawnSync|Function)["']\]/,
  },
  {
    ruleId: "dynamic-require",
    severity: "critical",
    message: "Dynamic require() with non-literal argument",
    pattern: /\brequire\s*\(\s*[^"'`\s)]/,
  },
  {
    ruleId: "global-this-access",
    severity: "warn",
    message: "globalThis bracket access detected (possible sandbox escape)",
    pattern: /\bglobalThis\s*\[/,
  },
  {
    ruleId: "process-env-bracket",
    severity: "critical",
    message: "Bracket-notation access to process.env (bypasses process.env rule)",
    pattern: /process\s*\[\s*["']env["']\s*\]/,
    requiresContext: /\bfetch\b|\bpost\b|http\.request/i,
  },
  {
    ruleId: "dynamic-import",
    severity: "critical",
    message: "Dynamic import() with non-literal argument (possible sandbox escape)",
    pattern: /\bimport\s*\(\s*[^"'`\s)]/,
  },
];

const STANDARD_PORTS = new Set([80, 443, 8080, 8443, 3000]);

const SOURCE_RULES: SourceRule[] = [
  {
    ruleId: "potential-exfiltration",
    severity: "warn",
    message: "File read combined with network send — possible data exfiltration",
    pattern: /readFileSync|readFile/,
    requiresContext: /\bfetch\b|\bpost\b|http\.request/i,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Hex-encoded string sequence detected (possible obfuscation)",
    pattern: /(\\x[0-9a-fA-F]{2}){6,}/,
  },
  {
    ruleId: "obfuscated-code",
    severity: "warn",
    message: "Large base64 payload with decode call detected (possible obfuscation)",
    pattern: /(?:atob|Buffer\.from)\s*\(\s*["'][A-Za-z0-9+/=]{200,}["']/,
  },
  {
    ruleId: "env-harvesting",
    severity: "critical",
    message:
      "Environment variable access combined with network send — possible credential harvesting",
    pattern: /process\.env/,
    requiresContext: /\bfetch\b|\bpost\b|http\.request/i,
  },
];

// ---------------------------------------------------------------------------
// H5: Source preprocessing — join split lines, strip comments
// ---------------------------------------------------------------------------

/**
 * Strip single-line (//) and multi-line comments from source.
 * Preserves string literals (single, double, template).
 */
function stripComments(source: string): string {
  const out: string[] = [];
  let i = 0;
  while (i < source.length) {
    // Skip string literals
    if (source[i] === '"' || source[i] === "'" || source[i] === "`") {
      const quote = source[i];
      out.push(source[i]);
      i++;
      while (i < source.length && source[i] !== quote) {
        if (source[i] === "\\" && i + 1 < source.length) {
          out.push(source[i], source[i + 1]);
          i += 2;
        } else {
          if (source[i] === "\n")
            out.push(source[i]); // keep newlines for line tracking
          else out.push(source[i]);
          i++;
        }
      }
      if (i < source.length) {
        out.push(source[i]);
        i++;
      }
    }
    // Single-line comment
    else if (source[i] === "/" && i + 1 < source.length && source[i + 1] === "/") {
      while (i < source.length && source[i] !== "\n") i++;
    }
    // Multi-line comment
    else if (source[i] === "/" && i + 1 < source.length && source[i + 1] === "*") {
      i += 2;
      while (
        i < source.length &&
        !(source[i] === "*" && i + 1 < source.length && source[i + 1] === "/")
      ) {
        if (source[i] === "\n") out.push("\n"); // keep newlines for line tracking
        i++;
      }
      if (i < source.length) i += 2; // skip */
    } else {
      out.push(source[i]);
      i++;
    }
  }
  return out.join("");
}

/**
 * Count net open parens (opens - closes) in a string, ignoring those inside string literals.
 */
function countNetParens(line: string): number {
  let net = 0;
  let inStr: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inStr) {
      if (ch === "\\" && i + 1 < line.length) {
        i++;
        continue;
      }
      if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "(") net++;
    else if (ch === ")") net--;
  }
  return net;
}

/**
 * Join lines where a statement is split across multiple lines.
 * When the next line starts with `(`, it's joined to the previous line
 * (catches `eval\n(...)` and `require\n(...)` patterns).
 * Also joins lines ending with continuation chars (`,`, `+`, `=`, etc.)
 * H5-improved: Properly tracks parens balance across nested calls.
 */
function joinSplitStatements(source: string): string {
  const lines = source.split("\n");
  const joined: string[] = [];
  let accumulator = "";
  let parenDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      if (accumulator) {
        joined.push(accumulator);
        accumulator = "";
        parenDepth = 0;
      }
      joined.push("");
      continue;
    }

    if (accumulator) {
      accumulator += " " + trimmed;
      parenDepth += countNetParens(trimmed);
      // Statement is complete when parens are balanced (or over-closed)
      if (parenDepth <= 0) {
        joined.push(accumulator);
        accumulator = "";
        parenDepth = 0;
      }
    } else if (
      // Check if NEXT line starts with `(` — indicates a split call
      i + 1 < lines.length &&
      /^\s*\(/.test(lines[i + 1])
    ) {
      accumulator = trimmed;
      parenDepth = countNetParens(trimmed);
    } else if (
      // Line ends with an open paren/bracket suggesting continuation
      /[([,]\s*$/.test(trimmed) ||
      // Line ends with an operator suggesting continuation
      /[+\-=&|?:]\s*$/.test(trimmed)
    ) {
      accumulator = trimmed;
      parenDepth = countNetParens(trimmed);
    } else {
      joined.push(trimmed);
    }
  }

  if (accumulator) joined.push(accumulator);
  return joined.join("\n");
}

/**
 * Preprocess source for scanner analysis:
 * 1. Strip comments (preserving line structure)
 * 2. Join split statements
 */
function preprocessSource(source: string): string {
  const stripped = stripComments(source);
  return joinSplitStatements(stripped);
}

// ---------------------------------------------------------------------------
// Core scanner
// ---------------------------------------------------------------------------

function truncateEvidence(evidence: string, maxLen = 120): string {
  if (evidence.length <= maxLen) {
    return evidence;
  }
  return `${evidence.slice(0, maxLen)}…`;
}

export function scanSource(source: string, filePath: string): SkillScanFinding[] {
  const findings: SkillScanFinding[] = [];
  const lines = source.split("\n");
  const matchedLineRules = new Set<string>();

  // H5: Preprocess source for line-rule analysis (join split statements, strip comments)
  const preprocessed = preprocessSource(source);
  const ppLines = preprocessed.split("\n");

  // --- Line rules (run against preprocessed + original for evidence) ---
  for (const rule of LINE_RULES) {
    if (matchedLineRules.has(rule.ruleId)) {
      continue;
    }

    // Skip rule entirely if context requirement not met (check original source)
    if (rule.requiresContext && !rule.requiresContext.test(source)) {
      continue;
    }

    // Check preprocessed lines (catches split-line evasion)
    for (let i = 0; i < ppLines.length; i++) {
      const line = ppLines[i];
      const match = rule.pattern.exec(line);
      if (!match) {
        continue;
      }

      // Special handling for suspicious-network: check port
      if (rule.ruleId === "suspicious-network") {
        const port = parseInt(match[1], 10);
        if (STANDARD_PORTS.has(port)) {
          continue;
        }
      }

      // Find evidence from original source (best-effort line match)
      let evidenceLine = i + 1;
      let evidenceText = line.trim();
      for (let j = 0; j < lines.length; j++) {
        if (rule.pattern.test(lines[j])) {
          evidenceLine = j + 1;
          evidenceText = lines[j].trim();
          break;
        }
      }

      findings.push({
        ruleId: rule.ruleId,
        severity: rule.severity,
        file: filePath,
        line: evidenceLine,
        message: rule.message,
        evidence: truncateEvidence(evidenceText),
      });
      matchedLineRules.add(rule.ruleId);
      break; // one finding per line-rule per file
    }
  }

  // --- Source rules ---
  const matchedSourceRules = new Set<string>();
  for (const rule of SOURCE_RULES) {
    // Allow multiple findings for different messages with the same ruleId
    // but deduplicate exact (ruleId+message) combos
    const ruleKey = `${rule.ruleId}::${rule.message}`;
    if (matchedSourceRules.has(ruleKey)) {
      continue;
    }

    if (!rule.pattern.test(source)) {
      continue;
    }
    if (rule.requiresContext && !rule.requiresContext.test(source)) {
      continue;
    }

    // Find the first matching line for evidence + line number
    let matchLine = 0;
    let matchEvidence = "";
    for (let i = 0; i < lines.length; i++) {
      if (rule.pattern.test(lines[i])) {
        matchLine = i + 1;
        matchEvidence = lines[i].trim();
        break;
      }
    }

    // For source rules, if we can't find a line match the pattern might span
    // lines. Report line 0 with truncated source as evidence.
    if (matchLine === 0) {
      matchLine = 1;
      matchEvidence = source.slice(0, 120);
    }

    findings.push({
      ruleId: rule.ruleId,
      severity: rule.severity,
      file: filePath,
      line: matchLine,
      message: rule.message,
      evidence: truncateEvidence(matchEvidence),
    });
    matchedSourceRules.add(ruleKey);
  }

  return findings;
}

// ---------------------------------------------------------------------------
// Directory scanner
// ---------------------------------------------------------------------------

function normalizeScanOptions(opts?: SkillScanOptions): Required<SkillScanOptions> {
  return {
    includeFiles: opts?.includeFiles ?? [],
    maxFiles: Math.max(1, opts?.maxFiles ?? DEFAULT_MAX_SCAN_FILES),
    maxFileBytes: Math.max(1, opts?.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES),
  };
}

async function walkDirWithLimit(dirPath: string, maxFiles: number): Promise<string[]> {
  const files: string[] = [];
  const stack: string[] = [dirPath];

  while (stack.length > 0 && files.length < maxFiles) {
    const currentDir = stack.pop();
    if (!currentDir) {
      break;
    }

    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      if (files.length >= maxFiles) {
        break;
      }
      // Skip hidden dirs and node_modules
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        stack.push(fullPath);
      } else if (isScannable(entry.name)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}

async function resolveForcedFiles(params: {
  rootDir: string;
  includeFiles: string[];
}): Promise<string[]> {
  if (params.includeFiles.length === 0) {
    return [];
  }

  const seen = new Set<string>();
  const out: string[] = [];

  for (const rawIncludePath of params.includeFiles) {
    const includePath = path.resolve(params.rootDir, rawIncludePath);
    if (!isPathInside(params.rootDir, includePath)) {
      continue;
    }
    if (!isScannable(includePath)) {
      continue;
    }
    if (seen.has(includePath)) {
      continue;
    }

    let st: Awaited<ReturnType<typeof fs.stat>> | null = null;
    try {
      st = await fs.stat(includePath);
    } catch (err) {
      if (hasErrnoCode(err, "ENOENT")) {
        continue;
      }
      throw err;
    }
    if (!st?.isFile()) {
      continue;
    }

    out.push(includePath);
    seen.add(includePath);
  }

  return out;
}

async function collectScannableFiles(dirPath: string, opts: Required<SkillScanOptions>) {
  const forcedFiles = await resolveForcedFiles({
    rootDir: dirPath,
    includeFiles: opts.includeFiles,
  });
  if (forcedFiles.length >= opts.maxFiles) {
    return forcedFiles.slice(0, opts.maxFiles);
  }

  const walkedFiles = await walkDirWithLimit(dirPath, opts.maxFiles);
  const seen = new Set(forcedFiles.map((f) => path.resolve(f)));
  const out = [...forcedFiles];
  for (const walkedFile of walkedFiles) {
    if (out.length >= opts.maxFiles) {
      break;
    }
    const resolved = path.resolve(walkedFile);
    if (seen.has(resolved)) {
      continue;
    }
    out.push(walkedFile);
    seen.add(resolved);
  }
  return out;
}

async function readScannableSource(filePath: string, maxFileBytes: number): Promise<string | null> {
  let st: Awaited<ReturnType<typeof fs.stat>> | null = null;
  try {
    st = await fs.stat(filePath);
  } catch (err) {
    if (hasErrnoCode(err, "ENOENT")) {
      return null;
    }
    throw err;
  }
  if (!st?.isFile() || st.size > maxFileBytes) {
    return null;
  }
  try {
    return await fs.readFile(filePath, "utf-8");
  } catch (err) {
    if (hasErrnoCode(err, "ENOENT")) {
      return null;
    }
    throw err;
  }
}

export async function scanDirectory(
  dirPath: string,
  opts?: SkillScanOptions,
): Promise<SkillScanFinding[]> {
  const scanOptions = normalizeScanOptions(opts);
  const files = await collectScannableFiles(dirPath, scanOptions);
  const allFindings: SkillScanFinding[] = [];

  for (const file of files) {
    const source = await readScannableSource(file, scanOptions.maxFileBytes);
    if (source == null) {
      continue;
    }
    const findings = scanSource(source, file);
    allFindings.push(...findings);
  }

  return allFindings;
}

export async function scanDirectoryWithSummary(
  dirPath: string,
  opts?: SkillScanOptions,
): Promise<SkillScanSummary> {
  const scanOptions = normalizeScanOptions(opts);
  const files = await collectScannableFiles(dirPath, scanOptions);
  const allFindings: SkillScanFinding[] = [];
  let scannedFiles = 0;

  for (const file of files) {
    const source = await readScannableSource(file, scanOptions.maxFileBytes);
    if (source == null) {
      continue;
    }
    scannedFiles += 1;
    const findings = scanSource(source, file);
    allFindings.push(...findings);
  }

  return {
    scannedFiles,
    critical: allFindings.filter((f) => f.severity === "critical").length,
    warn: allFindings.filter((f) => f.severity === "warn").length,
    info: allFindings.filter((f) => f.severity === "info").length,
    findings: allFindings,
  };
}

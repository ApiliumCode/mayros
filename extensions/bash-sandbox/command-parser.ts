/**
 * Shell Command Tokenizer
 *
 * Parses shell command strings into structured representations, handling
 * pipes, chains (&&, ||, ;), subshells ($(...), `...`), sudo, redirects,
 * and environment variable prefixes.
 */

// ============================================================================
// Types
// ============================================================================

export type ParsedCommand = {
  executable: string;
  args: string[];
  raw: string;
  isPiped: boolean;
  isChained: boolean;
  isSubshell: boolean;
  hasSudo: boolean;
  hasRedirect: boolean;
};

export type CommandChain = {
  commands: ParsedCommand[];
  raw: string;
};

// ============================================================================
// Constants
// ============================================================================

/** Redirect operators to detect. */
const REDIRECT_PATTERNS = [/>>/, /2>&1/, /2>/, />&/, />>/, />/, /</];

/** Environment variable prefix pattern: FOO=bar, FOO="bar", etc. */
const ENV_PREFIX_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*=/;

// ============================================================================
// Tokenizer
// ============================================================================

/**
 * Split a shell command string into segments on pipe and chain operators
 * while respecting quotes (single and double) and escape characters.
 *
 * Returns an array of `{ segment, separator }` tuples.
 */
function splitOnOperators(input: string): Array<{ segment: string; separator: string }> {
  const results: Array<{ segment: string; separator: string }> = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    if (escaped) {
      current += ch;
      escaped = false;
      i++;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      current += ch;
      i++;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      i++;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      i++;
      continue;
    }

    // Inside quotes — no operator splitting
    if (inSingle || inDouble) {
      current += ch;
      i++;
      continue;
    }

    // Check for two-char operators: &&, ||
    if (i + 1 < input.length) {
      const twoChar = input.slice(i, i + 2);
      if (twoChar === "&&" || twoChar === "||") {
        results.push({ segment: current, separator: twoChar });
        current = "";
        i += 2;
        continue;
      }
    }

    // Check for single-char operators: |, ;
    if (ch === ";" || ch === "|") {
      results.push({ segment: current, separator: ch });
      current = "";
      i++;
      continue;
    }

    current += ch;
    i++;
  }

  // Push remaining segment
  if (current.length > 0 || results.length === 0) {
    results.push({ segment: current, separator: "" });
  }

  return results;
}

/**
 * Tokenize a single command segment into tokens, respecting quotes and escapes.
 */
function tokenize(segment: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < segment.length; i++) {
    const ch = segment[i];

    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      current += ch;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      current += ch;
      continue;
    }

    if (!inSingle && !inDouble && (ch === " " || ch === "\t")) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }

    current += ch;
  }

  if (current.length > 0) {
    tokens.push(current);
  }

  return tokens;
}

/**
 * Detect whether a raw command segment contains subshell syntax.
 * Checks for `$(...)` and backtick-wrapped `` `...` `` patterns.
 */
function detectSubshell(raw: string): boolean {
  // Check for $(...) outside quotes
  let inSingle = false;
  let inDouble = false;
  let escaped = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === "\\") {
      escaped = true;
      continue;
    }

    if (ch === "'" && !inDouble) {
      inSingle = !inSingle;
      continue;
    }

    if (ch === '"' && !inSingle) {
      inDouble = !inDouble;
      continue;
    }

    if (inSingle) continue;

    // $( detected outside single quotes
    if (ch === "$" && i + 1 < raw.length && raw[i + 1] === "(") {
      return true;
    }

    // Backtick detected outside single quotes
    if (ch === "`") {
      return true;
    }
  }

  return false;
}

/**
 * Detect whether a command segment has redirect operators.
 */
function detectRedirect(raw: string): boolean {
  // Strip quoted strings first to avoid false positives
  const stripped = raw.replace(/'[^']*'/g, "").replace(/"[^"]*"/g, "");
  return REDIRECT_PATTERNS.some((p) => p.test(stripped));
}

/**
 * Parse a single command segment into a ParsedCommand structure.
 */
function parseSegment(segment: string, separator: string, prevSeparator: string): ParsedCommand {
  const raw = segment.trim();
  const tokens = tokenize(raw);
  const isSubshell = detectSubshell(raw);
  const hasRedirect = detectRedirect(raw);

  // Filter out redirect targets from the args for executable detection
  // but keep them in the raw string
  const execTokens: string[] = [];
  let skipNext = false;

  for (let i = 0; i < tokens.length; i++) {
    if (skipNext) {
      skipNext = false;
      continue;
    }

    const token = tokens[i];

    // Skip redirect operators and their targets
    if (token === ">" || token === ">>" || token === "<" || token === "2>" || token === "2>&1") {
      skipNext = true;
      continue;
    }

    // Skip tokens that start with redirect operators (e.g., >file, >>file)
    if (/^(>>|2>&1|2>|>&|>|<)/.test(token)) {
      continue;
    }

    execTokens.push(token);
  }

  // Skip environment variable prefixes (FOO=bar cmd arg1)
  let startIdx = 0;
  while (startIdx < execTokens.length && ENV_PREFIX_PATTERN.test(execTokens[startIdx])) {
    startIdx++;
  }

  // Detect sudo
  let hasSudo = false;
  if (startIdx < execTokens.length && execTokens[startIdx] === "sudo") {
    hasSudo = true;
    startIdx++;
    // Skip sudo flags like -u, -E, etc.
    while (startIdx < execTokens.length && execTokens[startIdx].startsWith("-")) {
      startIdx++;
      // If the flag takes an argument (e.g., -u root), skip the argument too
      // but only for known flags that take arguments
    }
  }

  const executable = startIdx < execTokens.length ? execTokens[startIdx] : "";
  const args = startIdx + 1 < execTokens.length ? execTokens.slice(startIdx + 1) : [];

  const isPiped = prevSeparator === "|";
  const isChained = prevSeparator === "&&" || prevSeparator === "||" || prevSeparator === ";";

  return {
    executable,
    args,
    raw,
    isPiped,
    isChained,
    isSubshell,
    hasSudo,
    hasRedirect,
  };
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Parse a shell command string into a CommandChain with individually parsed
 * commands, handling pipes, chains, sudo, redirects, and subshells.
 *
 * @param input - Raw shell command string.
 * @returns Parsed command chain with all component commands.
 */
export function parseCommandChain(input: string): CommandChain {
  const trimmed = input.trim();

  if (trimmed.length === 0) {
    return {
      commands: [],
      raw: input,
    };
  }

  const segments = splitOnOperators(trimmed);
  const commands: ParsedCommand[] = [];

  let prevSeparator = "";
  for (const { segment, separator } of segments) {
    if (segment.trim().length === 0 && separator.length > 0) {
      prevSeparator = separator;
      continue;
    }

    if (segment.trim().length > 0) {
      commands.push(parseSegment(segment, separator, prevSeparator));
    }
    prevSeparator = separator;
  }

  return {
    commands,
    raw: input,
  };
}

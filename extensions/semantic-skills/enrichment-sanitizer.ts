/**
 * Enrichment Sanitizer — Content Security Policy for skill query enrichment.
 *
 * Prevents prompt injection via additionalContext by:
 * 1. Only accepting structured JSON data (objects/arrays), never free text
 * 2. Stripping known prompt-injection patterns from string values
 * 3. Enforcing max depth and max string length
 * 4. Wrapping output in tagged delimiters so the LLM can distinguish it
 */

const MAX_STRING_LENGTH = 512;
const MAX_DEPTH = 4;
const MAX_ARRAY_LENGTH = 50;
const MAX_ENRICHMENT_CHARS = 4096;

/**
 * C3: Map common Unicode homoglyphs to their ASCII equivalents.
 * Prevents bypass via Cyrillic/Greek/fullwidth lookalike characters.
 */
const HOMOGLYPH_MAP: Record<string, string> = {
  // Cyrillic
  "\u0410": "A",
  "\u0430": "a",
  "\u0412": "B",
  "\u0435": "e",
  "\u0415": "E",
  "\u041D": "H",
  "\u043E": "o",
  "\u041E": "O",
  "\u0440": "p",
  "\u0420": "P",
  "\u0441": "c",
  "\u0421": "C",
  "\u0443": "y",
  "\u0423": "Y",
  "\u0445": "x",
  "\u0425": "X",
  "\u0456": "i",
  "\u0406": "I",
  "\u0458": "j",
  "\u0408": "J",
  "\u043A": "k",
  "\u041C": "M",
  "\u0422": "T",
  "\u0442": "t",
  // Greek
  "\u0391": "A",
  "\u0392": "B",
  "\u0395": "E",
  "\u0397": "H",
  "\u0399": "I",
  "\u039A": "K",
  "\u039C": "M",
  "\u039D": "N",
  "\u039F": "O",
  "\u03A1": "P",
  "\u03A4": "T",
  "\u03A5": "Y",
  "\u03A7": "X",
  "\u03B1": "a",
  "\u03B5": "e",
  "\u03BF": "o",
  "\u03C1": "p",
  "\u03C5": "u",
};

// Regex matching zero-width / invisible characters
const ZERO_WIDTH_RE = /[\u200B\u200C\u200D\u2060\uFEFF\u00AD]/g;

// Build fullwidth → ASCII mapping (U+FF01–U+FF5E → 0x21–0x7E)
function mapFullwidth(ch: string): string {
  const code = ch.charCodeAt(0);
  if (code >= 0xff01 && code <= 0xff5e) {
    return String.fromCharCode(code - 0xfee0);
  }
  return ch;
}

/**
 * Normalize a string for injection detection:
 * 1. NFC normalization
 * 2. Strip zero-width / invisible characters
 * 3. Replace known homoglyphs with ASCII equivalents
 * 4. Collapse fullwidth characters
 */
function normalizeForDetection(value: string): string {
  let normalized = value.normalize("NFC");
  // Strip zero-width chars
  normalized = normalized.replace(ZERO_WIDTH_RE, "");
  // Replace homoglyphs + fullwidth
  let result = "";
  for (const ch of normalized) {
    result += HOMOGLYPH_MAP[ch] ?? mapFullwidth(ch);
  }
  return result;
}

/**
 * Patterns commonly used in prompt injection attacks.
 * Matched case-insensitively against string values in enrichment data.
 */
const INJECTION_PATTERNS = [
  /\b(ignore|disregard|forget)\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions?|context|rules?|prompts?)/i,
  /\b(you\s+are|act\s+as|pretend\s+to\s+be|you\s+must|you\s+should)\b/i,
  /\bsystem\s*(:|update|message|instruction|prompt|override|notice|alert)\b/i,
  /\b(execute|run|invoke)\s*(:|the\s+following|this|bash|command|tool)/i,
  /\b(new\s+instructions?|override\s+instructions?|updated?\s+instructions?)\b/i,
  /\bimportant\s*:\s*(the\s+user|you\s+must|ignore|disregard|new\s+rule)/i,
  /\b(curl|wget|bash|sh|eval)\s+/i,
  /\brm\s+-rf\b/i,
  // Patterns merged from memory-semantic injection detection
  /\bdo not follow\s+(the\s+)?(system|developer)\b/i,
  /\bdeveloper\s+message\b/i,
  /<\s*(system|assistant|developer|tool|function|relevant-memories)\b/i,
];

/**
 * Check if a string value contains prompt-injection patterns.
 * C3: Normalizes Unicode before matching to defeat homoglyph attacks.
 */
function containsInjection(value: string): boolean {
  const normalized = normalizeForDetection(value);
  for (const pattern of INJECTION_PATTERNS) {
    if (pattern.test(normalized)) return true;
  }
  return false;
}

/**
 * Sanitize a string value: truncate, strip injection patterns.
 * Returns null if the value is flagged as injection.
 */
function sanitizeString(value: string): string | null {
  const trimmed = value.slice(0, MAX_STRING_LENGTH);
  if (containsInjection(trimmed)) return null;
  return trimmed;
}

/**
 * Recursively sanitize a value returned from skill enrichment.
 * Only allows: strings, numbers, booleans, null, arrays, plain objects.
 * Strips any string value that matches injection patterns.
 */
function sanitizeValue(value: unknown, depth: number): unknown {
  if (depth > MAX_DEPTH) return null;

  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;

  if (typeof value === "string") {
    return sanitizeString(value);
  }

  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < Math.min(value.length, MAX_ARRAY_LENGTH); i++) {
      const sanitized = sanitizeValue(value[i], depth + 1);
      if (sanitized !== null) out.push(sanitized);
    }
    return out.length > 0 ? out : null;
  }

  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    let hasKeys = false;
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      // Sanitize keys too
      const safeKey = key.slice(0, 128);
      if (containsInjection(safeKey)) continue;
      const sanitized = sanitizeValue(val, depth + 1);
      if (sanitized !== null) {
        out[safeKey] = sanitized;
        hasKeys = true;
      }
    }
    return hasKeys ? out : null;
  }

  return null;
}

export type SanitizeResult = {
  safe: boolean;
  sanitized: string | undefined;
  strippedCount: number;
};

/**
 * Sanitize additionalContext from a skill's onQuery result.
 *
 * Accepts either:
 * - A JSON string (parsed → validated → re-serialized)
 * - A plain string (checked for injection, wrapped as data)
 *
 * Returns structured, tagged output safe for LLM consumption.
 */
export function sanitizeEnrichment(raw: string | undefined): SanitizeResult {
  if (!raw || raw.trim().length === 0) {
    return { safe: true, sanitized: undefined, strippedCount: 0 };
  }

  let strippedCount = 0;

  // Try parsing as JSON first (preferred: structured data)
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON — treat as plain text
    parsed = raw;
  }

  if (typeof parsed === "string") {
    // Plain text enrichment — check for injection
    const safe = sanitizeString(parsed);
    if (safe === null) {
      return { safe: false, sanitized: undefined, strippedCount: 1 };
    }
    const output = formatEnrichmentOutput({ data: safe });
    return {
      safe: true,
      sanitized: output.slice(0, MAX_ENRICHMENT_CHARS),
      strippedCount: 0,
    };
  }

  // Structured data — recursively sanitize
  const sanitized = sanitizeValue(parsed, 0);
  if (sanitized === null) {
    return { safe: false, sanitized: undefined, strippedCount: 1 };
  }

  // Count stripped injection values (compare original vs sanitized)
  strippedCount = countStripped(parsed, sanitized);

  const output = formatEnrichmentOutput(sanitized);
  return {
    safe: true,
    sanitized: output.slice(0, MAX_ENRICHMENT_CHARS),
    strippedCount,
  };
}

/**
 * Wrap sanitized enrichment data in explicit tags for LLM.
 */
function formatEnrichmentOutput(data: unknown): string {
  const json = JSON.stringify(data, null, 2);
  return `<skill-enrichment type="data">\n${json}\n</skill-enrichment>`;
}

/**
 * Count how many values were stripped during sanitization.
 */
function countStripped(original: unknown, sanitized: unknown): number {
  if (original === null || original === undefined) return 0;
  if (sanitized === null && original !== null) return 1;
  if (typeof original === "string" && sanitized === null) return 1;

  if (Array.isArray(original) && Array.isArray(sanitized)) {
    return Math.max(0, original.length - sanitized.length);
  }

  if (typeof original === "object" && typeof sanitized === "object" && original && sanitized) {
    const origKeys = Object.keys(original as Record<string, unknown>);
    const sanKeys = new Set(Object.keys(sanitized as Record<string, unknown>));
    let count = 0;
    for (const key of origKeys) {
      if (!sanKeys.has(key)) count++;
    }
    return count;
  }

  return 0;
}

// INJECTION_PATTERNS is re-used by memory-semantic/index.ts for injection detection.
// The remaining exports are internal helpers exposed for unit testing only.
export {
  /** @internal Test utility -- use sanitizeEnrichment() for production code. */
  containsInjection,
  /** @internal Test utility -- use sanitizeEnrichment() for production code. */
  sanitizeValue,
  /** @internal Test utility -- use sanitizeEnrichment() for production code. */
  normalizeForDetection,
  /** Used by memory-semantic for shared injection detection. */
  INJECTION_PATTERNS,
  /** @internal Test utility -- the constant is applied internally by sanitizeEnrichment(). */
  MAX_ENRICHMENT_CHARS,
};

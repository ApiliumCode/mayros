/**
 * RDF Triple Utilities — shared helpers for safe triple operations.
 */

/** Strip angle brackets from Cortex RDF notation. `<foo:bar>` → `foo:bar` */
export function stripBrackets(s: string): string {
  return s.startsWith("<") && s.endsWith(">") ? s.slice(1, -1) : s;
}

/**
 * Sanitize a user-supplied string before storing as an RDF triple value.
 * Strips null bytes, control characters, and angle brackets that could
 * corrupt the triple store or cause parsing ambiguity.
 */
export function sanitizeTripleValue(s: string): string {
  return s
    .replace(/\0/g, "") // null bytes
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f]/g, "") // control chars (keep \n \r \t)
    .replace(/^<|>$/g, ""); // leading < or trailing > that mimic RDF notation
}

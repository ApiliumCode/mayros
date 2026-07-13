/**
 * Stable-boundary detection for incremental markdown streaming.
 *
 * When streaming a model response, re-parsing the full markdown on every delta
 * is O(n²). Splitting the text at the last stable block boundary lets the
 * prefix be cached (it never changes once committed) and only the suffix is
 * re-parsed per delta, turning the cost into O(n).
 *
 * A "stable boundary" is a blank line (`\n\n`) that sits outside any open code
 * fence, because that is where a markdown block (paragraph, heading, code
 * block, list) is guaranteed to be complete. Splitting inside an open fence or
 * mid-paragraph would orphan partial tokens and change the rendering.
 */

const FENCE_LINE = /^\s*(`{3,}|~{3,})/;

/**
 * Count the number of code-fence lines in the text up to (but not including)
 * the given end index. An odd count means a fence is currently open.
 */
function fenceCountUpTo(text: string, endIndex: number): number {
  let count = 0;
  let pos = 0;
  while (pos < endIndex) {
    const eol = text.indexOf("\n", pos);
    const lineEnd = eol === -1 || eol >= endIndex ? endIndex : eol;
    const line = text.slice(pos, lineEnd);
    if (FENCE_LINE.test(line)) count++;
    if (eol === -1 || eol >= endIndex) break;
    pos = eol + 1;
  }
  return count;
}

/**
 * Find the index of the last stable block boundary in the text — the position
 * just after a `\n\n` that is outside any open code fence. Returns 0 when no
 * stable boundary exists (the entire text is a single in-flight block).
 *
 * The return value is the start index of the suffix (the unstable part);
 * `text.slice(0, result)` is the stable prefix, `text.slice(result)` is the
 * suffix.
 */
export function findStableBoundary(text: string): number {
  if (!text) return 0;

  // Walk backwards through `\n\n` occurrences, returning the first one that
  // sits in an even-fence-count region (i.e. outside any open fence).
  let searchFrom = text.length;
  while (searchFrom > 0) {
    const boundary = text.lastIndexOf("\n\n", searchFrom - 1);
    if (boundary === -1) return 0;

    // The boundary is stable only if fences are balanced before it.
    const fencesBefore = fenceCountUpTo(text, boundary);
    if (fencesBefore % 2 === 0) {
      return boundary + 2; // start of the block after the blank line
    }

    // Inside an open fence — keep walking back.
    searchFrom = boundary;
  }
  return 0;
}

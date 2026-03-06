import { formatTerminalLink } from "../utils.js";
import { homedir } from "node:os";

const KNOWN_EXTENSIONS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".jsonl",
  ".md",
  ".mdx",
  ".yaml",
  ".yml",
  ".toml",
  ".py",
  ".rs",
  ".go",
  ".rb",
  ".java",
  ".kt",
  ".swift",
  ".c",
  ".cpp",
  ".h",
  ".hpp",
  ".css",
  ".scss",
  ".html",
  ".xml",
  ".sh",
  ".bash",
  ".zsh",
  ".fish",
  ".sql",
  ".graphql",
  ".proto",
  ".wasm",
  ".lock",
  ".env",
  ".txt",
  ".csv",
  ".log",
]);

function hasKnownExtension(path: string): boolean {
  const base = path.replace(/:\d+(?::\d+)?$/, ""); // strip :line:col
  const dot = base.lastIndexOf(".");
  if (dot < 0) return false;
  return KNOWN_EXTENSIONS.has(base.slice(dot).toLowerCase());
}

// Matches file paths in text. Groups: full match.
// Patterns: /absolute, ~/home, relative with ext (word/word.ext), optionally :line:col
const FILE_PATH_RE =
  /(?<=^|[\s"'`([\]{},;])(?:(?:\/[\w.@-]+(?:\/[\w.@-]+)*)|(?:~\/[\w.@-]+(?:\/[\w.@-]+)*)|(?:(?:\.\/)?[\w@-]+(?:\/[\w.@-]+)+\.[\w]+))(?::\d+(?::\d+)?)?(?=$|[\s"'`)\]{},;:])/g;

function resolveAbsolute(path: string): string {
  const clean = path.replace(/:\d+(?::\d+)?$/, "");
  if (clean.startsWith("~/")) {
    return `${homedir()}${clean.slice(1)}`;
  }
  if (clean.startsWith("/")) {
    return clean;
  }
  // Relative path — resolve from cwd
  return `${process.cwd()}/${clean}`;
}

/**
 * Replace file-path-like strings in `text` with clickable OSC 8 `file://` links.
 * Falls back to plain text when not a TTY (controlled by `force`).
 */
export function linkifyFilePaths(
  text: string,
  opts?: { force?: boolean; color?: (s: string) => string },
): string {
  const isTTY =
    opts?.force === true ? true : opts?.force === false ? false : Boolean(process.stdout.isTTY);
  if (!isTTY && !opts?.color) return text;

  return text.replace(FILE_PATH_RE, (match) => {
    const isAbsolute = match.startsWith("/") || match.startsWith("~");
    if (!isAbsolute && !hasKnownExtension(match)) return match;

    const abs = resolveAbsolute(match);
    const url = `file://${abs}`;
    const colored = opts?.color ? opts.color(match) : match;

    if (!isTTY) return colored;
    return formatTerminalLink(colored, url, { force: true });
  });
}

/**
 * WildcardMatcher — Parse and match permission wildcard expressions.
 *
 * Supports syntax like:
 * - Bash(git:*) — allow any command starting with "git "
 * - Bash(npm:*, yarn:*) — allow npm or yarn commands
 * - code_read(src/**) — allow reads under src/
 * - code_write(tests/**) — allow writes under tests/
 * - * — allow all (already supported by PolicyStore)
 */

export type ParsedWildcard = {
  tool: string;
  prefixes: string[];
};

/**
 * Parse a permission wildcard expression like "Bash(git:*)".
 * Returns null if the expression is not a valid wildcard.
 */
export function parsePermissionWildcard(expr: string): ParsedWildcard | null {
  if (!expr || typeof expr !== "string") return null;
  const trimmed = expr.trim();

  // Match: ToolName(prefix1:*, prefix2:*)
  const match = trimmed.match(/^(\w+)\((.+)\)$/);
  if (!match) return null;

  const tool = match[1];
  const inner = match[2];

  // Parse comma-separated prefixes
  const prefixes = inner
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .map((p) => {
      // Remove trailing :* or :** suffix for command-style wildcards
      if (p.endsWith(":*")) {
        return p.slice(0, -2);
      }
      // Keep glob patterns like src/** as-is
      return p;
    });

  if (prefixes.length === 0) return null;

  return { tool, prefixes };
}

/**
 * Check if a tool call matches a wildcard permission.
 */
export function matchesWildcardPermission(
  toolName: string,
  args: Record<string, unknown>,
  wildcard: ParsedWildcard,
): boolean {
  // Tool name must match (case-insensitive for common aliases)
  const normalizedTool = toolName.toLowerCase();
  const wildcardTool = wildcard.tool.toLowerCase();

  // Handle common tool name aliases
  const toolAliases: Record<string, string[]> = {
    bash: ["exec", "code_shell", "bash"],
    code_read: ["code_read", "read"],
    code_write: ["code_write", "write"],
    code_edit: ["code_edit", "edit"],
    code_glob: ["code_glob", "glob"],
    code_grep: ["code_grep", "grep"],
  };

  const matchedAliases = toolAliases[wildcardTool] ?? [wildcardTool];
  if (!matchedAliases.includes(normalizedTool)) return false;

  // For command-based tools (Bash/exec/code_shell), match command prefix
  if (wildcardTool === "bash" || normalizedTool === "exec" || normalizedTool === "code_shell") {
    const command = typeof args.command === "string" ? args.command.trim() : "";
    if (!command) return false;

    return wildcard.prefixes.some((prefix) => {
      // "git" matches "git status", "git commit", etc.
      return command === prefix || command.startsWith(prefix + " ");
    });
  }

  // For path-based tools (code_read, code_write, code_edit, code_glob, code_grep)
  if (
    normalizedTool.startsWith("code_") ||
    normalizedTool === "read" ||
    normalizedTool === "write" ||
    normalizedTool === "edit"
  ) {
    const path =
      typeof args.path === "string"
        ? args.path
        : typeof args.pattern === "string"
          ? args.pattern
          : "";
    if (!path) return false;

    return wildcard.prefixes.some((prefix) => {
      // Handle glob-style prefixes like "src/**"
      if (prefix.endsWith("/**")) {
        const dir = prefix.slice(0, -3);
        return path === dir || path.startsWith(dir + "/");
      }
      if (prefix.endsWith("/*")) {
        const dir = prefix.slice(0, -2);
        // Only direct children, not nested
        const relative = path.startsWith(dir + "/") ? path.slice(dir.length + 1) : "";
        return relative.length > 0 && !relative.includes("/");
      }
      // Exact prefix match
      return path.startsWith(prefix);
    });
  }

  // For unknown tools, check if any arg value matches any prefix
  return wildcard.prefixes.some((prefix) => {
    for (const value of Object.values(args)) {
      if (typeof value === "string" && (value === prefix || value.startsWith(prefix))) {
        return true;
      }
    }
    return false;
  });
}

/**
 * Check if an expression is a wildcard permission (has parentheses pattern).
 */
export function isWildcardExpression(expr: string): boolean {
  return /^\w+\(.+\)$/.test(expr.trim());
}

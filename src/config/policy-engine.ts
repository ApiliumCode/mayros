/**
 * Policy engine — evaluates tool calls, shell commands, and file paths against
 * a set of declarative rules loaded from `.mayros-policies` files.
 */

import { readFileSync } from "node:fs";

export type PolicyRule = {
  id: string;
  description: string;
  action: "allow" | "deny" | "warn" | "ask";
  matchers: PolicyMatcher[];
  priority: number;
};

export type PolicyMatcher =
  | { type: "tool"; name: string }
  | { type: "command"; pattern: string }
  | { type: "path"; glob: string }
  | { type: "any" };

export type PolicyEvaluation = {
  rule: PolicyRule | null;
  action: "allow" | "deny" | "warn" | "ask";
  reason: string;
};

// ── Glob matching ──────────────────────────────────────────────────

/**
 * Minimal glob matcher supporting `*` (any chars within segment) and
 * `**` (any path segments). No external deps.
 */
function globToRegex(pattern: string): RegExp {
  let result = "^";
  let i = 0;
  while (i < pattern.length) {
    const ch = pattern[i]!;

    if (ch === "*") {
      if (pattern[i + 1] === "*") {
        // ** matches any path segments
        if (pattern[i + 2] === "/") {
          result += "(?:.+/)?";
          i += 3;
        } else {
          result += ".*";
          i += 2;
        }
      } else {
        // * matches anything except /
        result += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      result += "[^/]";
      i += 1;
    } else if (".+^${}()|[]\\".includes(ch)) {
      result += "\\" + ch;
      i += 1;
    } else {
      result += ch;
      i += 1;
    }
  }
  result += "$";
  return new RegExp(result);
}

function matchGlob(pattern: string, value: string): boolean {
  return globToRegex(pattern).test(value);
}

/**
 * Command matching: `*` matches any character (including `/` and spaces)
 * because commands are flat strings, not file paths.
 */
function matchCommand(pattern: string, command: string): boolean {
  let result = "^";
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i]!;
    if (ch === "*") {
      result += ".*";
    } else if (".+^${}()|[]\\?".includes(ch)) {
      result += "\\" + ch;
    } else {
      result += ch;
    }
  }
  result += "$";
  return new RegExp(result).test(command);
}

// ── Parser ─────────────────────────────────────────────────────────

const VALID_ACTIONS = new Set<string>(["allow", "deny", "warn", "ask"]);

function isValidAction(value: string): value is PolicyRule["action"] {
  return VALID_ACTIONS.has(value);
}

function stripQuotes(value: string): string {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

type RuleBuilder = {
  id: string;
  description: string;
  action: PolicyRule["action"];
  priority: number;
  matchers: PolicyMatcher[];
};

export class PolicyEngine {
  private rules: PolicyRule[];

  constructor(rules?: PolicyRule[]) {
    this.rules = rules ? [...rules] : [];
  }

  /** Load policies from a `.mayros-policies` file. */
  static fromFile(filePath: string): PolicyEngine {
    const content = readFileSync(filePath, "utf-8");
    return new PolicyEngine(PolicyEngine.parse(content));
  }

  /** Parse policy file content into rules. */
  static parse(content: string): PolicyRule[] {
    const lines = content.split("\n");
    const builders = new Map<string, RuleBuilder>();
    let currentId: string | null = null;

    for (const rawLine of lines) {
      const line = rawLine.trim();

      // Skip empty lines and comments
      if (!line || line.startsWith("#")) {
        continue;
      }

      // Section header: [rule.some-id]
      const sectionMatch = line.match(/^\[rule\.([^\]]+)\]$/);
      if (sectionMatch) {
        currentId = sectionMatch[1]!;
        if (!builders.has(currentId)) {
          builders.set(currentId, {
            id: currentId,
            description: "",
            action: "allow",
            priority: 0,
            matchers: [],
          });
        }
        continue;
      }

      if (!currentId) {
        continue;
      }

      const builder = builders.get(currentId);
      if (!builder) {
        continue;
      }

      // Key=value pairs
      const eqIndex = line.indexOf("=");
      if (eqIndex === -1) {
        continue;
      }

      const key = line.slice(0, eqIndex).trim();
      const value = stripQuotes(line.slice(eqIndex + 1));

      switch (key) {
        case "description":
          builder.description = value;
          break;
        case "action":
          if (isValidAction(value)) {
            builder.action = value;
          }
          break;
        case "priority":
          builder.priority = parseInt(value, 10) || 0;
          break;
        case "match.tool":
          builder.matchers.push({ type: "tool", name: value });
          break;
        case "match.command":
          builder.matchers.push({ type: "command", pattern: value });
          break;
        case "match.path":
          builder.matchers.push({ type: "path", glob: value });
          break;
        case "match.any":
          builder.matchers.push({ type: "any" });
          break;
        default:
          break;
      }
    }

    const rules: PolicyRule[] = [];
    for (const builder of builders.values()) {
      rules.push({
        id: builder.id,
        description: builder.description,
        action: builder.action,
        matchers: builder.matchers,
        priority: builder.priority,
      });
    }

    return rules;
  }

  /** Evaluate a tool call against policies. */
  evaluateToolCall(toolName: string, _args?: Record<string, unknown>): PolicyEvaluation {
    const sorted = this.rulesByPriority();

    for (const rule of sorted) {
      for (const matcher of rule.matchers) {
        if (matcher.type === "tool" && matcher.name === toolName) {
          return {
            rule,
            action: rule.action,
            reason: `Matched rule "${rule.id}": ${rule.description}`,
          };
        }
        if (matcher.type === "any") {
          return {
            rule,
            action: rule.action,
            reason: `Matched catch-all rule "${rule.id}": ${rule.description}`,
          };
        }
      }
    }

    return { rule: null, action: "allow", reason: "no matching policy" };
  }

  /** Evaluate a shell command against policies. */
  evaluateCommand(command: string): PolicyEvaluation {
    const sorted = this.rulesByPriority();

    for (const rule of sorted) {
      for (const matcher of rule.matchers) {
        if (matcher.type === "command" && matchCommand(matcher.pattern, command)) {
          return {
            rule,
            action: rule.action,
            reason: `Matched rule "${rule.id}": ${rule.description}`,
          };
        }
        if (matcher.type === "any") {
          return {
            rule,
            action: rule.action,
            reason: `Matched catch-all rule "${rule.id}": ${rule.description}`,
          };
        }
      }
    }

    return { rule: null, action: "allow", reason: "no matching policy" };
  }

  /** Evaluate a file path operation against policies. */
  evaluateFilePath(filePath: string): PolicyEvaluation {
    const sorted = this.rulesByPriority();

    for (const rule of sorted) {
      for (const matcher of rule.matchers) {
        if (matcher.type === "path" && matchGlob(matcher.glob, filePath)) {
          return {
            rule,
            action: rule.action,
            reason: `Matched rule "${rule.id}": ${rule.description}`,
          };
        }
        if (matcher.type === "any") {
          return {
            rule,
            action: rule.action,
            reason: `Matched catch-all rule "${rule.id}": ${rule.description}`,
          };
        }
      }
    }

    return { rule: null, action: "allow", reason: "no matching policy" };
  }

  /** Add a rule. */
  addRule(rule: PolicyRule): void {
    this.rules.push(rule);
  }

  /** Remove a rule by ID. */
  removeRule(id: string): boolean {
    const index = this.rules.findIndex((r) => r.id === id);
    if (index === -1) {
      return false;
    }
    this.rules.splice(index, 1);
    return true;
  }

  /** List all rules sorted by priority (descending). */
  listRules(): PolicyRule[] {
    return [...this.rules].sort((a, b) => b.priority - a.priority);
  }

  // ── Internal ───────────────────────────────────────────────────────

  private rulesByPriority(): PolicyRule[] {
    return [...this.rules].sort((a, b) => b.priority - a.priority);
  }
}

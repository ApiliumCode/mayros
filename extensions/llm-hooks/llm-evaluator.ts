/**
 * LLM Hook Evaluator
 *
 * Safe condition evaluation (no eval/Function constructor) and LLM-based
 * hook evaluation with timeout, caching support, and duration tracking.
 */

import type { LlmHookDefinition } from "./hook-loader.js";

// ============================================================================
// Types
// ============================================================================

export type LlmHookEvaluation = {
  decision: "approve" | "deny" | "warn";
  reason: string;
  hookName: string;
  model: string;
  durationMs: number;
  cached: boolean;
};

export type EvalContext = {
  toolName?: string;
  params?: Record<string, unknown>;
  sessionKey?: string;
  agentId?: string;
  [key: string]: unknown;
};

export type LlmCallFn = (prompt: string, model: string) => Promise<string>;

// ============================================================================
// Token Types for Condition Parser
// ============================================================================

type TokenKind =
  | "string"
  | "boolean"
  | "identifier"
  | "dot"
  | "lparen"
  | "rparen"
  | "eq"
  | "neq"
  | "and"
  | "or"
  | "not"
  | "eof";

type Token = {
  kind: TokenKind;
  value: string;
};

// ============================================================================
// Tokenizer
// ============================================================================

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    const ch = input[i];

    // Skip whitespace
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i++;
      continue;
    }

    // String literal (double-quoted)
    if (ch === '"') {
      let str = "";
      i++; // skip opening quote
      while (i < input.length && input[i] !== '"') {
        if (input[i] === "\\" && i + 1 < input.length) {
          str += input[i + 1];
          i += 2;
        } else {
          str += input[i];
          i++;
        }
      }
      i++; // skip closing quote
      tokens.push({ kind: "string", value: str });
      continue;
    }

    // Operators
    if (ch === "=" && input[i + 1] === "=") {
      tokens.push({ kind: "eq", value: "==" });
      i += 2;
      continue;
    }
    if (ch === "!" && input[i + 1] === "=") {
      tokens.push({ kind: "neq", value: "!=" });
      i += 2;
      continue;
    }
    if (ch === "&" && input[i + 1] === "&") {
      tokens.push({ kind: "and", value: "&&" });
      i += 2;
      continue;
    }
    if (ch === "|" && input[i + 1] === "|") {
      tokens.push({ kind: "or", value: "||" });
      i += 2;
      continue;
    }
    if (ch === "!") {
      tokens.push({ kind: "not", value: "!" });
      i++;
      continue;
    }
    if (ch === ".") {
      tokens.push({ kind: "dot", value: "." });
      i++;
      continue;
    }
    if (ch === "(") {
      tokens.push({ kind: "lparen", value: "(" });
      i++;
      continue;
    }
    if (ch === ")") {
      tokens.push({ kind: "rparen", value: ")" });
      i++;
      continue;
    }

    // Identifier or boolean
    if (/[a-zA-Z_]/.test(ch)) {
      let ident = "";
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        ident += input[i];
        i++;
      }
      if (ident === "true" || ident === "false") {
        tokens.push({ kind: "boolean", value: ident });
      } else {
        tokens.push({ kind: "identifier", value: ident });
      }
      continue;
    }

    // Unknown character — reject as invalid syntax
    throw new Error(`Unexpected character: ${ch}`);
  }

  tokens.push({ kind: "eof", value: "" });
  return tokens;
}

// ============================================================================
// Recursive Descent Parser
// ============================================================================

class ConditionParser {
  private pos = 0;

  constructor(
    private tokens: Token[],
    private context: EvalContext,
  ) {}

  private peek(): Token {
    return this.tokens[this.pos] ?? { kind: "eof", value: "" };
  }

  private advance(): Token {
    const t = this.tokens[this.pos];
    this.pos++;
    return t ?? { kind: "eof", value: "" };
  }

  private expect(kind: TokenKind): Token {
    const t = this.peek();
    if (t.kind !== kind) {
      throw new Error(`Expected ${kind}, got ${t.kind} (${t.value})`);
    }
    return this.advance();
  }

  // Grammar:
  //   expr      → orExpr
  //   orExpr    → andExpr ( "||" andExpr )*
  //   andExpr   → notExpr ( "&&" notExpr )*
  //   notExpr   → "!" notExpr | comparison
  //   comparison → primary ( ("==" | "!=") primary )?
  //   primary   → "true" | "false" | string | propertyChain | "(" expr ")"
  //   propertyChain → identifier ( "." identifier ( "(" expr ")" )? )*

  parse(): boolean {
    const result = this.parseOrExpr();
    return result;
  }

  private parseOrExpr(): boolean {
    let left = this.parseAndExpr();
    while (this.peek().kind === "or") {
      this.advance();
      const right = this.parseAndExpr();
      left = left || right;
    }
    return left;
  }

  private parseAndExpr(): boolean {
    let left = this.parseNotExpr();
    while (this.peek().kind === "and") {
      this.advance();
      const right = this.parseNotExpr();
      left = left && right;
    }
    return left;
  }

  private parseNotExpr(): boolean {
    if (this.peek().kind === "not") {
      this.advance();
      return !this.parseNotExpr();
    }
    return this.parseComparison();
  }

  private parseComparison(): boolean {
    const left = this.parsePrimary();

    const next = this.peek();
    if (next.kind === "eq") {
      this.advance();
      const right = this.parsePrimary();
      return left === right;
    }
    if (next.kind === "neq") {
      this.advance();
      const right = this.parsePrimary();
      return left !== right;
    }

    // If primary returned a boolean-ish value, coerce
    if (typeof left === "boolean") return left;
    if (typeof left === "string") return left.length > 0;
    return Boolean(left);
  }

  private parsePrimary(): unknown {
    const t = this.peek();

    if (t.kind === "boolean") {
      this.advance();
      return t.value === "true";
    }

    if (t.kind === "string") {
      this.advance();
      return t.value;
    }

    if (t.kind === "lparen") {
      this.advance();
      const result = this.parseOrExpr();
      this.expect("rparen");
      return result;
    }

    if (t.kind === "identifier") {
      return this.parsePropertyChain();
    }

    throw new Error(`Unexpected token: ${t.kind} (${t.value})`);
  }

  private resolveContextValue(path: string[]): unknown {
    let current: unknown = this.context;
    for (const segment of path) {
      if (current === null || current === undefined) return undefined;
      if (typeof current !== "object") return undefined;
      current = (current as Record<string, unknown>)[segment];
    }
    return current;
  }

  private parsePropertyChain(): unknown {
    const path: string[] = [];
    const first = this.expect("identifier");
    path.push(first.value);

    while (this.peek().kind === "dot") {
      this.advance(); // skip dot

      const next = this.peek();
      if (next.kind !== "identifier") {
        throw new Error(`Expected identifier after '.', got ${next.kind}`);
      }
      const ident = this.advance();

      // Check for method call: .includes(), .startsWith(), .endsWith()
      if (this.peek().kind === "lparen") {
        this.advance(); // skip '('
        const arg = this.parsePrimary();
        this.expect("rparen");

        const target = this.resolveContextValue(path);
        if (typeof target !== "string") return false;
        if (typeof arg !== "string") return false;

        switch (ident.value) {
          case "includes":
            return target.includes(arg);
          case "startsWith":
            return target.startsWith(arg);
          case "endsWith":
            return target.endsWith(arg);
          default:
            throw new Error(`Unknown method: ${ident.value}`);
        }
      }

      path.push(ident.value);
    }

    return this.resolveContextValue(path);
  }
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Safely evaluate a condition expression against a context.
 * No eval/Function constructor — uses a recursive descent parser.
 * Returns true if condition is empty, undefined, or fails to parse.
 */
export function evaluateCondition(condition: string, context: EvalContext): boolean {
  if (!condition || condition.trim().length === 0) {
    return true;
  }

  try {
    const tokens = tokenize(condition);
    const parser = new ConditionParser(tokens, context);
    return parser.parse();
  } catch {
    // If parsing fails, default to true (let hook run, let LLM decide)
    return true;
  }
}

/**
 * Build the evaluation prompt from hook body and context.
 */
function buildPrompt(hook: LlmHookDefinition, context: EvalContext): string {
  const contextSummary: string[] = [];

  if (context.toolName) {
    contextSummary.push(`Tool: ${context.toolName}`);
  }
  if (context.params) {
    contextSummary.push(`Parameters: ${JSON.stringify(context.params)}`);
  }
  if (context.agentId) {
    contextSummary.push(`Agent: ${context.agentId}`);
  }
  if (context.sessionKey) {
    contextSummary.push(`Session: ${context.sessionKey}`);
  }

  // Add any additional context keys
  for (const [key, value] of Object.entries(context)) {
    if (["toolName", "params", "agentId", "sessionKey"].includes(key)) continue;
    if (value !== undefined && value !== null) {
      contextSummary.push(`${key}: ${typeof value === "string" ? value : JSON.stringify(value)}`);
    }
  }

  const contextBlock =
    contextSummary.length > 0 ? `\n\nContext:\n${contextSummary.join("\n")}` : "";

  return `${hook.body}${contextBlock}`;
}

/**
 * Parse the LLM response into a structured evaluation result.
 * Attempts to extract JSON from the response. Falls back to "approve" if
 * the response is not valid JSON.
 */
function parseLlmResponse(
  response: string,
  hookName: string,
  model: string,
  durationMs: number,
): LlmHookEvaluation {
  const validDecisions = new Set(["approve", "deny", "warn"]);

  try {
    // Try to find JSON in the response (may be wrapped in markdown code blocks)
    let jsonStr = response.trim();

    // Strip markdown code blocks
    const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (jsonMatch) {
      jsonStr = jsonMatch[1].trim();
    }

    // Try to find a JSON object
    const braceStart = jsonStr.indexOf("{");
    const braceEnd = jsonStr.lastIndexOf("}");
    if (braceStart !== -1 && braceEnd > braceStart) {
      jsonStr = jsonStr.slice(braceStart, braceEnd + 1);
    }

    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;
    const decision =
      typeof parsed.decision === "string" && validDecisions.has(parsed.decision)
        ? (parsed.decision as "approve" | "deny" | "warn")
        : "approve";
    const reason = typeof parsed.reason === "string" ? parsed.reason : "No reason provided";

    return { decision, reason, hookName, model, durationMs, cached: false };
  } catch {
    // Invalid JSON — default to approve with warning
    return {
      decision: "approve",
      reason: `LLM returned non-JSON response: ${response.slice(0, 200)}`,
      hookName,
      model,
      durationMs,
      cached: false,
    };
  }
}

/**
 * Evaluate a hook by calling the LLM with the hook's prompt body and context.
 * Supports timeout, duration tracking, and graceful fallback on errors.
 */
export async function evaluateHook(
  hook: LlmHookDefinition,
  context: EvalContext,
  options: {
    model?: string;
    timeoutMs?: number;
    llmCall?: LlmCallFn;
  },
): Promise<LlmHookEvaluation> {
  const model = options.model ?? hook.model ?? "anthropic/claude-sonnet-4-20250514";
  const timeoutMs = options.timeoutMs ?? hook.timeoutMs;
  const llmCall = options.llmCall;

  if (!llmCall) {
    return {
      decision: "approve",
      reason: "No LLM call function provided — defaulting to approve",
      hookName: hook.name,
      model,
      durationMs: 0,
      cached: false,
    };
  }

  const prompt = buildPrompt(hook, context);
  const startMs = Date.now();

  try {
    const response = await Promise.race([
      llmCall(prompt, model),
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("LLM evaluation timed out")), timeoutMs),
      ),
    ]);

    const durationMs = Date.now() - startMs;
    return parseLlmResponse(response, hook.name, model, durationMs);
  } catch (err) {
    const durationMs = Date.now() - startMs;
    return {
      decision: "approve",
      reason: `LLM evaluation failed: ${err instanceof Error ? err.message : String(err)}`,
      hookName: hook.name,
      model,
      durationMs,
      cached: false,
    };
  }
}

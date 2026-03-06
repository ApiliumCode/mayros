/**
 * Model alias resolution for CLI `--model` flag.
 *
 * Allows short names like "sonnet" or "opus" to resolve to full
 * provider/model identifiers used by the gateway.
 */

const MODEL_ALIASES: Record<string, string> = {
  sonnet: "anthropic/claude-sonnet",
  opus: "anthropic/claude-opus",
  haiku: "anthropic/claude-haiku",
  "gemini-pro": "google/gemini-pro",
  "gemini-flash": "google/gemini-flash",
  gpt4: "openai/gpt-4",
  gpt4o: "openai/gpt-4o",
};

/**
 * Resolve a model alias to its full identifier.
 * Returns the input unchanged if no alias matches.
 */
export function resolveModelAlias(input: string): string {
  return MODEL_ALIASES[input.toLowerCase()] ?? input;
}

/**
 * Return a shallow copy of the alias map for listing/display purposes.
 */
export function listModelAliases(): Record<string, string> {
  return { ...MODEL_ALIASES };
}

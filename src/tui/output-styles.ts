export type OutputStyle = "standard" | "explanatory" | "learning";

export const OUTPUT_STYLE_NAMES: OutputStyle[] = ["standard", "explanatory", "learning"];

const STYLE_PREFIXES: Record<OutputStyle, string> = {
  standard: "",
  explanatory:
    "[System: Provide detailed explanations for your responses. " +
    "Break down your reasoning step by step. " +
    "Explain why you chose a particular approach and what alternatives exist.]\n\n",
  learning:
    "[System: Act as a patient teacher. " +
    "Explain concepts from first principles. " +
    "Use analogies and examples. " +
    "After each explanation, suggest related topics to explore.]\n\n",
};

export function applyOutputStyle(message: string, style: OutputStyle): string {
  const prefix = STYLE_PREFIXES[style];
  if (!prefix) {
    return message;
  }
  return `${prefix}${message}`;
}

export function isValidOutputStyle(value: string): value is OutputStyle {
  return OUTPUT_STYLE_NAMES.includes(value as OutputStyle);
}

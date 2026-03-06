/**
 * Public types for the Mayros SDK.
 */

export type SdkOptions = {
  /** Gateway URL. Defaults to MAYROS_GATEWAY_URL env or config. */
  url?: string;
  /** Auth token. Defaults to MAYROS_GATEWAY_TOKEN env. */
  token?: string;
  /** Session key. Auto-generated if omitted. */
  session?: string;
  /** Agent ID to use. */
  agent?: string;
  /** Model override. */
  model?: string;
  /** Thinking level (e.g. "standard", "extended"). */
  thinking?: string;
  /** Per-message timeout in ms. Default: 120000. */
  timeoutMs?: number;
};

export type SdkMessage = {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
};

export type SdkEvent =
  | { type: "text"; text: string }
  | { type: "tool_use"; name: string; args: unknown }
  | { type: "tool_result"; name: string; result: unknown }
  | { type: "thinking"; text: string }
  | { type: "error"; message: string }
  | { type: "done"; usage?: { inputTokens: number; outputTokens: number } };
